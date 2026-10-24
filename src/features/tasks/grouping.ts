import type { PlacementChunk, PlannerDocument, Task, TaskPlacement } from '@/core/model'
import { localDateOf } from '@/core/time'

// One entry per task: it sits under the day of its first fragment and lists every fragment, so a split task is one row.
export interface PlacedEntry {
  task: Task
  chunk: PlacementChunk
  chunks: PlacementChunk[]
}

export interface DayGroup {
  date: string
  entries: PlacedEntry[]
}

export interface TaskPlan {
  days: DayGroup[]
  unplaced: Task[]
  warnings: { task: Task; placement: TaskPlacement }[]
  placements: Map<string, TaskPlacement>
}

export function planTasks(document: PlannerDocument, placements: TaskPlacement[]): TaskPlan {
  const timeZone = document.settings.timeZone
  const byTask = new Map(placements.map((placement) => [placement.taskId, placement]))
  const open = document.tasks.filter((task) => !task.doneAt)
  const groups = new Map<string, PlacedEntry[]>()
  const unplaced: Task[] = []
  const warnings: TaskPlan['warnings'] = []

  for (const task of open) {
    const placement = byTask.get(task.id)
    if (!placement) continue
    if (placement.chunks.length === 0) unplaced.push(task)
    if (placement.overflowMinutes > 0 || placement.late) warnings.push({ task, placement })
    const chunks = [...placement.chunks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    const first = chunks[0]
    if (!first) continue
    const date = localDateOf(first.start, timeZone)
    groups.set(date, [...(groups.get(date) ?? []), { task, chunk: first, chunks }])
  }

  const days = [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => Date.parse(a.chunk.start) - Date.parse(b.chunk.start)) }))
  return { days, unplaced, warnings, placements: byTask }
}

export function recentDone(tasks: Task[], limit = 8): Task[] {
  return tasks
    .filter((task) => task.doneAt)
    .sort((a, b) => Date.parse(b.doneAt!) - Date.parse(a.doneAt!))
    .slice(0, limit)
}
