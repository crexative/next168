import type { PlannerDocument, ScheduleInput, Task, TaskPlacement } from './model'
import { scheduleTasks } from './scheduler'
import { taskWindows } from './schedulingWindows'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from './time'

// Stable task placement on top of scheduleTasks:
// - chunks start on a five-minute grid at block boundaries, after "now", and after busy intervals or tasks;
// - a placement that was shown before is kept while it is still valid, so a task does not slide along with the clock.
// - a task's category is a preference, not a wall, when its deadline is at stake: when the category's blocks cannot
//   hold it before its due date, it goes to free time (no routine block) if that does more of it before the deadline.
// fitTasks is the one way Today, Week, Tasks and the assistant fit tasks into free time, so a task shows the same
// start everywhere ("12:35", never the minute the plan happened to be recalculated).

export const PLACEMENT_STEP_MINUTES = 5
export const PLACEMENT_SNAP_MINUTES = PLACEMENT_STEP_MINUTES

const MINUTE_MS = 60_000

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

function mergedWindows(document: PlannerDocument, categoryId: string | undefined, fromDate: string, days: number, timeZone: string): Interval[] {
  const occurrences = datedOccurrences(document, fromDate, days, timeZone)
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
  const snappedDocument: PlannerDocument = { ...document, events: document.events.map((event) => ({ ...event, end: snapEnd(event.end, snapMs) })) }
  const snappedBusy = busy.map((item) => ({ ...item, end: snapEnd(item.end, snapMs) }))
  const fromDate = localDateOf(now, timeZone)

  const occupied: Interval[] = [...snappedBusy, ...snappedDocument.events].map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
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
    const windows = mergedWindows(document, outside ? undefined : task.categoryId, fromDate, days, timeZone)
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

  const rest: TaskPlacement[] = []
  const schedulingBusy = [...snappedBusy, ...[...kept.values()].flatMap((placement) =>
    placement.chunks.map((chunk) => ({ ...chunk, end: snapEnd(chunk.end, snapMs) })))]
  const place = (task: Task): TaskPlacement | undefined => {
    // Exclude the lead-in to the next grid point without moving block ends or changing the local-day horizon.
    const leadIns = mergedWindows(document, task.categoryId, fromDate, days, timeZone).flatMap((window) => {
      const start = Math.max(window.start, now.getTime())
      const end = Math.min(window.end, ceilTo(start, snapMs))
      return end > start ? [{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }] : []
    })
    return scheduleTasks({
      document: { ...snappedDocument, tasks: [task] },
      busy: [...schedulingBusy, ...leadIns], now, timeZone, days,
    })[0]
  }
  for (const task of open) {
    if (kept.has(task.id)) continue
    let placement = place(task)
    if (!placement) continue
    if (task.categoryId !== undefined && task.dueDate !== undefined && missesDeadline(placement)) {
      const dueEnd = dueEndOf(task, timeZone)
      const free = place(withoutCategory(task))
      if (free && minutesBeforeDue(free, dueEnd) > minutesBeforeDue(placement, dueEnd)) placement = { ...free, taskId: task.id, outsideCategory: true }
    }
    rest.push(placement)
    // Reserve through the next grid point before placing another task; durations themselves stay exact.
    schedulingBusy.push(...placement.chunks.map((chunk) => ({ ...chunk, end: snapEnd(chunk.end, snapMs) })))
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
