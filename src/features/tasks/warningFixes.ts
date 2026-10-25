import type { BusyInterval, PlannerDocument, Task, TaskPlacement } from '@/core/model'
import { fitTasks } from '@/core/scheduling'
import { datedOccurrences, localDateOf } from '@/core/time'

// The one-tap fixes a "doesn't fit" warning offers. Each is tried on a copy of the planner first and offered only
// when it really puts the task on time, so no button leads to the same warning.
export interface FitContext { document: PlannerDocument; busy: BusyInterval[]; now: Date }

export interface WarningFixes {
  // "Do it today": the task becomes due today, so it goes in today's free time when its category has no room.
  today?: string
  // "Move to <date>": the due date becomes the day the task actually ends.
  moveDueTo?: string
}

const onTime = (placement: TaskPlacement | undefined): boolean =>
  placement !== undefined && placement.chunks.length > 0 && placement.overflowMinutes === 0 && !placement.late

function placementIfDue(context: FitContext, task: Task, dueDate: string): TaskPlacement | undefined {
  const document = { ...context.document, tasks: context.document.tasks.map((candidate) => candidate.id === task.id ? { ...candidate, dueDate } : candidate) }
  return fitTasks({ document, busy: context.busy, now: context.now, timeZone: document.settings.timeZone }).find((placement) => placement.taskId === task.id)
}

export function warningFixes(context: FitContext, task: Task, placement: TaskPlacement): WarningFixes {
  const timeZone = context.document.settings.timeZone
  const today = localDateOf(context.now, timeZone)
  const fixes: WarningFixes = {}
  if (task.dueDate !== today && onTime(placementIfDue(context, task, today))) fixes.today = today
  if (placement.late && placement.overflowMinutes === 0 && placement.chunks.length) {
    const lastEnd = Math.max(...placement.chunks.map((chunk) => Date.parse(chunk.end)))
    const endsOn = localDateOf(new Date(lastEnd - 1), timeZone)
    if (endsOn > (task.dueDate ?? '') && endsOn !== fixes.today && onTime(placementIfDue(context, task, endsOn))) fixes.moveDueTo = endsOn
  }
  return fixes
}

// Why a task sits in free time instead of its category: no block of it today, or not enough of it before the deadline.
export function outsideCategoryReason(document: PlannerDocument, task: Task, placement: TaskPlacement, now: Date): 'noBlockToday' | 'notEnough' | undefined {
  if (!placement.outsideCategory || task.categoryId === undefined) return undefined
  const timeZone = document.settings.timeZone
  const today = localDateOf(now, timeZone)
  const first = placement.chunks[0]
  const blockToday = datedOccurrences(document, today, 1, timeZone).some((item) => item.categoryId === task.categoryId && item.date === today)
  return first && localDateOf(first.start, timeZone) === today && !blockToday ? 'noBlockToday' : 'notEnough'
}
