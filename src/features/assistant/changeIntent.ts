import { z } from 'zod'
import type { Category, DayIndex, PlannerDocument, ProposalInput, ProposalOp, TimeBlock } from '@/core/model'
import { MINUTES_PER_DAY } from '@/core/model'
import { AssistantError, type Translate } from './provider'
import { matchesIntent, normalize } from './rulesLexicon'

// A 1B model cannot fill the full proposal schema (ids, minutes, nested ops). It fills this small intent
// instead; the code resolves names to ids, "HH:MM" to minutes and weekdays to day indexes, so the model
// never produces a value the planner has to trust.

export const INTENTS = ['add_block', 'move_block', 'delete_block', 'add_task', 'none'] as const
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

const DEFAULT_BLOCK_MINUTES = 60
const MIN_BLOCK_MINUTES = 5
const DEFAULT_TASK_MINUTES = 30
const MIN_TASK_MINUTES = 15
const MAX_TASK_MINUTES = 180
const SUMMARY_MAX = 480

export const INTENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    title: { type: 'string' },
    categoryName: { type: 'string' },
    day: { type: 'string', enum: [...WEEKDAYS] },
    fromDay: { type: 'string', enum: [...WEEKDAYS] },
    start: { type: 'string' },
    end: { type: 'string' },
    durationHours: { type: 'number' },
    durationMinutes: { type: 'integer' },
    dueDate: { type: 'string' },
  },
  required: ['intent'],
  additionalProperties: false,
}

export function intentSchemaText(): string {
  return JSON.stringify(INTENT_JSON_SCHEMA)
}

// Models often write null for a field they do not use and numbers as strings.
const optionalText = z.string().nullish().transform((value) => value?.trim() || undefined)
const optionalWeekday = z.string().nullish().transform((value) => value?.trim().toLowerCase() || undefined)
const optionalNumber = z.union([z.number(), z.string()]).nullish().transform((value) => {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
})

const intentSchema = z.object({
  intent: z.enum(INTENTS),
  title: optionalText,
  categoryName: optionalText,
  day: optionalWeekday,
  fromDay: optionalWeekday,
  start: optionalText,
  end: optionalText,
  durationHours: optionalNumber,
  durationMinutes: optionalNumber,
  dueDate: optionalText,
})
export type ChangeIntent = z.infer<typeof intentSchema>

export type IntentOutcome =
  | { kind: 'proposal'; proposal: ProposalInput; summary: string }
  | { kind: 'message'; message: string }

// Examples name categories that exist in this document, so the model copies a valid name rather than one from the example.
export function intentExamples(document: PlannerDocument) {
  const first = document.categories[0]?.name ?? 'Work'
  const second = document.categories[1]?.name ?? first
  return [
    { request: 'Add a two hour Study block on Monday at 7pm',
      reply: { intent: 'add_block', title: 'Study', categoryName: second, day: 'monday', start: '19:00', durationHours: 2 } },
    { request: 'Add a 45 minute Gym block on Saturday at 7am',
      reply: { intent: 'add_block', title: 'Gym', categoryName: first, day: 'saturday', start: '07:00', durationMinutes: 45 } },
    { request: 'Schedule Reading on Wednesday from 9pm to 10:30pm',
      reply: { intent: 'add_block', title: 'Reading', categoryName: second, day: 'wednesday', start: '21:00', end: '22:30' } },
    { request: 'Move Reading to Friday at 6:30',
      reply: { intent: 'move_block', title: 'Reading', day: 'friday', start: '06:30' } },
    { request: 'Delete the Gym block on Tuesday',
      reply: { intent: 'delete_block', title: 'Gym', day: 'tuesday' } },
    { request: 'Add a task Call the bank, 30 minutes',
      reply: { intent: 'add_task', title: 'Call the bank', categoryName: first, durationMinutes: 30 } },
  ]
}

// Compact planner facts the model needs to name things: category names and existing block titles.
export function intentPlannerSummary(document: PlannerDocument): string {
  const categories = document.categories.map((category) => category.name).join(', ')
  const blocks = document.blocks.map((block) =>
    `${block.title} (${block.days.map((day) => WEEKDAYS[day]!.slice(0, 3)).join('/')} ${clock(block.start)}-${clock(block.end)})`).join('; ')
  return `Categories: ${categories || 'none'}\nBlocks: ${blocks || 'none'}`
}

