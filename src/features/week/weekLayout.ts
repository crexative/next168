import { MINUTES_PER_DAY, type ExternalOccurrence, type PlannerDocument, type PlannerEvent } from '@/core/model'
import { addLocalDays, datedOccurrences, zonedInstant, type DatedOccurrence } from '@/core/time'
import { localMinuteOf } from './localTime'

export interface DayPart {
  date: string
  startMinute: number
  endMinute: number
  continuesBefore: boolean
  continuesAfter: boolean
}

export interface BlockSegment extends DayPart {
  key: string
  occurrence: DatedOccurrence
  lane: number
  lanes: number
}

export interface BusySegment extends DayPart {
  key: string
  title: string
  kind: 'external' | 'event'
}

// Splits an instant range at local midnights so overnight items render on every day they touch.
export function splitByLocalDay(start: string, end: string, dates: string[], timeZone: string): DayPart[] {
  const startAt = Date.parse(start)
  const endAt = Date.parse(end)
  return dates.flatMap((date) => {
    const dayStart = zonedInstant(date, 0, timeZone).getTime()
    const dayEnd = zonedInstant(addLocalDays(date, 1), 0, timeZone).getTime()
    const from = Math.max(startAt, dayStart)
    const to = Math.min(endAt, dayEnd)
    if (from >= to) return []
    const startMinute = from === dayStart ? 0 : localMinuteOf(from, timeZone)
    const endMinute = to === dayEnd ? MINUTES_PER_DAY : localMinuteOf(to, timeZone)
    if (endMinute <= startMinute) return []
    return [{ date, startMinute, endMinute, continuesBefore: startAt < dayStart, continuesAfter: endAt > dayEnd }]
  })
}

// Side-by-side lanes for items that overlap within one day (overlapping blocks can come from migrated data).
function assignLanes<T extends { startMinute: number; endMinute: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  const result: (T & { lane: number; lanes: number })[] = []
  let cluster: (T & { lane: number; lanes: number })[] = []
  let clusterEnd = -1
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1))
    cluster.forEach((item) => { item.lanes = lanes })
    result.push(...cluster)
    cluster = []
  }
  for (const item of sorted) {
    if (item.startMinute >= clusterEnd) closeCluster()
    const taken = new Set(cluster.filter((other) => other.endMinute > item.startMinute).map((other) => other.lane))
    let lane = 0
    while (taken.has(lane)) lane++
    cluster.push({ ...item, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, item.endMinute)
  }
  closeCluster()
  return result
}

export function blockSegmentsByDate(document: PlannerDocument, dates: string[], timeZone: string): Record<string, BlockSegment[]> {
  const byDate: Record<string, BlockSegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  if (!dates.length) return byDate
  const parts = datedOccurrences(document, dates[0]!, dates.length, timeZone).flatMap((occurrence) =>
    splitByLocalDay(occurrence.start, occurrence.end, dates, timeZone).map((part) => ({
      ...part, key: `${occurrence.blockId}@${occurrence.start}@${part.date}`, occurrence,
    })))
  for (const date of dates) byDate[date] = assignLanes(parts.filter((part) => part.date === date))
  return byDate
}

export function busySegmentsByDate(external: ExternalOccurrence[], events: PlannerEvent[], dates: string[], timeZone: string): Record<string, BusySegment[]> {
  const byDate: Record<string, BusySegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  const timed = [
    ...external.filter((item) => item.busy && !item.allDay).map((item) => ({ key: `${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, start: item.start, end: item.end, kind: 'external' as const })),
    ...events.filter((event) => !event.allDay).map((event) => ({ key: event.id, title: event.title, start: event.start, end: event.end, kind: 'event' as const })),
  ]
  for (const item of timed) {
    for (const part of splitByLocalDay(item.start, item.end, dates, timeZone)) {
      byDate[part.date]?.push({ ...part, key: `${item.key}@${part.date}`, title: item.title, kind: item.kind })
    }
  }
  return byDate
}

export const HOUR_HEIGHT_PX = 48
export const SLOT_MINUTES = 30
