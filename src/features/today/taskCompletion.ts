import type { PlannerDocument, Task } from '@/core/model'
import { assertEntry, snapshotOf } from '@/features/insights/entryGuard'

// Completing stamps `doneAt`; the returned snapshot binds the undo to exactly the entry this action left behind.
export function completeTask(draft: PlannerDocument, taskId: string, at: Date): string | undefined {
  const task = draft.tasks.find((candidate) => candidate.id === taskId)
  if (!task || task.doneAt) return undefined
  task.doneAt = at.toISOString()
  return snapshotOf(task)
}

export function reopenTask(draft: PlannerDocument, task: Pick<Task, 'id'>, expected: string | undefined): void {
  const target = draft.tasks.find((candidate) => candidate.id === task.id)
  if (!target) return
  assertEntry(target, expected)
  delete target.doneAt
}
