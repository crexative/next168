import type { PlannerDocument, Task, TaskPlacement } from '../model'
import { scheduleTasks } from '../scheduler'
import type { StableScheduleInput } from '../scheduling'
import { taskWindows } from '../schedulingWindows'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from '../time'

// The stable placement as it was at 239b9bc, before the incremental free-time rewrite (P0 spec §3.3): every task is
// placed by the unchanged contract `scheduleTasks`, with every earlier placement passed as busy time. Kept verbatim as
// the oracle for the equivalence tests; it is deliberately slow and never used by the app.

const MINUTE_MS = 60_000
const DEFAULT_SNAP_MINUTES = 5

interface Interval { start: number; end: number }

const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

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

function dueEndOf(task: Pick<Task, 'dueDate'>, timeZone: string): number {
  return task.dueDate ? zonedInstant(addLocalDays(task.dueDate, 1), 0, timeZone).getTime() : Infinity
}

function minutesBeforeDue(placement: TaskPlacement, dueEnd: number): number {
  return placement.chunks.reduce((sum, chunk) => sum + Math.max(0, Math.min(Date.parse(chunk.end), dueEnd) - Date.parse(chunk.start)) / MINUTE_MS, 0)
}

const missesDeadline = (placement: TaskPlacement) => placement.late || placement.overflowMinutes > 0

function withoutCategory(task: Task): Task {
  const free = { ...task }
  delete free.categoryId
  return free
}

export function referenceFitTasks(input: StableScheduleInput): TaskPlacement[] {
  const { document, busy, now, timeZone, days = 7, previous, pinned } = input
  const snapMs = (input.snapMinutes ?? DEFAULT_SNAP_MINUTES) * MINUTE_MS
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
    if (late && dueEnd > now.getTime()) continue
    const shown: TaskPlacement = { taskId: candidate.taskId, chunks: candidate.chunks, overflowMinutes: candidate.overflowMinutes, late }
    kept.set(task.id, outside ? { ...shown, outsideCategory: true } : shown)
    occupied.push(...chunks)
  }

  const rest: TaskPlacement[] = []
  const schedulingBusy = [...snappedBusy, ...[...kept.values()].flatMap((placement) =>
    placement.chunks.map((chunk) => ({ ...chunk, end: snapEnd(chunk.end, snapMs) })))]
  const place = (task: Task): TaskPlacement | undefined => {
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
    schedulingBusy.push(...placement.chunks.map((chunk) => ({ ...chunk, end: snapEnd(chunk.end, snapMs) })))
  }
  const placed = new Map([...rest, ...kept.values()].map((placement) => [placement.taskId, placement]))
  return document.tasks.flatMap((task) => placed.get(task.id) ?? [])
}
