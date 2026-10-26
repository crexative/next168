import type { PlacementChunk, ScheduleInput, Task, TaskPlacement } from './model'
import { subtract, taskWindows } from './schedulingWindows'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant, type DatedOccurrence } from './time'

// Stable task placement, with the same rules as scheduleTasks for each task:
// - chunks start on a five-minute grid at block boundaries, after "now", and after busy intervals or tasks;
// - a placement that was shown before is kept while it is still valid, so a task does not slide along with the clock.
// - a task's category is a preference, not a wall, when its deadline is at stake: when the category's blocks cannot
//   hold it before its due date, it goes to free time (no routine block) if that does more of it before the deadline.
// fitTasks is the one way Today, Week, Tasks and the assistant fit tasks into free time, so a task shows the same
// start everywhere ("12:35", never the minute the plan happened to be recalculated).

export const PLACEMENT_STEP_MINUTES = 5
export const PLACEMENT_SNAP_MINUTES = PLACEMENT_STEP_MINUTES

const MINUTE_MS = 60_000
// Shorter chunks are allowed only when they finish the task.
const MIN_CHUNK_MINUTES = 10

export interface StableScheduleInput extends ScheduleInput {
  snapMinutes?: number
  // Placements shown before, by task id. Kept while every chunk is still in the future (or under way) and still fits.
  previous?: ReadonlyMap<string, TaskPlacement>
  // Placements the user asked to keep (Undo). Kept until the end of the local day, even once their time has passed.
  pinned?: ReadonlyMap<string, TaskPlacement>
}

export interface MovedTask { taskId: string; from: string; to: string }

interface Interval { start: number; end: number }

const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step
const hasWholeMinute = (window: Interval) => Math.floor((window.end - ceilTo(window.start, MINUTE_MS)) / MINUTE_MS) >= 1

// Tasks are fitted from this instant on: now, rounded up to the next five minutes (exactly on a step stays put).
export function placementClock(now: Date): Date {
  return new Date(ceilTo(now.getTime(), PLACEMENT_STEP_MINUTES * MINUTE_MS))
}

function snapEnd(iso: string, snapMs: number): string {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? new Date(ceilTo(at, snapMs)).toISOString() : iso
}

function inside(chunk: Interval, windows: Interval[]): boolean {
  return windows.some((window) => window.start <= chunk.start && chunk.end <= window.end)
}

function mergedWindows(occurrences: readonly DatedOccurrence[], categoryId: string | undefined, fromDate: string, days: number, timeZone: string): Interval[] {
  if (categoryId === undefined) {
    // A task with no category fits anywhere in the horizon that no routine block covers.
    const range = { start: zonedInstant(fromDate, 0, timeZone).getTime(), end: zonedInstant(addLocalDays(fromDate, days), 0, timeZone).getTime() }
    return taskWindows(occurrences, undefined, range)
  }
  const merged: Interval[] = []
  const windows = occurrences
    .filter((item) => item.categoryId === categoryId)
    .map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
    .sort((a, b) => a.start - b.start)
  for (const window of windows) {
    const last = merged[merged.length - 1]
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end)
    else merged.push({ ...window })
  }
  return merged
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// The end of a task's due date in the planner's zone (exclusive); no due date never ends.
export function dueEndOf(task: Pick<Task, 'dueDate'>, timeZone: string): number {
  return task.dueDate ? zonedInstant(addLocalDays(task.dueDate, 1), 0, timeZone).getTime() : Infinity
}

// Lateness is per piece: a piece that ends by the end of its task's due date (planner zone) is on time even when a
// later piece of the same task is not. The task-level `late` (and its warning) stays as it is.
export function chunkIsLate(task: Pick<Task, 'dueDate'>, chunk: PlacementChunk, timeZone: string): boolean {
  return Date.parse(chunk.end) > dueEndOf(task, timeZone)
}

// Minutes of a placement that are done before its task's deadline.
export function minutesBeforeDue(placement: TaskPlacement, dueEnd: number): number {
  return placement.chunks.reduce((sum, chunk) => sum + Math.max(0, Math.min(Date.parse(chunk.end), dueEnd) - Date.parse(chunk.start)) / MINUTE_MS, 0)
}

