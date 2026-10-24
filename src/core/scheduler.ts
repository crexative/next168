import type { ScheduleInput, TaskPlacement } from './model'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from './time'

type Interval = { start: number; end: number }
function mergeIntervals(intervals: Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const interval of intervals.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else if (interval.end > interval.start) merged.push({ ...interval })
  }
  return merged
}
function subtract(interval: Interval, busy: Interval[]): Interval[] {
  let free = [interval]
  for (const occupied of busy) {
    free = free.flatMap((window) => {
      if (occupied.start >= window.end || occupied.end <= window.start) return [window]
      const parts: Interval[] = []
      if (occupied.start > window.start) parts.push({ start: window.start, end: occupied.start })
      if (occupied.end < window.end) parts.push({ start: occupied.end, end: window.end })
      return parts
    })
  }
  return free
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function scheduleTasks({ document, busy, now, timeZone, days = 7 }: ScheduleInput): TaskPlacement[] {
  const fromDate = localDateOf(now, timeZone)
  const rangeEnd = zonedInstant(addLocalDays(fromDate, days), 0, timeZone).getTime()
  const start = Math.ceil(now.getTime() / 60000) * 60000
  const dated = datedOccurrences(document, fromDate, days, timeZone)
  const occupied = [...busy, ...document.events].map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) }))
  if (occupied.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start)) throw new Error('scheduler.invalidBusy')
  const tasks = document.tasks.filter((task) => !task.doneAt).sort((a, b) =>
    compare(a.dueDate ?? '9999-12-31', b.dueDate ?? '9999-12-31') || a.priority - b.priority || (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || compare(a.id, b.id))
  return tasks.map((task) => {
    const windows = mergeIntervals(dated.filter((item) => item.categoryId === task.categoryId).map((item) => ({ start: Math.max(start, Date.parse(item.start)), end: Math.min(rangeEnd, Date.parse(item.end)) })))
    const free = windows.flatMap((window) => subtract(window, occupied))
    let remaining = task.durationMin
    const chunks: TaskPlacement['chunks'] = []
    const dueEnd = task.dueDate ? zonedInstant(addLocalDays(task.dueDate, 1), 0, timeZone).getTime() : Infinity
    let late = dueEnd <= now.getTime()
    for (const window of free) {
      const chunkStart = Math.ceil(window.start / 60000) * 60000
      const available = Math.floor((window.end - chunkStart) / 60000)
      const minutes = Math.min(remaining, available)
      if (minutes < 10) continue
      const chunkEnd = chunkStart + minutes * 60000
      chunks.push({ start: new Date(chunkStart).toISOString(), end: new Date(chunkEnd).toISOString() })
      occupied.push({ start: chunkStart, end: chunkEnd })
      remaining -= minutes
      if (chunkEnd > dueEnd) late = true
      if (!remaining) break
    }
    return { taskId: task.id, chunks, overflowMinutes: remaining, late }
  })
}
