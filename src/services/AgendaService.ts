import type { AgendaData, AgendaItem, MoveProposal } from '@/types/agenda'
import { PLANNER_TIMEZONE } from '@/types/agenda'

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
export function isDate(value: unknown): value is string {
  return typeof value === 'string' && datePattern.test(value) && Number(value.slice(0, 4)) >= 2000 &&
    Number(value.slice(0, 4)) <= 2099 && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}
export function todayInBogota(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PLANNER_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: string[], optional: string[] = []) {
  if (Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !(key in value))) throw new Error('Unknown or missing fields')
}
export function validateItem(value: unknown): AgendaItem {
  const item = object(value)
  exactKeys(item, ['id', 'title', 'date', 'startTime', 'endTime', 'kind', 'status', 'flexible', 'calendarSelected'], ['notes', 'checklist', 'budgetCop'])
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 ||
      !isDate(item.date) || typeof item.startTime !== 'string' || !timePattern.test(item.startTime) ||
      typeof item.endTime !== 'string' || !timePattern.test(item.endTime) || item.startTime >= item.endTime ||
      (typeof item.kind !== 'string' || !['task', 'meeting', 'reservation', 'reminder'].includes(item.kind)) ||
      (typeof item.status !== 'string' || !['planned', 'reserved', 'done', 'cancelled'].includes(item.status)) ||
      typeof item.flexible !== 'boolean' || typeof item.calendarSelected !== 'boolean') throw new Error('Invalid agenda item: check date, title and times (same day)')
  if ((item.notes !== undefined && (typeof item.notes !== 'string' || item.notes.length > 2000)) ||
      (item.checklist !== undefined && (!Array.isArray(item.checklist) || item.checklist.length > 100 || item.checklist.some(entry => typeof entry !== 'string' || !entry.trim() || entry.length > 200))) ||
      (item.budgetCop !== undefined && (typeof item.budgetCop !== 'number' || !Number.isFinite(item.budgetCop) || item.budgetCop < 0))) throw new Error('Invalid notes, checklist or budget')
  if (item.calendarSelected && item.kind === 'task') throw new Error('Calendar is reserved for meetings, reservations and chosen reminders')
  if (item.status === 'reserved' && item.kind !== 'reservation' && item.kind !== 'meeting') throw new Error('Only a meeting or reservation can be reserved')
  return { ...item } as unknown as AgendaItem
}
export function validateAgenda(value: unknown): AgendaData {
  const data = object(value)
  exactKeys(data, ['schemaVersion', 'revision', 'timezone', 'workEnd', 'items', 'exports'])
  if (data.schemaVersion !== 1 || data.timezone !== PLANNER_TIMEZONE || typeof data.revision !== 'string' || !data.revision ||
      (typeof data.workEnd !== 'string' || !['17:00', '17:30'].includes(data.workEnd)) || !Array.isArray(data.items) || data.items.length > 5000) throw new Error('Unsupported or invalid agenda backup')
  const items = data.items.map(validateItem)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate agenda IDs')
  const exports = object(data.exports)
  if (Object.entries(exports).some(([id, fingerprint]) => !items.some(item => item.id === id) || typeof fingerprint !== 'string')) throw new Error('Invalid export history')
  const result = { ...data, items, exports: { ...exports } } as unknown as AgendaData
  assertNoConflicts(items)
  return result
}
export function assertNoConflicts(items: AgendaItem[]) {
  const active = items.filter(item => item.status !== 'cancelled')
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!
    for (const b of active.slice(i + 1)) {
      if (a.date === b.date && a.startTime < b.endTime && a.endTime > b.startTime) throw new Error(`Local conflict: ${a.title} / ${b.title}`)
    }
  }
}
export function emptyAgenda(): AgendaData {
  return { schemaVersion: 1, revision: crypto.randomUUID(), timezone: PLANNER_TIMEZONE, workEnd: '17:00', items: [], exports: {} }
}
export function isMovable(item: AgendaItem) {
  return item.status === 'planned' && item.flexible && (item.kind === 'task' || item.kind === 'reminder')
}
export function previewMoves(data: AgendaData, input: unknown): AgendaData {
  const proposal = object(input)
  exactKeys(proposal, ['schemaVersion', 'baseRevision', 'moves'])
  if (proposal.schemaVersion !== 1 || proposal.baseRevision !== data.revision || !Array.isArray(proposal.moves) || !proposal.moves.length || proposal.moves.length > 100) throw new Error('Invalid or stale proposal; request a new proposal')
  const seen = new Set<string>()
  const items = data.items.map(item => ({ ...item }))
  for (const raw of proposal.moves) {
    const move = object(raw)
    exactKeys(move, ['id', 'date', 'startTime', 'endTime'])
    const item = items.find(item => item.id === move.id)
    if (!item || seen.has(item.id) || !isMovable(item)) throw new Error('Move requires a unique, flexible pending task or reminder')
    seen.add(item.id)
    Object.assign(item, validateItem({ ...item, ...move }))
  }
  assertNoConflicts(items)
  return { ...data, items }
}
export function proposalRequest(data: AgendaData) {
  return { schemaVersion: 1, baseRevision: data.revision, timezone: data.timezone,
    calendarAccess: 'unavailable', externalAvailability: 'unknown', workWindow: { days: [1, 2, 3, 4, 5], start: '08:30', end: data.workEnd, policy: 'flexible; preserve commitments' },
    items: data.items, responseContract: { schemaVersion: 1, baseRevision: data.revision, moves: [{ id: 'existing-pending-item-id', date: 'YYYY-MM-DD', startTime: 'HH:mm', endTime: 'HH:mm' }] } }
}
export function workWarnings(data: AgendaData): string[] {
  return data.items.filter(item => {
    const day = new Date(`${item.date}T12:00:00Z`).getUTCDay()
    return day >= 1 && day <= 5 && !['done', 'cancelled'].includes(item.status) && item.startTime < data.workEnd && item.endTime > '08:30'
  }).map(item => `${item.title}: within the flexible work window 08:30–${data.workEnd}`)
}
export function moveProposal(data: AgendaData, move: MoveProposal['moves'][number]): MoveProposal {
  return { schemaVersion: 1, baseRevision: data.revision, moves: [move] }
}