const missesDeadline = (placement: TaskPlacement) => placement.late || placement.overflowMinutes > 0

function withoutCategory(task: Task): Task {
  const free = { ...task }
  delete free.categoryId
  return free
}

export function scheduleStable(input: StableScheduleInput): TaskPlacement[] {
  const { document, busy, now, timeZone, days = 7, previous, pinned } = input
  const snapMs = (input.snapMinutes ?? PLACEMENT_SNAP_MINUTES) * MINUTE_MS
  const snappedEvents = document.events.map((event) => ({ ...event, end: snapEnd(event.end, snapMs) }))
  const snappedBusy = busy.map((item) => ({ ...item, end: snapEnd(item.end, snapMs) }))
  const fromDate = localDateOf(now, timeZone)
  // The routine occurrences of the horizon, worked out once per call (never cached across calls: routines change).
  const dated = datedOccurrences(document, fromDate, days, timeZone)

  const staticBusy: Interval[] = [...snappedBusy, ...snappedEvents].map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
  const occupied = [...staticBusy]
  const kept = new Map<string, TaskPlacement>()
  const open = document.tasks.filter((task) => !task.doneAt).sort((a, b) =>
    compare(a.dueDate ?? '9999-12-31', b.dueDate ?? '9999-12-31') || a.priority - b.priority
    || (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || compare(a.id, b.id))

  for (const task of open) {
    const pin = pinned?.get(task.id)
    const candidate = pin ?? previous?.get(task.id)
    if (!candidate || candidate.overflowMinutes !== 0 || !candidate.chunks.length) continue
    const chunks = candidate.chunks.map((chunk) => ({ start: Date.parse(chunk.start), end: Date.parse(chunk.end) }))
    const minutes = chunks.reduce((sum, chunk) => sum + (chunk.end - chunk.start) / MINUTE_MS, 0)
    // A placement made in free time for a deadline stays valid in free time while the task keeps both.
    const outside = candidate.outsideCategory === true && task.categoryId !== undefined && task.dueDate !== undefined
    const windows = mergedWindows(dated, outside ? undefined : task.categoryId, fromDate, days, timeZone)
    const stillAhead = pin
      ? chunks.every((chunk) => localDateOf(new Date(chunk.start), timeZone) === fromDate)
      : chunks.every((chunk) => chunk.end > now.getTime())
    const fits = chunks.every((chunk) => chunk.start === ceilTo(chunk.start, snapMs) && chunk.end > chunk.start && inside(chunk, windows)
      && !occupied.some((other) => chunk.start < other.end && other.start < chunk.end))
    if (!stillAhead || !fits || minutes !== task.durationMin) continue
    const dueEnd = dueEndOf(task, timeZone)
    const late = dueEnd <= now.getTime() || chunks.some((chunk) => chunk.end > dueEnd)
    // A placement that misses a deadline still ahead is fitted again: the deadline may have just moved.
    if (late && dueEnd > now.getTime()) continue
    const shown: TaskPlacement = { taskId: candidate.taskId, chunks: candidate.chunks, overflowMinutes: candidate.overflowMinutes, late }
    kept.set(task.id, outside ? { ...shown, outsideCategory: true } : shown)
    occupied.push(...chunks)
  }

  // Free time per category (or "any free time"), built the first time a task needs it from everything already busy,
  // then carved by each placement. Removing busy time piece by piece leaves the same windows as removing it at once,
  // so every task gets exactly the free time scheduleTasks would give it, without redoing the earlier placements.
  const rangeStart = ceilTo(now.getTime(), MINUTE_MS)
  const rangeEnd = zonedInstant(addLocalDays(fromDate, days), 0, timeZone).getTime()
  const reserve = (placement: TaskPlacement) => placement.chunks.map((chunk) => ({ start: Date.parse(chunk.start), end: Date.parse(snapEnd(chunk.end, snapMs)) }))
  const reserved = [...staticBusy, ...[...kept.values()].flatMap(reserve)]
  const freeByKey = new Map<string | undefined, Interval[]>()
  const freeTimeOf = (categoryId: string | undefined): Interval[] => {
    const cached = freeByKey.get(categoryId)
    if (cached) return cached
    if (reserved.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start)) throw new Error('scheduler.invalidBusy')
    // Exclude the lead-in to the next grid point without moving block ends or changing the local-day horizon.
    const leadIns = mergedWindows(dated, categoryId, fromDate, days, timeZone).flatMap((window) => {
      const start = Math.max(window.start, now.getTime())
      const end = Math.min(window.end, ceilTo(start, snapMs))
      return end > start ? [{ start, end }] : []
    })
    const busyTime = [...reserved, ...leadIns]
    const free = taskWindows(dated, categoryId, { start: rangeStart, end: rangeEnd }).flatMap((window) => subtract(window, busyTime)).filter(hasWholeMinute)
    freeByKey.set(categoryId, free)
    return free
  }
  // Keep even short windows: they can hold a whole remaining task, including its last piece.
  // Chunks start on the minute, take at least min(10, remaining) minutes, and are late past the due date.
  const place = (task: Task): TaskPlacement => {
    const dueEnd = dueEndOf(task, timeZone)
    let remaining = task.durationMin
    let late = dueEnd <= now.getTime()
    const chunks: PlacementChunk[] = []
    for (const window of freeTimeOf(task.categoryId)) {
      const chunkStart = ceilTo(window.start, MINUTE_MS)
      const minutes = Math.min(remaining, Math.floor((window.end - chunkStart) / MINUTE_MS))
      if (minutes < Math.min(MIN_CHUNK_MINUTES, remaining)) continue
      const chunkEnd = chunkStart + minutes * MINUTE_MS
      chunks.push({ start: new Date(chunkStart).toISOString(), end: new Date(chunkEnd).toISOString() })
      remaining -= minutes
      if (chunkEnd > dueEnd) late = true
      if (!remaining) break
    }
    return { taskId: task.id, chunks, overflowMinutes: remaining, late }
  }
  // Reserve through the next grid point before placing another task; durations themselves stay exact.
  const commit = (placement: TaskPlacement) => {
    for (const interval of reserve(placement)) {
      reserved.push(interval)
      for (const [key, free] of freeByKey) freeByKey.set(key, free.flatMap((window) => subtract(window, [interval])).filter(hasWholeMinute))
    }
  }

  const rest: TaskPlacement[] = []
  for (const task of open) {
    if (kept.has(task.id)) continue
    let placement = place(task)
    if (task.categoryId !== undefined && task.dueDate !== undefined && missesDeadline(placement)) {
      const dueEnd = dueEndOf(task, timeZone)
      const free = place(withoutCategory(task))
      if (minutesBeforeDue(free, dueEnd) > minutesBeforeDue(placement, dueEnd)) placement = { ...free, taskId: task.id, outsideCategory: true }
    }
    rest.push(placement)
    commit(placement)
  }
  const placed = new Map([...rest, ...kept.values()].map((placement) => [placement.taskId, placement]))
  return document.tasks.flatMap((task) => placed.get(task.id) ?? [])
}

// Fits the open tasks into free time on the shared five-minute grid: a new chunk starts at the next grid point
// after now. `now` itself stays exact, so a placement under way is kept until it really ends.
export function fitTasks(input: StableScheduleInput): TaskPlacement[] {
  return scheduleStable(input)
}

// A task that was set for today and now starts on a later day has "moved on".
export function movedOnFromToday(previous: ReadonlyMap<string, TaskPlacement>, next: readonly TaskPlacement[], today: string, timeZone: string): MovedTask[] {
  const moved: MovedTask[] = []
  for (const placement of next) {
    const before = previous.get(placement.taskId)?.chunks[0]
    const after = placement.chunks[0]
    if (!before || !after) continue
    const from = localDateOf(before.start, timeZone)
    const to = localDateOf(after.start, timeZone)
    if (from === today && to > today) moved.push({ taskId: placement.taskId, from, to })
  }
  return moved
}
