import { MINUTES_PER_DAY, type ExternalOccurrence, type PlannerDocument, type PlannerEvent, type TaskPlacement } from '@/core/model'
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
}

export interface BusySegment extends DayPart {
  key: string
  title: string
  kind: 'external' | 'event'
  // The whole item (it can span days), for the details sheet.
  start: string
  end: string
  calendar?: string
}

export interface LanePosition {
  lane: number
  lanes: number
  // Percentages of the day column, shared by every item in an overlap cluster.
  left: number
  width: number
  // The same item when planned blocks and calendar events are stacked instead of sharing lanes (narrow columns):
  // blocks still share lanes with each other, and so do events, but the two groups overlap.
  stackLeft: number
  stackWidth: number
}

export const STACK_EVENT_INSET_PERCENT = 28

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
    let endMinute = to === dayEnd ? MINUTES_PER_DAY : localMinuteOf(to, timeZone)
    // The repeated hour after a backward clock change makes the wall clock run backwards; keep the elapsed time visible.
    if (endMinute <= startMinute) endMinute = Math.min(MINUTES_PER_DAY, startMinute + Math.max(1, Math.ceil((to - from) / 60_000)))
    if (endMinute <= startMinute) return []
    return [{ date, startMinute, endMinute, continuesBefore: startAt < dayStart, continuesAfter: endAt > dayEnd }]
  })
}

// Side-by-side lanes for items that overlap within one day (overlapping blocks can come from migrated data).
type Lanes = Omit<LanePosition, 'stackLeft' | 'stackWidth'>
function assignLanes<T extends { startMinute: number; endMinute: number }>(items: T[], leadingInset: (cluster: readonly T[]) => number = () => 0): (T & Lanes)[] {
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  const result: (T & Lanes)[] = []
  let cluster: (T & Lanes)[] = []
  let clusterEnd = -1
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1))
    const inset = leadingInset(cluster)
    const width = (100 - inset) / lanes
    cluster.forEach((item) => { item.lanes = lanes; item.left = inset + item.lane * width; item.width = width })
    result.push(...cluster)
    cluster = []
  }
  for (const item of sorted) {
    if (item.startMinute >= clusterEnd) closeCluster()
    const taken = new Set(cluster.filter((other) => other.endMinute > item.startMinute).map((other) => other.lane))
    let lane = 0
    while (taken.has(lane)) lane++
    cluster.push({ ...item, lane, lanes: 1, left: 0, width: 100 })
    clusterEnd = Math.max(clusterEnd, item.endMinute)
  }
  closeCluster()
  return result
}

export function layoutDaySegments(blocks: BlockSegment[], busy: BusySegment[]): {
  blocks: (BlockSegment & LanePosition)[]
  busy: (BusySegment & LanePosition)[]
} {
  const items = assignLanes([
    ...blocks.map((segment) => ({ startMinute: segment.startMinute, endMinute: segment.endMinute, type: 'block' as const, segment })),
    ...busy.map((segment) => ({ startMinute: segment.startMinute, endMinute: segment.endMinute, type: 'busy' as const, segment })),
  ])
  const stacked = new Map<string, Lanes>()
  // Every event in a connected cluster shares the inset so its event lanes stay disjoint.
  const stackedBusy = assignLanes(busy, (cluster) => cluster.some((event) => blocks.some((block) => block.startMinute < event.endMinute && event.startMinute < block.endMinute)) ? STACK_EVENT_INSET_PERCENT : 0)
  for (const item of [...assignLanes(blocks), ...stackedBusy]) stacked.set(item.key, item)
  const result: ReturnType<typeof layoutDaySegments> = { blocks: [], busy: [] }
  for (const item of items) {
    const { lane, lanes, left, width } = item
    const alone = stacked.get(item.segment.key)!
    const position = { lane, lanes, left, width, stackLeft: alone.left, stackWidth: alone.width }
    if (item.type === 'block') result.blocks.push({ ...item.segment, ...position })
    else result.busy.push({ ...item.segment, ...position })
  }
  return result
}