export function intentSystemPrompt(document: PlannerDocument, locale: string): string {
  return [
    'You turn a request to change a weekly planner into a JSON object. Reply with JSON only.',
    'Fields: intent (add_block, move_block, delete_block, add_task or none), title, categoryName, day (monday to sunday), fromDay, start and end as 24-hour HH:MM, durationHours, durationMinutes, dueDate as YYYY-MM-DD.',
    'Fill only what the request says: leave out end unless it gives an end time and dueDate unless it gives a date. Use durationHours for hours and durationMinutes for minutes.',
    'Use none when the request is not a change to the planner. Copy names exactly from the planner. Do not invent ids.',
    'Examples:',
    ...intentExamples(document).map(({ request, reply }) => `Request: ${request}\nJSON: ${JSON.stringify(reply)}`),
    `The user writes in the language "${locale}"; keep titles in the user's words.`,
    intentPlannerSummary(document),
  ].join('\n')
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function parseClock(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = /^(\d{1,2})(?:[:.h](\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(text.trim())
  if (!match) return undefined
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  const meridiem = match[3]?.[0]?.toLowerCase()
  if (minutes > 59) return undefined
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined
    hours = hours % 12 + (meridiem === 'p' ? 12 : 0)
  } else if (hours === 24 && minutes === 0) {
    hours = 0 // "24:00" is midnight, the end of the day
  }
  return hours > 23 ? undefined : hours * 60 + minutes
}

function dayIndex(name: string | undefined): DayIndex | undefined | null {
  if (!name) return undefined
  const index = WEEKDAYS.findIndex((weekday) => weekday === name || weekday.slice(0, 3) === name)
  return index < 0 ? null : index // null: a day was named but is not a weekday
}

const sameName = (a: string, b: string) => normalize(a).trim() === normalize(b).trim()

function findCategory(categories: Category[], name: string | undefined): Category | undefined {
  if (!name) return undefined
  return categories.find((category) => sameName(category.name, name))
}

// An exact title wins; otherwise a unique title containing (or contained in) the requested one.
function findBlocks(blocks: TimeBlock[], title: string): TimeBlock[] {
  const exact = blocks.filter((block) => sameName(block.title, title))
  if (exact.length) return exact
  const wanted = normalize(title).trim()
  return wanted ? blocks.filter((block) => normalize(block.title).includes(wanted) || wanted.includes(normalize(block.title))) : []
}

function blockOutcome(
  blocks: TimeBlock[], intent: ChangeIntent, from: DayIndex | undefined, t: Translate,
): TimeBlock | { message: string } {
  let candidates = findBlocks(blocks, intent.title!)
  if (candidates.length === 0) return { message: t('assistant.intent.problem.unknownBlock', { title: intent.title }) }
  if (candidates.length > 1 && from !== undefined) {
    const onDay = candidates.filter((block) => block.days.includes(from))
    if (onDay.length) candidates = onDay
  }
  if (candidates.length > 1) return { message: t('assistant.intent.problem.ambiguousBlock', { title: intent.title }) }
  return candidates[0]!
}

function blockMinutes({ durationHours, durationMinutes }: ChangeIntent): number | undefined {
  const total = Math.round((durationHours ?? 0) * 60 + (durationMinutes ?? 0))
  return durationHours === undefined && durationMinutes === undefined ? undefined : total
}

function describeTimes(start: number, end: number): { start: string; end: string } {
  return { start: clock(start), end: clock(end % MINUTES_PER_DAY) }
}

function weekdayName(day: DayIndex, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + day)))
}

export interface IntentEnvironment {
  request: string // the person's own words: a date the model offers must appear in them
  document: PlannerDocument
  locale: string
  translate: Translate
}

export function parseIntent(raw: Record<string, unknown>): ChangeIntent {
  const parsed = intentSchema.safeParse(raw)
  if (!parsed.success) throw new AssistantError('invalid-output', { cause: parsed.error })
  return parsed.data
}

