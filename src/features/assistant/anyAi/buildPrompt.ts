import type { ExternalOccurrence, PlannerDocument, PlannerEvent } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'
import { weekEnd, weekSplit, weekSplitHours } from '@/features/capacity/freeHours'
import { formatHours } from '@/ui/format'
import { localMinuteOf, orderedDays, weekDates } from '@/features/week/localTime'

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

// Keeps the prompt of a typical week well under 6,000 characters; a huge plan is cut with a visible count.
export const PROMPT_BUDGET = 6000
const MAX_LINES = 30
const MAX_TITLE = 60

// The schema and the example are the same in every language: the AI must reproduce them character by character.
export const SCHEMA_SUMMARY = [
  '{"contractVersion":"1.0","workspaceId":"<as in MY PLAN>","baseRevision":<revision as in MY PLAN>,"summary":"<one short sentence>","ops":[<1 to 50 of these>]}',
  '{"op":"add_block","block":{"categoryId","title","days":[0-6],"start":<minute>,"end":<minute>}}',
  '{"op":"update_block","id","patch":{any of categoryId,title,days,start,end}}',
  '{"op":"delete_block","id"}',
  '{"op":"add_task","task":{"title","categoryId","durationMin":15-180,"priority":1|2|3,"dueDate":"YYYY-MM-DD" (optional)}}',
  '{"op":"update_task","id","patch":{any of title,categoryId,durationMin,priority,dueDate}}',
  '{"op":"complete_task","id"}',
  '{"op":"add_event","event":{"title","start":"<ISO time with offset>","end":"<ISO time with offset>","allDay":false,"attendees":[]}}',
  '{"op":"update_category_goal","id","goal":{"type":"max"|"min"|"none","hoursPerWeek":0-168}}',
].join('\n')

function exampleFor(document: PlannerDocument): string {
  const category = document.categories[0]?.id ?? 'category-id'
  return `\`\`\`next168\n${JSON.stringify({
    contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision,
    summary: 'Add a one-hour block', ops: [{ op: 'add_block', block: { categoryId: category, title: 'Example', days: [4], start: 1080, end: 1140 } }],
  })}\n\`\`\``
}

// A string typed by a person or read from a calendar, as one quoted line of data: control characters, quotes,
// backslashes and backticks are escaped, so it can neither end its line nor open a code block.
export function quote(value: string, max = MAX_TITLE): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  const cut = [...flat].length > max ? `${[...flat].slice(0, max - 1).join('')}…` : flat
  return JSON.stringify(cut).replace(/`/g, '\\u0060')
}

const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

function dayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 4 + day))
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
    return `${quote(category.name)} [id=${category.id}] ${goal}`
  })
  const routine = document.blocks.map((block) => {
    const days = order.filter((day) => block.days.includes(day))
    return `${quote(block.title)} ${days.map((day) => dayName(day, locale)).join(' ')} ${clock(block.start)}-${clock(block.end)} [id=${block.id} category=${block.categoryId} days=${days.join(',')} start=${block.start} end=${block.end}]`
  })
  const tasks = document.tasks.filter((task) => !task.doneAt).map((task) => {
    const due = task.dueDate ? ` dueDate=${task.dueDate}` : ''
    return `${quote(task.title)} ${task.durationMin} min [id=${task.id} category=${task.categoryId} durationMin=${task.durationMin} priority=${task.priority}${due}]`
  })
  const events = weekEvents(document, external, zonedInstant(dates[0]!, 0, timeZone), end)
  const section = (title: string, lines: string[], empty: string) => [`${title}`, ...(lines.length ? capped(lines, t) : [empty])].join('\n')

  return [
    p('intro'),
    '',
    `${p('howHeader')}\n1. ${p('how1')}\n2. ${p('how2')}\n3. ${p('how3')}`,
    '',
    p('dataRule'),
    '',
    `=== ${p('planHeader')} ===`,
    `workspaceId=${document.workspaceId} revision=${document.revision}`,
    p('today', { date: today, day: dayName(new Date(`${today}T00:00:00Z`).getUTCDay(), locale), first: dates[0], last: dates[6], zone: timeZone }),
    // The same whole hours, by the same rounding rule, as the free-hours figure in the app.
    p('free', { free: formatHours(shown.freeAhead, locale), planned: formatHours(shown.plannedAhead, locale), ahead: formatHours(shown.freeAhead + shown.plannedAhead, locale) }),
    '',
    section(p('categoriesHeader'), categories, p('none')),
    '',
    section(p('routineHeader'), routine, p('none')),
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
    '',
    p('exampleHeader'),
    exampleFor(document),
  ].join('\n')
}
