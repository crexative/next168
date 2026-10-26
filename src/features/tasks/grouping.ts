import type { PlacementChunk, PlannerDocument, Task, TaskPlacement } from '@/core/model'
import { addLocalDays, localDateOf } from '@/core/time'

// One entry per task in a day: a placed task sits under the day of its first fragment and lists every fragment, so a
// split task is one row; a fixed start with no length sits at its time (`at`); a to-do due that day has neither.
export interface PlacedEntry {
  task: Task
  chunk?: PlacementChunk
  chunks: PlacementChunk[]
  at?: string
}

export interface DayGroup {
  date: string
  entries: PlacedEntry[]
}

// The Tasks list (tasks design rev 2.1 §11.3): Vencidas · Hoy · days · Más adelante · Sin fecha, so a new task is never
// hidden. `unplaced` holds tasks with a length that found no slot.
export interface TaskPlan {
  overdue: Task[]
  days: DayGroup[]
  later: Task[]
  undated: Task[]
  unplaced: Task[]
  warnings: { task: Task; placement: TaskPlacement }[]
  placements: Map<string, TaskPlacement>
}

export const HORIZON_DAYS = 7

const byCreatedDesc = (a: Task, b: Task) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : 1)
const byDue = (a: Task, b: Task) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.priority - b.priority || byCreatedDesc(b, a)
const entryTime = (entry: PlacedEntry) => (entry.chunk ? Date.parse(entry.chunk.start) : entry.at ? Date.parse(entry.at) : Infinity)

// `today` is the planner's date: with it, past-due tasks and to-dos beyond the horizon get their own sections.
export function planTasks(document: PlannerDocument, placements: TaskPlacement[], today?: string): TaskPlan {
  const timeZone = document.settings.timeZone
  const byTask = new Map(placements.map((placement) => [placement.taskId, placement]))
  const open = document.tasks.filter((task) => !task.doneAt)
  const groups = new Map<string, PlacedEntry[]>()
  const plan: TaskPlan = { overdue: [], days: [], later: [], undated: [], unplaced: [], warnings: [], placements: byTask }
  const horizonEnd = today ? addLocalDays(today, HORIZON_DAYS) : undefined
  const addTo = (date: string, entry: PlacedEntry) => groups.set(date, [...(groups.get(date) ?? []), entry])

  for (const task of open) {
    const placement = byTask.get(task.id)
    if (placement && (placement.overflowMinutes > 0 || placement.late)) plan.warnings.push({ task, placement })
    if (today && task.dueDate !== undefined && task.dueDate < today) {
      plan.overdue.push(task)
      continue
    }
    const chunks = [...(placement?.chunks ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    const first = chunks[0]
    if (first) {
      addTo(localDateOf(first.start, timeZone), { task, chunk: first, chunks })
      continue
    }
    if (placement?.at) {
      addTo(localDateOf(placement.at, timeZone), { task, chunks: [], at: placement.at })
      continue
    }
    if (task.durationMin !== undefined) {
      if (placement) plan.unplaced.push(task)
      continue
    }
    if (task.dueDate === undefined) plan.undated.push(task)
    else if (horizonEnd && task.dueDate >= horizonEnd) plan.later.push(task)
    else addTo(task.dueDate, { task, chunks: [] })
  }

  plan.days = [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([date, entries]) => ({ date, entries: entries.sort((a, b) => entryTime(a) - entryTime(b) || a.task.priority - b.task.priority || byCreatedDesc(b.task, a.task)) }))
  plan.overdue.sort(byDue)
  plan.later.sort(byDue)
  plan.undated.sort(byCreatedDesc)
  return plan
}

export function recentDone(tasks: Task[], limit = 8): Task[] {
  return tasks
    .filter((task) => task.doneAt)
    .sort((a, b) => Date.parse(b.doneAt!) - Date.parse(a.doneAt!))
    .slice(0, limit)
}
