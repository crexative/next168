import { MINUTES_PER_DAY, type ExternalOccurrence, type PlannerDocument, type PlannerEvent, type TaskPlacement } from '@/core/model'
import { addLocalDays, datedOccurrences, zonedInstant, type DatedOccurrence } from '@/core/time'
import { chunkIsLate } from '@/core/scheduling'
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
  // A Next168 event's own place and notes.
  location?: string
  notes?: string
}

export interface LanePosition {
  lane: number
  lanes: number
  // Percentages of the day column, shared by every item in an overlap cluster.
  left: number
  width: number
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
    let endMinute = to === dayEnd ? MINUTES_PER_DAY : localMinuteOf(to, timeZone)
    // The repeated hour after a backward clock change makes the wall clock run backwards; keep the elapsed time visible.
    if (endMinute <= startMinute) endMinute = Math.min(MINUTES_PER_DAY, startMinute + Math.max(1, Math.ceil((to - from) / 60_000)))
    if (endMinute <= startMinute) return []
    return [{ date, startMinute, endMinute, continuesBefore: startAt < dayStart, continuesAfter: endAt > dayEnd }]
  })
}

// Side-by-side lanes for items that overlap within one day (Apple Calendar): routines, calendar events and tasks in
// free time share the column's width, so nothing is ever drawn over a routine's title or another item's text.
function assignLanes<T extends { startMinute: number; endMinute: number }>(items: T[]): (T & LanePosition)[] {
  const sorted = [...items].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)
  const result: (T & LanePosition)[] = []
  let cluster: (T & LanePosition)[] = []
  let clusterEnd = -1
  const closeCluster = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1))
    const width = 100 / lanes
    cluster.forEach((item) => { item.lanes = lanes; item.left = item.lane * width; item.width = width })
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

export function layoutDaySegments<L extends { key: string; startMinute: number; endMinute: number } = never>(blocks: BlockSegment[], busy: BusySegment[], loose: L[] = []): {
  blocks: (BlockSegment & LanePosition)[]
  busy: (BusySegment & LanePosition)[]
  loose: (L & LanePosition)[]
} {
  const items = assignLanes([
    ...blocks.map((segment) => ({ startMinute: segment.startMinute, endMinute: segment.endMinute, type: 'block' as const, segment })),
    ...busy.map((segment) => ({ startMinute: segment.startMinute, endMinute: segment.endMinute, type: 'busy' as const, segment })),
    ...loose.map((segment) => ({ startMinute: segment.startMinute, endMinute: segment.endMinute, type: 'loose' as const, segment })),
  ])
  const result: ReturnType<typeof layoutDaySegments<L>> = { blocks: [], busy: [], loose: [] }
  for (const item of items) {
    const position = { lane: item.lane, lanes: item.lanes, left: item.left, width: item.width }
    if (item.type === 'block') result.blocks.push({ ...item.segment, ...position })
    else if (item.type === 'busy') result.busy.push({ ...item.segment, ...position })
    else result.loose.push({ ...item.segment, ...position })
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

export const INSTANT_EVENT_MINUTES = 15

export function busySegmentsByDate(external: ExternalOccurrence[], events: PlannerEvent[], dates: string[], timeZone: string, calendarNames: ReadonlyMap<string, string> = new Map()): Record<string, BusySegment[]> {
  const byDate: Record<string, BusySegment[]> = Object.fromEntries(dates.map((date) => [date, []]))
  const timed = [
    ...external.filter((item) => item.busy && !item.allDay).map((item) => ({ key: `${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, start: item.start, end: item.end, kind: 'external' as const, calendar: calendarNames.get(item.sourceId), location: undefined, notes: undefined })),
    ...events.filter((event) => !event.allDay).map((event) => ({ key: event.id, title: event.title, start: event.start, end: event.end, kind: 'event' as const, calendar: undefined, location: event.location, notes: event.notes })),
  ]
  for (const item of timed) {
    // An event with no duration (a reminder in an imported calendar) still takes a short visible span, as in Apple
    // Calendar; its details keep the real times.
    const shownEnd = Date.parse(item.end) > Date.parse(item.start) ? item.end : new Date(Date.parse(item.start) + INSTANT_EVENT_MINUTES * 60_000).toISOString()
    for (const part of splitByLocalDay(item.start, shownEnd, dates, timeZone)) {
      byDate[part.date]?.push({ ...part, key: `${item.key}@${part.date}`, title: item.title, kind: item.kind, start: item.start, end: item.end, calendar: item.calendar, ...(item.location ? { location: item.location } : {}), ...(item.notes ? { notes: item.notes } : {}) })
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
        byDate[part.date]?.push({ ...part, key: `${task.id}@${chunk.start}@${part.date}`, taskId: task.id, title: task.title, categoryId: task.categoryId, late: chunkIsLate(task, chunk, timeZone) })
      }
    }
  }
  return byDate
}

export type TaskBox = { top: number; bottom: number; outline: boolean }

// Places, in pixels, the tasks drawn in one host (a routine, or a stretch of free time) together, so none covers another:
// each starts at its own time or below the host's title strip and the task before it, keeps at least its minimum height
// (`min`, one value for all or one per task), and stays inside the host. When the host cannot hold every task at its
// minimum below the strip, each is drawn as an outline over the whole host instead (the outline takes no pointer input,
// so the routine stays the target).
export function placeTasks(tasks: readonly { top: number; bottom: number }[], host: { top: number; bottom: number; strip: number }, min: number | readonly number[]): TaskBox[] {
  const minOf = (index: number) => typeof min === 'number' ? min : min[index]!
  const order = tasks.map((task, index) => ({ index, top: task.top, bottom: task.bottom, min: minOf(index) })).sort((a, b) => a.top - b.top || a.bottom - b.bottom)
  const boxes: TaskBox[] = new Array(tasks.length)
  if (order.reduce((sum, task) => sum + task.min, 0) > host.bottom - host.top - host.strip + 0.01) {
    for (const task of order) boxes[task.index] = { top: host.top, bottom: host.bottom, outline: true }
    return boxes
  }
  let floor = host.top + host.strip
  for (const task of order) {
    task.top = Math.max(task.top, floor)
    task.bottom = Math.max(task.bottom, task.top + task.min)
    floor = task.bottom
  }
  let ceiling = host.bottom
  for (const task of [...order].reverse()) {
    task.bottom = Math.min(task.bottom, ceiling)
    task.top = Math.min(task.top, task.bottom - task.min)
    ceiling = task.top
  }
  for (const task of order) boxes[task.index] = { top: task.top, bottom: task.bottom, outline: false }
  return boxes
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
