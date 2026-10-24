import { useI18n } from 'vue-i18n'
import type { BlockActual, PlannerDocument } from '@/core/model'
import type { DatedOccurrence } from '@/core/time'
import { assertEntry, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import { useUndoToast } from '@/ui/undoToast'
import { actualFor, clearActual, recordActual, restoreActual, type ActualStatus } from './actuals'

// Marks what happened to a block the way a task is marked done: one commit, a toast with Undo instead of a
// confirmation. Every screen that asks "how did it go?" shares this, so they all behave and read the same.
export function useBlockStatus() {
  const { t } = useI18n()
  const planner = usePlannerStore()
  const toast = useUndoToast()
  // A second tap on the same block while its commit is still pending would race the first one.
  const inFlight = new Set<string>()

  async function change(occurrence: DatedOccurrence, message: string, mutate: (draft: PlannerDocument) => void): Promise<void> {
    const key = `${occurrence.blockId}@${occurrence.start}`
    if (inFlight.has(key)) return
    inFlight.add(key)
    try {
      const holder: { before?: BlockActual; after?: string } = {}
      const result = await planner.commit((draft) => {
        const entry = actualFor(draft.actuals, occurrence)
        holder.before = entry ? structuredClone(entry) : undefined
        mutate(draft)
        holder.after = snapshotOf(actualFor(draft.actuals, occurrence))
      })
      if (!result.ok) return
      const { before, after } = holder
      toast.show({
        message,
        // Bound to exactly the entry this action left behind: a later change to the block is never overwritten.
        onUndo: () => {
          void planner.commit((draft) => {
            assertEntry(actualFor(draft.actuals, occurrence), after)
            restoreActual(draft, occurrence, before)
          }).then((undone) => { if (!undone.ok) planner.dismissError() })
        },
      })
    } finally {
      inFlight.delete(key)
    }
  }

  function record(occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number): Promise<void> {
    const message = t('today.status.marked', { title: occurrence.title, status: t(`today.status.${status}`) })
    return change(occurrence, message, (draft) => recordActual(draft, occurrence, status, actualMinutes))
  }

  function clear(occurrence: DatedOccurrence): Promise<void> {
    return change(occurrence, t('today.status.cleared', { title: occurrence.title }), (draft) => clearActual(draft, occurrence))
  }

  return { record, clear }
}
