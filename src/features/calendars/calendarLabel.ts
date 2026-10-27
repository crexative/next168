import type { ColorKey, PlannerDocument } from '@/core/model'
import { GOOGLE_CALENDAR_NAME, GOOGLE_SOURCE_ID } from './googleCalendar'

export interface CalendarLabel { name: string; colorKey: ColorKey }

// The name and colour every view shows for an occurrence's calendar: a source saved in the planner, or the Google
// Calendar connected in this tab.
export function calendarLabel(document: Pick<PlannerDocument, 'calendarSources'> | null | undefined, sourceId: string): CalendarLabel | undefined {
  if (sourceId === GOOGLE_SOURCE_ID) return { name: GOOGLE_CALENDAR_NAME, colorKey: 'blue' }
  const source = document?.calendarSources.find((item) => item.id === sourceId)
  return source ? { name: source.name, colorKey: source.colorKey } : undefined
}

export function calendarNames(document: Pick<PlannerDocument, 'calendarSources'> | null | undefined): Map<string, string> {
  return new Map([
    ...(document?.calendarSources ?? []).map((source) => [source.id, source.name] as const),
    [GOOGLE_SOURCE_ID, GOOGLE_CALENDAR_NAME] as const,
  ])
}