// Maps the model's intent to a ProposalInput, or to a short message telling the person what is missing.
// Throws invalid-output only when the reply itself is not an intent.
export function proposalFromIntent(intent: ChangeIntent, { request, document, locale, translate: t }: IntentEnvironment): IntentOutcome {
  const message = (key: string, params?: Record<string, unknown>): IntentOutcome => ({ kind: 'message', message: t(`assistant.intent.problem.${key}`, params ?? {}) })
  const proposal = (ops: ProposalOp[], summary: string): IntentOutcome => ({
    kind: 'proposal',
    summary: summary.slice(0, SUMMARY_MAX),
    proposal: { contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision, summary: summary.slice(0, SUMMARY_MAX), ops },
  })
  const day = dayIndex(intent.day)
  const fromDay = dayIndex(intent.fromDay)
  if (day === null || fromDay === null) return message('needsDetails')

  switch (intent.intent) {
    case 'none': return message('noChange')

    case 'add_block': {
      if (!intent.title || day === undefined) return message('needsDetails')
      const category = findCategory(document.categories, intent.categoryName ?? intent.title)
      if (!category) return message('unknownCategory', { category: intent.categoryName ?? intent.title, categories: document.categories.map((entry) => entry.name).join(', ') })
      const start = intent.start === undefined ? undefined : parseClock(intent.start)
      if (start === undefined) return message('needsDetails')
      const length = blockMinutes(intent)
      if (length !== undefined && (length < MIN_BLOCK_MINUTES || length >= MINUTES_PER_DAY)) return message('needsDetails')
      const end = intent.end !== undefined ? parseClock(intent.end) : (start + (length ?? DEFAULT_BLOCK_MINUTES)) % MINUTES_PER_DAY
      if (end === undefined || end === start) return message('needsDetails')
      const times = describeTimes(start, end)
      return proposal(
        [{ op: 'add_block', block: { categoryId: category.id, title: intent.title.slice(0, 120), days: [day], start, end } }],
        t('assistant.intent.summary.add_block', { title: intent.title, day: weekdayName(day, locale), ...times }),
      )
    }

    case 'move_block': {
      if (!intent.title || (day === undefined && intent.start === undefined)) return message('needsDetails')
      const found = blockOutcome(document.blocks, intent, fromDay, t)
      if ('message' in found) return { kind: 'message', message: found.message }
      if (day !== undefined && found.days.length > 1 && fromDay === undefined) return message('ambiguousBlock', { title: found.title })
      const days = day === undefined ? found.days
        : [...new Set(found.days.length > 1 ? found.days.map((existing) => existing === fromDay ? day : existing) : [day])]
      const start = intent.start === undefined ? found.start : parseClock(intent.start)
      if (start === undefined) return message('needsDetails')
      const length = (found.end - found.start + MINUTES_PER_DAY) % MINUTES_PER_DAY
      const end = intent.end === undefined ? (start + length) % MINUTES_PER_DAY : parseClock(intent.end)
      if (end === undefined || end === start) return message('needsDetails')
      const target = day ?? days[0]!
      return proposal(
        [{ op: 'update_block', id: found.id, patch: { days, start, end } }],
        t('assistant.intent.summary.move_block', { title: found.title, day: weekdayName(target, locale), ...describeTimes(start, end) }),
      )
    }

    case 'delete_block': {
      if (!intent.title) return message('needsDetails')
      if (!matchesIntent('delete', request)) return message('notDelete') // a removal needs the person's own word for it
      const found = blockOutcome(document.blocks, intent, day, t)
      if ('message' in found) return { kind: 'message', message: found.message }
      const occurrence = day !== undefined && found.days.length > 1 && found.days.includes(day)
      if (occurrence) {
        return proposal(
          [{ op: 'update_block', id: found.id, patch: { days: found.days.filter((existing) => existing !== day) } }],
          t('assistant.intent.summary.delete_block_day', { title: found.title, day: weekdayName(day, locale) }),
        )
      }
      return proposal([{ op: 'delete_block', id: found.id }], t('assistant.intent.summary.delete_block', { title: found.title }))
    }

    case 'add_task': {
      if (!intent.title) return message('needsDetails')
      const category = findCategory(document.categories, intent.categoryName)
      if (!category) return message('unknownCategory', { category: intent.categoryName ?? intent.title, categories: document.categories.map((entry) => entry.name).join(', ') })
      const minutes = Math.min(MAX_TASK_MINUTES, Math.max(MIN_TASK_MINUTES, blockMinutes(intent) ?? DEFAULT_TASK_MINUTES))
      const dueDate = intent.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(intent.dueDate) && request.includes(intent.dueDate) ? intent.dueDate : undefined
      return proposal(
        [{ op: 'add_task', task: { title: intent.title.slice(0, 120), categoryId: category.id, durationMin: minutes, priority: 2, ...(dueDate ? { dueDate } : {}) } }],
        t('assistant.intent.summary.add_task', { title: intent.title, minutes }),
      )
    }
  }
}
