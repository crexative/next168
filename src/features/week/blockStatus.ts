import type { BlockActual } from '@/core/model'
import type { DatedOccurrence } from '@/core/time'

export type BlockStatus = BlockActual['status']

// The recorded outcome of one dated occurrence (written from Today), matched like Today does: block id plus planned start.
export function statusOf(actuals: readonly BlockActual[], occurrence: DatedOccurrence): BlockStatus | undefined {
  const start = Date.parse(occurrence.start)
  return actuals.find((actual) => actual.blockId === occurrence.blockId && Date.parse(actual.plannedStartAt) === start)?.status
}
