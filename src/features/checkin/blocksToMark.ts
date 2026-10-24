import type { PlannerDocument } from '@/core/model'
import { datedOccurrences, localDateOf, type DatedOccurrence } from '@/core/time'
import { isSleepCategory } from '@/features/onboarding/templates'
import { isAskable } from '@/features/today/planSince'
import { isReportable } from '@/features/today/statusWindow'

// Today's blocks that are over (or in their last minutes) and that the plan existed for. Sleep is left out: the
// two sentences above it already say when the night began and ended.
export function blocksToMark(document: PlannerDocument, date: string, now: Date, since: number | undefined): DatedOccurrence[] {
  const timeZone = document.settings.timeZone
  const sleepIds = new Set(document.categories.filter(isSleepCategory).map((category) => category.id))
  return datedOccurrences(document, date, 1, timeZone).filter((occurrence) => (
    localDateOf(occurrence.start, timeZone) === date
    && !sleepIds.has(occurrence.categoryId)
    && isAskable(occurrence.start, since)
    && isReportable(occurrence, now)
  ))
}
