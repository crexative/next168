import { useI18n } from 'vue-i18n'
import type { Task } from '@/core/model'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import { useUndoToast } from '@/ui/undoToast'

// Completing, reopening and removing a task, each with an undo that is bound to the entries its own action left
// behind: anything else means another document and nothing is written.
export function useTaskActions() {
  const { t } = useI18n()
  const planner = usePlannerStore()
  const toast = useUndoToast()

  function undoCommit(mutator: Parameters<typeof planner.commit>[0]): void {
    void planner.commit(mutator).then((result) => { if (!result.ok && result.reason === CHANGED_ELSEWHERE) planner.dismissError() })
  }

  // Bound to the row that was clicked: a task that changed or was replaced meanwhile is left alone.
  function reopen(task: Task): void {
    const shown = snapshotOf(task)
    undoCommit((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === task.id)
      if (!target) return
      assertEntry(target, shown)
      delete target.doneAt
    })
  }

  async function complete(task: Task): Promise<void> {
    const holder: { after?: string } = {}
    const result = await planner.commit((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === task.id)
      if (!target) return
      target.doneAt = new Date().toISOString()
      holder.after = snapshotOf(target)
    })
    if (!result.ok) return
    const after = holder.after
    toast.show({
      message: t('tasks.completed', { title: task.title }),
      onUndo: () => undoCommit((draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id)
        if (!target) return
        assertEntry(target, after)
        delete target.doneAt
      }),
    })
  }

  async function remove(task: Task): Promise<boolean> {
    const holder: { category?: string } = {}
    const result = await planner.commit((draft) => {
      holder.category = snapshotOf(draft.categories.find((candidate) => candidate.id === task.categoryId))
      draft.tasks = draft.tasks.filter((candidate) => candidate.id !== task.id)
    })
    if (!result.ok) return false
    const category = holder.category
    toast.show({
      message: t('tasks.removed', { title: task.title }),
      onUndo: () => undoCommit((draft) => {
        assertEntry(draft.tasks.find((candidate) => candidate.id === task.id), undefined)
        // The category the task was filed under has to be as it was; a task with no category has nothing to check.
        if (task.categoryId !== undefined) assertEntry(draft.categories.find((candidate) => candidate.id === task.categoryId), category)
        draft.tasks.push(task)
      }),
    })
    return true
  }

  // A warning's one-tap fix: the task gets a new due date (or none), with an undo bound to what this change left.
  async function setDueDate(task: Task, dueDate: string, message: string): Promise<boolean> {
    const shown = snapshotOf(task)
    const holder: { after?: string } = {}
    const result = await planner.commit((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === task.id)
      assertEntry(target, shown)
      if (!target) return
      target.dueDate = dueDate
      holder.after = snapshotOf(target)
    })
    if (!result.ok) {
      if (result.reason === CHANGED_ELSEWHERE) planner.dismissError()
      return false
    }
    const after = holder.after
    toast.show({
      message,
      onUndo: () => undoCommit((draft) => {
        const target = draft.tasks.find((candidate) => candidate.id === task.id)
        assertEntry(target, after)
        if (!target) return
        if (task.dueDate === undefined) delete target.dueDate
        else target.dueDate = task.dueDate
      }),
    })
    return true
  }

  return { complete, remove, reopen, setDueDate }
}
