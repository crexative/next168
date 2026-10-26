import { MAX_OPS_PER_PROPOSAL, type ExternalOccurrence, type PlannerDocument, type PlannerEvent, type TimeBlock } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'
import { weekEnd, weekSplit, weekSplitHours } from '@/features/capacity/freeHours'
import { formatHours } from '@/ui/format'
import { localMinuteOf, orderedDays, weekDates } from '@/features/week/localTime'
import { PROPOSAL_LABEL } from './extractProposal'

// The text a person pastes into ChatGPT, Claude, Gemini or any other chat AI. Instructions come from the
// translation catalog; the plan is rendered as short data lines in which every user-written string is quoted.

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface PromptInput {
  document: PlannerDocument
  now: Date
  locale: string
  translate: Translate
  // Occurrences of the imported calendars for this week; the caller expands them (they live in the calendars slice).
  external?: ExternalOccurrence[]
}

// A typical week stays under PROMPT_BUDGET characters. Categories and the whole routine are always listed (the AI
// cannot edit what it cannot see), grouped by title, so a full week of about 85 ranges stays under FULL_WEEK_BUDGET.
// Only long lists of tasks and events are cut, with a visible count.
export const PROMPT_BUDGET = 6000
export const FULL_WEEK_BUDGET = 12000
const MAX_LINES = 30
const MAX_TITLE = 60

// The schema and the example are the same in every language: the AI must reproduce them character by character.
export const SCHEMA_SUMMARY = [
  `{"contractVersion":"1.0","workspaceId":"<as in MY PLAN>","baseRevision":<revision as in MY PLAN>,"summary":"<one short sentence>","ops":[<1 to ${MAX_OPS_PER_PROPOSAL} of these>]}`,
  '{"op":"add_category","ref":"new-<short name>","category":{"name","goal":{"type":"max"|"min"|"none","hoursPerWeek":0-168} (optional)}}',
  '{"op":"add_block","block":{"categoryId","title","days":[0-6],"start":<minute>,"end":<minute>}}',
  '{"op":"update_block","id","patch":{any of categoryId,title,days,start,end}}',
  '{"op":"delete_block","id"}',
  '{"op":"add_task","task":{"title","categoryId" (optional: leave it out for any free time),"durationMin":15-180,"priority":1|2|3,"dueDate":"YYYY-MM-DD" (optional)}}',
  '{"op":"update_task","id","patch":{any of title,categoryId,durationMin,priority,dueDate}}',
  '{"op":"complete_task","id"}',
  '{"op":"add_event","event":{"title","start":"<ISO time with offset>","end":"<ISO time with offset>","allDay":false,"attendees":[]}}',
  '{"op":"update_category_goal","id","goal":{"type":"max"|"min"|"none","hoursPerWeek":0-168}}',
].join('\n')

// JSON on one line whose strings cannot open or close a code block (backticks only occur inside JSON strings).
function jsonLine(value: unknown): string {
  return JSON.stringify(value).replace(/[`\u007f-\u009f\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

// With no category yet, the example shows how a new one is created and used in the same proposal.
function exampleFor(document: PlannerDocument): string {
  const existing = document.categories[0]?.id
  const create = existing ? [] : [{ op: 'add_category', ref: 'new-example', category: { name: 'Example', goal: { type: 'min', hoursPerWeek: 1 } } }]
  return `\`\`\`${PROPOSAL_LABEL}\n${jsonLine({
    contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision,
    summary: existing ? 'Add a one-hour block' : 'Add a category and a one-hour block',
    ops: [...create, { op: 'add_block', block: { categoryId: existing ?? 'new-example', title: 'Example', days: [4], start: 1080, end: 1140 } }],
  })}\n\`\`\``
}

// Any string the document holds, as JSON string data on one line: quotes, backslashes and control characters are
// escaped by JSON; backticks and the characters some readers treat as line breaks (U+0085, U+2028, U+2029) are escaped
// too, so the value can neither end its line nor open a code block. Ids are written this way as well: an imported
// document may hold any 1–64 characters in an id, and the escaped form is exactly what the AI copies into its JSON.
export function data(value: string): string {
  return jsonLine(value)
}

// A string typed by a person or read from a calendar, as one quoted line of data, flattened and cut to `max`.
export function quote(value: string, max = MAX_TITLE): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  const cut = [...flat].length > max ? `${[...flat].slice(0, max - 1).join('')}…` : flat
  return data(cut)
}

const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

function dayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 4 + day))
}


// Day names in the person's week order; three or more days in a row read as a range ("Mon–Fri").
function dayList(days: number[], order: number[], locale: string): string {
  const positions = order.flatMap((day, index) => (days.includes(day) ? [index] : []))
  const runs: number[][] = []
  for (const position of positions) {
    const run = runs.at(-1)
    if (run && run.at(-1) === position - 1) run.push(position)
    else runs.push([position])
  }
  return runs.map((run) => (run.length >= 3
    ? `${dayName(order[run[0]!]!, locale)}–${dayName(order[run.at(-1)!]!, locale)}`
    : run.map((position) => dayName(order[position]!, locale)).join(' '))).join(' ')
}

// One line per routine title and category, with every range of it: the whole routine, however large, stays readable.
function routineLines(blocks: TimeBlock[], order: number[], locale: string): string[] {
  const groups = new Map<string, TimeBlock[]>()
  for (const block of blocks) {
    const key = JSON.stringify([block.categoryId, block.title])
    groups.set(key, [...(groups.get(key) ?? []), block])
  }
  return [...groups.values()].map((group) => {
    const ranges = group.map((block) => {
      const days = order.filter((day) => block.days.includes(day))
      return `${dayList(days, order, locale)} ${clock(block.start)}-${clock(block.end)} [id=${data(block.id)} days=${days.join(',')} start=${block.start} end=${block.end}]`
    })
    return `${quote(group[0]!.title)} [category=${data(group[0]!.categoryId)}]: ${ranges.join('; ')}`
  })
}

