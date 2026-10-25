import type { Category } from '@/core/model'
import { addLocalDays } from '@/core/time'
import { formatMinute } from '@/features/week/localTime'
import { formatDate } from '@/ui/format'
import { formatDateTime } from '@/ui/format'

export interface SummaryRow { label: string; value: string }
export interface SummaryContext {
  categories: Category[]
  locale: string
  timeZone: string
  // Resolves a message key with optional named parameters (vue-i18n `t`).
  t: (key: string, params?: Record<string, unknown>) => string
}

type Entity = Record<string, unknown>

function weekday(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 2 + day))
}

function dateTime(value: string, context: SummaryContext): string {
  return formatDateTime(value, context.locale, context.timeZone)
}

function goalText(goal: Entity, context: SummaryContext): string {
  const type = String(goal.type)
  return context.t(`proposals.goal.${type === 'max' || type === 'min' ? type : 'none'}`, { hours: goal.hoursPerWeek })
}

// A readable, localized description of one side of a proposal change: what a person checks before approving.
export function summarizeEntity(value: unknown, context: SummaryContext): SummaryRow[] {
  if (!value || typeof value !== 'object') return []
  const entity = value as Entity
  const { t, locale } = context
  const row = (key: string, text: string): SummaryRow => ({ label: t(`proposals.fields.${key}`), value: text })
  const rows: SummaryRow[] = []
  if (typeof entity.title === 'string') rows.push(row('title', entity.title))
  if (typeof entity.name === 'string') rows.push(row('category', entity.name))
  if (typeof entity.categoryId === 'string') {
    rows.push(row('category', context.categories.find((category) => category.id === entity.categoryId)?.name ?? t('proposals.unknownCategory')))
  }
  if (Array.isArray(entity.days)) rows.push(row('days', entity.days.map((day) => weekday(Number(day), locale)).join(', ')))
  if (typeof entity.start === 'number' && typeof entity.end === 'number') {
    // A routine that ends earlier than it starts runs past midnight; it is named the way the week names it.
    const range = `${formatMinute(entity.start, locale)} – ${formatMinute(entity.end, locale)}`
    rows.push(row('time', entity.end < entity.start ? t('week.grid.crossesMidnight', { range }) : range))
  } else if (typeof entity.start === 'string' && typeof entity.end === 'string') {
    // All-day export preserves stored calendar dates and uses an exclusive end.
    const when = entity.allDay === true
      ? `${formatDate(entity.start.slice(0, 10), locale, { dateStyle: 'medium' })} – ${formatDate(addLocalDays(entity.end.slice(0, 10), -1), locale, { dateStyle: 'medium' })}`
      : `${dateTime(entity.start, context)} – ${dateTime(entity.end, context)}`
    rows.push(row('when', when))
  }
  if (typeof entity.durationMin === 'number') rows.push(row('duration', t('proposals.minutes', { minutes: entity.durationMin })))
  if (typeof entity.priority === 'number') rows.push(row('priority', t(`tasks.priority.${entity.priority}`)))
  if (typeof entity.dueDate === 'string') rows.push(row('due', formatDate(entity.dueDate, locale, { dateStyle: 'medium' })))
  if (typeof entity.doneAt === 'string') rows.push(row('status', t('proposals.completed')))
  if (typeof entity.location === 'string' && entity.location) rows.push(row('location', entity.location))
  if (Array.isArray(entity.attendees) && entity.attendees.length) rows.push(row('attendees', entity.attendees.join(', ')))
  if (typeof entity.notes === 'string' && entity.notes) rows.push(row('notes', entity.notes))
  if (entity.goal && typeof entity.goal === 'object') rows.push(row('goal', goalText(entity.goal as Entity, context)))
  return rows
}
