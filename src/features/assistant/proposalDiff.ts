import type { PlannerDocument } from '@/core/model'
import type { ProposalPreview } from '@/core/proposals'

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface DiffField { key: string; label: string; before: string; after: string }
export interface DiffEntry { op: string; subject: string; fields: DiffField[] }
export interface ProposalDiff { entries: DiffEntry[]; warnings: string[] }
export interface DiffEnvironment { document: PlannerDocument; locale: string; timeZone: string; translate: Translate }

type Item = Record<string, unknown>

// Shown in this order; fields that exist on none of the compared items are skipped.
const FIELDS = ['title', 'categoryId', 'days', 'start', 'end', 'allDay', 'location', 'attendees', 'notes', 'durationMin', 'dueDate', 'priority', 'doneAt', 'goal'] as const

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function formatField(key: string, value: unknown, env: DiffEnvironment): string {
  const { translate, locale, document } = env
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return translate('assistant.review.value.empty')
  switch (key) {
    case 'categoryId': return document.categories.find((category) => category.id === value)?.name ?? String(value)
    case 'days': {
      const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
      return (value as number[]).map((day) => weekday.format(new Date(Date.UTC(2024, 0, 7 + day)))).join(', ')
    }
    case 'start':
    case 'end':
      if (typeof value === 'number') return clock(value)
      return formatInstant(String(value), env)
    case 'doneAt': return formatInstant(String(value), env)
    case 'allDay': return translate(value ? 'assistant.review.value.yes' : 'assistant.review.value.no')
    case 'attendees': return (value as string[]).join(', ')
    case 'goal': {
      const goal = value as { type: 'max' | 'min' | 'none'; hoursPerWeek: number }
      if (goal.type === 'none') return translate('assistant.review.value.goalNone')
      return translate(goal.type === 'max' ? 'assistant.review.value.goalMax' : 'assistant.review.value.goalMin', { hours: goal.hoursPerWeek })
    }
    default: return String(value)
  }
}

function formatInstant(iso: string, { locale, timeZone }: DiffEnvironment): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso))
}

function warningText(code: string, env: DiffEnvironment): string {
  if (code === 'block.overlap') return env.translate('assistant.review.warning.overlap')
  if (code.startsWith('goal.over:')) {
    const id = code.slice('goal.over:'.length)
    return env.translate('assistant.review.warning.goalOver', { category: env.document.categories.find((category) => category.id === id)?.name ?? id })
  }
  return code
}

// What the user approves: for every operation, each field that changes as before → after, taken from the
// same preview the app applies. Nothing here comes from the model's own description of the change.
export function buildProposalDiff(preview: ProposalPreview, env: DiffEnvironment): ProposalDiff {
  const entries = preview.changes.map((change): DiffEntry => {
    const before = (change.before ?? null) as Item | null
    const after = (change.after ?? null) as Item | null
    const subject = String((after ?? before)?.title ?? (after ?? before)?.name ?? (after ?? before)?.id ?? '')
    const fields: DiffField[] = []
    for (const key of FIELDS) {
      const old = before?.[key]
      const next = after?.[key]
      if (old === undefined && next === undefined) continue
      if (before && after && JSON.stringify(old) === JSON.stringify(next)) continue
      fields.push({
        key,
        label: env.translate(`assistant.review.field.${key === 'categoryId' ? 'category' : key}`),
        before: before ? formatField(key, old, env) : '',
        after: after ? formatField(key, next, env) : '',
      })
    }
    return { op: change.op, subject, fields }
  })
  return { entries, warnings: preview.warnings.map((code) => warningText(code, env)) }
}
