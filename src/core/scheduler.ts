import type { ScheduleInput, TaskPlacement } from './model'
import { subtract, taskWindows } from './schedulingWindows'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from './time'

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
    const windows = taskWindows(dated, task.categoryId, { start, end: rangeEnd })
    const free = windows.flatMap((window) => subtract(window, occupied))
    let remaining = task.durationMin
    const chunks: TaskPlacement['chunks'] = []
    const dueEnd = task.dueDate ? zonedInstant(addLocalDays(task.dueDate, 1), 0, timeZone).getTime() : Infinity
    let late = dueEnd <= now.getTime()
    for (const window of free) {
      const chunkStart = Math.ceil(window.start / 60000) * 60000
      const available = Math.floor((window.end - chunkStart) / 60000)
      const minutes = Math.min(remaining, available)
      if (minutes < Math.min(10, remaining)) continue
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
