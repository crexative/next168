import type { ExternalOccurrence } from '@/core/model'
import { icsImport } from '@/core/icsImport'
import { addLocalDays } from '@/core/time'
import type { OccurrenceRange } from '@/features/week/externalOccurrences'
import { usePlannerStore } from '@/stores/plannerStore'
import { calendarServices, useCalendarStore } from './calendarStore'
import { googleOccurrencesIn, googleRevision, googleSnapshot } from './googleCalendar'

export function calendarSourceRevision(): string {
  const document = usePlannerStore().document
  return JSON.stringify([document?.workspaceId, document?.calendarSources, useCalendarStore().rawRevision, googleRevision()])
}

// Whether any calendar can add events: a saved source, or Google Calendar read in this tab.
export function hasExternalCalendars(): boolean {
  return (usePlannerStore().document?.calendarSources.length ?? 0) > 0 || googleSnapshot().occurrences.length > 0
}

// Expands every stored calendar source over the range Week and Today ask for. A source whose
// text is missing or unreadable is skipped; Settings is where its error is shown.
export async function expandCalendarSources({ fromDate, days, timeZone }: OccurrenceRange): Promise<ExternalOccurrence[]> {
  const sources = usePlannerStore().document?.calendarSources ?? []
  const range = { start: fromDate, end: addLocalDays(fromDate, days) }
  const expanded: ExternalOccurrence[] = []
  for (const source of sources) {
    try {
      const text = await calendarServices().texts.get(source.id)
      if (text !== undefined) expanded.push(...icsImport(text, source.id, range, timeZone))
    } catch { /* skipped, see above */ }
  }
  expanded.push(...googleOccurrencesIn(range, timeZone))
  return expanded
}