export function blockSegmentsByDate(document: PlannerDocument, dates: string[], timeZone: string): Record<string, BlockSegment[]> {
  const byDate: Record<string, BlockSegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  if (!dates.length) return byDate
  const parts = datedOccurrences(document, dates[0]!, dates.length, timeZone).flatMap((occurrence) =>
    splitByLocalDay(occurrence.start, occurrence.end, dates, timeZone).map((part) => ({
      ...part, key: `${occurrence.blockId}@${occurrence.start}@${part.date}`, occurrence,
    })))
  for (const date of dates) byDate[date] = parts.filter((part) => part.date === date)
  return byDate
}

export function busySegmentsByDate(external: ExternalOccurrence[], events: PlannerEvent[], dates: string[], timeZone: string, calendarNames: ReadonlyMap<string, string> = new Map()): Record<string, BusySegment[]> {
  const byDate: Record<string, BusySegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  const timed = [
    ...external.filter((item) => item.busy && !item.allDay).map((item) => ({ key: `${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, start: item.start, end: item.end, kind: 'external' as const, calendar: calendarNames.get(item.sourceId) })),
    ...events.filter((event) => !event.allDay).map((event) => ({ key: event.id, title: event.title, start: event.start, end: event.end, kind: 'event' as const, calendar: undefined })),
  ]
  for (const item of timed) {
    for (const part of splitByLocalDay(item.start, item.end, dates, timeZone)) {
      byDate[part.date]?.push({ ...part, key: `${item.key}@${part.date}`, title: item.title, kind: item.kind, start: item.start, end: item.end, calendar: item.calendar })
    }
  }
  return byDate
}

// A placed task is drawn inside the planned block it was fitted into.
export interface TaskSegment extends DayPart {
  key: string
  taskId: string
  title: string
  // Undefined for a task that fits any free time.
  categoryId: string | undefined
  late: boolean
}

export function taskSegmentsByDate(placements: readonly TaskPlacement[], tasks: PlannerDocument['tasks'], dates: string[], timeZone: string): Record<string, TaskSegment[]> {
  const byDate: Record<string, TaskSegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const placement of placements) {
    const task = byId.get(placement.taskId)
    if (!task || task.doneAt) continue
    for (const chunk of placement.chunks) {
      for (const part of splitByLocalDay(chunk.start, chunk.end, dates, timeZone)) {
        byDate[part.date]?.push({ ...part, key: `${task.id}@${chunk.start}@${part.date}`, taskId: task.id, title: task.title, categoryId: task.categoryId, late: placement.late })
      }
    }
  }
  return byDate
}

export const HOUR_HEIGHT_PX = 48
export const COMPACT_HOUR_HEIGHT_PX = 16
export const SLOT_MINUTES = 30

// Short items are small to hit: a 30 minute block is 24 px tall. The pressable area of every item is at least 44 px,
// centered on it, so a tap just above or below a short block still opens it.
export const MIN_TARGET_PX = 44

export interface HitTarget {
  kind: 'block' | 'task'
  id: string
  startMinute: number
  endMinute: number
  // The lane the item occupies, in percent of the column's width.
  left: number
  width: number
}

// The item a press at `y` px (from the top of the column) and `xPercent` of the column's width is meant for: of the
// items whose enlarged area holds the press, the one whose center is nearest.
export function nearestHitTarget(targets: readonly HitTarget[], y: number, xPercent: number, hourHeight: number): HitTarget | undefined {
  let best: { target: HitTarget; distance: number } | undefined
  for (const target of targets) {
    if (xPercent < target.left || xPercent > target.left + target.width) continue
    const top = (target.startMinute / 60) * hourHeight
    const bottom = (target.endMinute / 60) * hourHeight
    const grow = Math.max(0, (MIN_TARGET_PX - (bottom - top)) / 2)
    if (y < top - grow || y > bottom + grow) continue
    const distance = Math.abs(y - (top + bottom) / 2)
    if (!best || distance < best.distance) best = { target, distance }
  }
  return best?.target
}
