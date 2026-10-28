import type { ExternalOccurrence } from '@/core/model'
import { GOOGLE_SOURCE_ID, MAX_GOOGLE_TITLE_LENGTH, googleTitle, occurrencesWithin, type DateWindow } from '../googleCalendar'

// Google event resources → ExternalOccurrence, the shape ICS calendars already use. Every output field is built
// here one by one: nothing of the raw item (guests, descriptions, locations, links) can pass through.

export const MAX_TITLE_LENGTH = MAX_GOOGLE_TITLE_LENGTH

// RFC 3339 with an explicit offset. A time without one would be read in the browser's zone, which may be neither the
// calendar's nor the planner's: such an event fails the refresh instead of landing at a guessed hour.
const OFFSET_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/

// A date that exists on the calendar: Date.parse would quietly turn 2026-02-30 into 2 March.
function realDate(value: string): boolean {
  if (!CIVIL_DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export type NormalizeResult = { ok: true; occurrences: ExternalOccurrence[] } | { ok: false; code: 'format' }

interface GoogleTime { date?: unknown; dateTime?: unknown }
interface GoogleEvent {
  id?: unknown
  status?: unknown
  summary?: unknown
  start?: GoogleTime
  end?: GoogleTime
  transparency?: unknown
  eventType?: unknown
  attendees?: { self?: unknown; responseStatus?: unknown }[]
  originalStartTime?: GoogleTime
}

class FormatError extends Error {}

function instant(value: unknown): string {
  const parts = typeof value === 'string' ? OFFSET_DATE_TIME.exec(value) : null
  if (!parts || !realDate(parts[1]!)) throw new FormatError()
  const [hour, minute, second, offsetHours = 0, offsetMinutes = 0] = parts.slice(2).map((part) => Number(part ?? 0))
  if (hour! > 23 || minute! > 59 || second! > 59 || offsetHours > 23 || offsetMinutes > 59) throw new FormatError()
  const time = Date.parse(value as string)
  if (!Number.isFinite(time)) throw new FormatError()
  return new Date(time).toISOString()
}

function civilDate(value: unknown): string {
  if (typeof value !== 'string' || !realDate(value)) throw new FormatError()
  return value
}

function timeOf(time: GoogleTime | undefined): { value: string; allDay: boolean } {
  if (time?.dateTime !== undefined) return { value: instant(time.dateTime), allDay: false }
  if (time?.date !== undefined) return { value: civilDate(time.date), allDay: true }
  throw new FormatError()
}

// Hidden as on Google's own grid: cancelled instances, invitations the person declined (their own attendee entry on
// the primary calendar) and working-location markers, which are not time anyone is busy.
function dropped(event: GoogleEvent): boolean {
  if (event.status === 'cancelled' || event.eventType === 'workingLocation') return true
  return Array.isArray(event.attendees) && event.attendees.some((attendee) => attendee?.self === true && attendee.responseStatus === 'declined')
}

function occurrenceOf(event: GoogleEvent): ExternalOccurrence {
  if (typeof event.id !== 'string' || event.id === '') throw new FormatError()
  const start = timeOf(event.start), end = timeOf(event.end)
  if (start.allDay !== end.allDay || end.value < start.value) throw new FormatError()
  if (start.allDay && end.value === start.value) throw new FormatError()
  const original = event.originalStartTime === undefined ? undefined : timeOf(event.originalStartTime).value
  return {
    sourceId: GOOGLE_SOURCE_ID,
    uid: event.id,
    ...(original === undefined ? {} : { recurrenceId: original }),
    title: googleTitle(event.summary),
    start: start.value,
    end: end.value,
    allDay: start.allDay,
    busy: event.transparency !== 'transparent',
  }
}

// The request asks Google for a window one day wider on each side (calendar and planner zones may differ); the
// result keeps only what overlaps the planner's civil dates.
export function normalizeGoogleEvents(items: readonly unknown[], window: DateWindow, timeZone: string): NormalizeResult {
  try {
    const occurrences = items
      .map((item) => (item && typeof item === 'object' ? item as GoogleEvent : {}) as GoogleEvent)
      .filter((event) => !dropped(event))
      .map(occurrenceOf)
    return { ok: true, occurrences: occurrencesWithin(occurrences, window, timeZone) }
  } catch (error) {
    if (error instanceof FormatError) return { ok: false, code: 'format' }
    throw error
  }
}
