import type { BlockActual, PlannerDocument } from '@/core/model'
import type { DatedOccurrence } from '@/core/time'

export type ActualStatus = BlockActual['status']

function sameOccurrence(actual: BlockActual, occurrence: DatedOccurrence): boolean {
  return actual.blockId === occurrence.blockId && Date.parse(actual.plannedStartAt) === Date.parse(occurrence.start)
}

export function actualFor(actuals: BlockActual[], occurrence: DatedOccurrence): BlockActual | undefined {
  return actuals.find((actual) => sameOccurrence(actual, occurrence))
}

// Snapshots the occurrence so history stays correct after the template block changes or is deleted.
export function recordActual(draft: PlannerDocument, occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number): void {
  const actual: BlockActual = {
    date: occurrence.date,
    blockId: occurrence.blockId,
    categoryId: occurrence.categoryId,
    plannedStartAt: occurrence.start,
    plannedEndAt: occurrence.end,
    plannedMinutes: occurrence.plannedMinutes,
    status,
    ...(status === 'partial' ? { actualMinutes: Math.max(0, Math.min(occurrence.plannedMinutes, Math.round(actualMinutes ?? 0))) } : {}),
  }
  const index = draft.actuals.findIndex((item) => sameOccurrence(item, occurrence))
  if (index === -1) draft.actuals.push(actual)
  else draft.actuals[index] = actual
}

export function clearActual(draft: PlannerDocument, occurrence: DatedOccurrence): void {
  draft.actuals = draft.actuals.filter((item) => !sameOccurrence(item, occurrence))
}
