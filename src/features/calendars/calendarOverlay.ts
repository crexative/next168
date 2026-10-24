import type { BusyInterval, ExternalOccurrence, PlannerDocument } from '@/core/model'
import type { CalendarRange } from '@/core/icsImport'
import { datedOccurrences, localDateOf, zonedInstant } from '@/core/time'

export const occurrenceKey = (event: ExternalOccurrence): string => JSON.stringify([event.sourceId, event.uid, event.recurrenceId ?? ''])
export function externalInterval(event: ExternalOccurrence, timeZone: string): BusyInterval {
  return event.allDay ? { start: zonedInstant(event.start, 0, timeZone).toISOString(), end: zonedInstant(event.end, 0, timeZone).toISOString() } : { start: event.start, end: event.end }
}
const intersects = (left: BusyInterval, right: BusyInterval) => Date.parse(left.start) < Date.parse(right.end) && Date.parse(right.start) < Date.parse(left.end)

export function calendarOverlay(document: PlannerDocument, events: ExternalOccurrence[], range: CalendarRange) {
  const zone = document.settings.timeZone
  const start = range.start.length === 10 ? range.start : localDateOf(range.start, zone)
  const end = range.end.length === 10 ? range.end : localDateOf(range.end, zone)
  const days = Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / 86400000) + (range.end.length > 10 ? 1 : 0))
  const blocks = datedOccurrences(document, start, Math.min(days, 366), zone)
  const externalBusy = events.filter(event => event.busy).map(event => ({ event, interval: externalInterval(event, zone) }))
  const plannerBusy = document.events.map(event => event.allDay ? { start: zonedInstant(event.start.slice(0, 10), 0, zone).toISOString(), end: zonedInstant(event.end.slice(0, 10), 0, zone).toISOString() } : { start: event.start, end: event.end })
  const conflicts = externalBusy.filter(({ interval }) => blocks.some(block => intersects(block, interval))).map(({ event }) => event)
  return {
    events,
    busy: externalBusy.map(({ interval }) => interval),
    conflicts,
    conflictingBlockIds: blocks.filter(block => [...externalBusy.map(({ interval }) => interval), ...plannerBusy].some(interval => intersects(block, interval))).map(block => block.blockId).filter((id, index, ids) => ids.indexOf(id) === index),
  }
}