function capped(lines: string[], t: Translate): string[] {
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), t('assistant.anyAi.prompt.more', { count: lines.length - MAX_LINES })] : lines
}

interface WeekEvent { start: number; line: string }

// A moment as local date and 24-hour clock. A time-of-day end at exactly midnight is written as 24:00 of the
// day it closes, so "22:00-24:00" does not read as ending before it starts.
function eventLine(title: string, startIso: string, endIso: string, timeZone: string, allDay: boolean): string {
  if (allDay) {
    const first = startIso.slice(0, 10), last = addLocalDays(endIso.slice(0, 10), -1)
    return `${first}${last > first ? `..${last}` : ''} ${quote(title)}`
  }
  const startDate = localDateOf(startIso, timeZone), endDate = localDateOf(endIso, timeZone)
  const startMinute = localMinuteOf(startIso, timeZone), endMinute = localMinuteOf(endIso, timeZone)
  if (endMinute === 0 && endDate === addLocalDays(startDate, 1)) return `${startDate} ${clock(startMinute)}-24:00 ${quote(title)}`
  if (endDate === startDate) return `${startDate} ${clock(startMinute)}-${clock(endMinute)} ${quote(title)}`
  return `${startDate} ${clock(startMinute)} → ${endDate} ${clock(endMinute)} ${quote(title)}`
}

function weekEvents(document: PlannerDocument, external: ExternalOccurrence[], from: Date, until: Date): string[] {
  const timeZone = document.settings.timeZone
  const dayStart = (date: string) => zonedInstant(date, 0, timeZone).getTime()
  const items: WeekEvent[] = []
  const add = (title: string, startIso: string, endIso: string, allDay: boolean) => {
    const start = allDay ? dayStart(startIso.slice(0, 10)) : Date.parse(startIso)
    const end = allDay ? dayStart(endIso.slice(0, 10)) : Date.parse(endIso)
    // Half-open on both sides: an event ending exactly when the week starts, or starting exactly when it ends, is not in it.
    if (!(start < until.getTime() && end > from.getTime())) return
    items.push({ start, line: eventLine(title, startIso, endIso, timeZone, allDay) })
  }
  for (const event of document.events as PlannerEvent[]) add(event.title, event.start, event.end, event.allDay)
  for (const event of external) add(event.title, event.start, event.end, event.allDay)
  return items.sort((a, b) => a.start - b.start || a.line.localeCompare(b.line)).map((item) => item.line)
}

export function buildAiPrompt({ document, now, locale, translate: t, external = [] }: PromptInput): string {
  const timeZone = document.settings.timeZone
  const today = localDateOf(now, timeZone)
  const dates = weekDates(today, document.settings.weekStartsOn)
  const { end } = weekEnd(document, now, timeZone)
  const split = weekSplit(document, now, timeZone)
  const shown = weekSplitHours(split)
  const order = orderedDays(document.settings.weekStartsOn)
  const p = (key: string, params?: Record<string, unknown>) => t(`assistant.anyAi.prompt.${key}`, params)

  const categories = document.categories.map((category) => {
    const goal = category.goal.type === 'none' ? p('goalNone') : p(category.goal.type === 'max' ? 'goalMax' : 'goalMin', { hours: category.goal.hoursPerWeek })
    return `${quote(category.name)} [id=${data(category.id)}] ${goal}`
  })
  const routine = routineLines(document.blocks, order, locale)
  const tasks = document.tasks.filter((task) => !task.doneAt).map((task) => {
    const due = task.dueDate ? ` dueDate=${task.dueDate}` : ''
    return `${quote(task.title)} ${task.durationMin} min [id=${data(task.id)}${task.categoryId === undefined ? '' : ` category=${data(task.categoryId)}`} durationMin=${task.durationMin} priority=${task.priority}${due}]`
  })
  const events = weekEvents(document, external, zonedInstant(dates[0]!, 0, timeZone), end)
  const section = (title: string, lines: string[], empty: string, cut = true) => [`${title}`, ...(lines.length ? (cut ? capped(lines, t) : lines) : [empty])].join('\n')

  return [
    p('intro'),
    '',
    `${p('howHeader')}\n1. ${p('how1')}\n2. ${p('how2')}\n3. ${p('how3')}`,
    '',
    p('dataRule'),
    '',
    `=== ${p('planHeader')} ===`,
    `workspaceId=${data(document.workspaceId)} revision=${document.revision}`,
    p('today', { date: today, day: dayName(new Date(`${today}T00:00:00Z`).getUTCDay(), locale), first: dates[0], last: dates[6], zone: timeZone }),
    // The same whole hours, by the same rounding rule, as the free-hours figure in the app.
    p('free', { free: formatHours(shown.freeAhead, locale), planned: formatHours(shown.plannedAhead, locale), ahead: formatHours(shown.freeAhead + shown.plannedAhead, locale) }),
    '',
    section(p('categoriesHeader'), categories, p('none'), false),
    '',
    section(p('routineHeader'), routine, p('none'), false),
    '',
    section(p('tasksHeader'), tasks, p('none')),
    '',
    section(p('eventsHeader'), events, p('none')),
    '',
    `=== ${p('answerHeader')} ===`,
    p('answerIntro'),
    SCHEMA_SUMMARY,
    p('noteDays'),
    p('noteMinutes'),
    p('noteIds'),
    p('noteCategories'),
    p('noteGroup', { max: MAX_OPS_PER_PROPOSAL }),
    '',
    p('exampleHeader'),
    exampleFor(document),
  ].join('\n')
}
