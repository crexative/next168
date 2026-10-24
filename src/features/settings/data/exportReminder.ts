// A weekly nudge to export a backup. Kept only in this browser (the document schema is not touched):
// the time of the last export, of the first visit and of the last "not now".
export const LAST_EXPORT_KEY = 'next168-last-export'
export const FIRST_SEEN_KEY = 'next168-first-seen'
export const SNOOZED_KEY = 'next168-export-snoozed'
export const NUDGE_AFTER_DAYS = 7

const DAY_MS = 86_400_000

export interface NudgeInput {
  lastExport: string | null
  firstSeen: string | null
  snoozedAt: string | null
  now: Date
  hasContent: boolean
}

export type Nudge = { kind: 'never' } | { kind: 'overdue'; days: number }

function timeOf(value: string | null): number | null {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? null : time
}

// Shown once a week has passed since the last export (or, without one, since the first visit or the last
// "not now") and there is something worth saving.
export function exportNudge(input: NudgeInput): Nudge | null {
  if (!input.hasContent) return null
  const last = timeOf(input.lastExport)
  const known = [last, timeOf(input.firstSeen), timeOf(input.snoozedAt)].filter((time): time is number => time !== null)
  if (known.length === 0) return null
  const quietFor = (input.now.getTime() - Math.max(...known)) / DAY_MS
  if (quietFor < NUDGE_AFTER_DAYS) return null
  return last === null ? { kind: 'never' } : { kind: 'overdue', days: Math.floor((input.now.getTime() - last) / DAY_MS) }
}

function read(key: string, storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string, storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(key, value)
  } catch {
    // The reminder is a convenience; without storage it simply does not appear.
  }
}

export function readNudgeInput(now: Date, hasContent: boolean, storage: Pick<Storage, 'getItem'> = window.localStorage): NudgeInput {
  return { lastExport: read(LAST_EXPORT_KEY, storage), firstSeen: read(FIRST_SEEN_KEY, storage), snoozedAt: read(SNOOZED_KEY, storage), now, hasContent }
}

export function noteFirstVisit(now: Date, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): void {
  if (read(FIRST_SEEN_KEY, storage) === null) write(FIRST_SEEN_KEY, now.toISOString(), storage)
}

export function recordExport(now: Date, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  write(LAST_EXPORT_KEY, now.toISOString(), storage)
}

export function snoozeNudge(now: Date, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  write(SNOOZED_KEY, now.toISOString(), storage)
}
