import { defineAsyncComponent, ref, shallowRef, type Component } from 'vue'
import type { ExternalOccurrence } from '@/core/model'
import { zonedInstant } from '@/core/time'
import { googleConnectionEnabled } from './googleGate'

// What the rest of the app sees of Google Calendar: the primary calendar's occurrences held in this tab's memory and
// the civil dates they cover. The Google code itself (sign-in, requests, the Settings section) is a separate chunk
// imported only when the build has a client ID, so a build without one carries none of it.

export const GOOGLE_SOURCE_ID = 'google:primary'
export const GOOGLE_CALENDAR_NAME = 'Google Calendar'

// Civil dates in the planner's zone, end exclusive.
export interface DateWindow { start: string; end: string }
// The window read, in the planner zone it was read in.
export interface GoogleCoverage extends DateWindow { timeZone: string; fetchedAt: string }

export interface GoogleSnapshot {
  occurrences: readonly ExternalOccurrence[]
  coverage?: GoogleCoverage
  // Bumped by every publication, including a forget, so every reader re-expands.
  revision: number
}

const snapshot = shallowRef<GoogleSnapshot>({ occurrences: [], revision: 0 })

export function googleSnapshot(): GoogleSnapshot {
  return snapshot.value
}

export function publishGoogleSnapshot(next: Omit<GoogleSnapshot, 'revision'>): void {
  snapshot.value = { ...next, revision: snapshot.value.revision + 1 }
}

export function googleRevision(): number {
  return snapshot.value.revision
}

// Whether this device shows the feature at all (build ID, not companion, labs flag, secure context).
export const googleAvailable = ref(false)

export function refreshGoogleAvailability(): void {
  googleAvailable.value = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && googleConnectionEnabled()
}

// Occurrences overlapping [window.start, window.end): timed ones by instant in the planner's zone, all-day ones by
// civil date, so a planner in another zone than the browser still gets the right days.
export function occurrencesWithin(list: readonly ExternalOccurrence[], window: DateWindow, timeZone: string): ExternalOccurrence[] {
  const from = zonedInstant(window.start, 0, timeZone).getTime()
  const until = zonedInstant(window.end, 0, timeZone).getTime()
  return list.filter((item) => item.allDay
    ? item.start < window.end && item.end > window.start
    : Date.parse(item.start) < until && Date.parse(item.end) > from)
}

export function googleOccurrencesIn(window: DateWindow, timeZone: string): ExternalOccurrence[] {
  return occurrencesWithin(snapshot.value.occurrences, window, timeZone)
}

// Civil dates read in another zone cover nothing: the same dates are other instants there.
export function coverageIncludes(coverage: (DateWindow & { timeZone: string }) | undefined, window: DateWindow, timeZone: string): boolean {
  return coverage !== undefined && coverage.timeZone === timeZone && coverage.start <= window.start && window.end <= coverage.end
}

// The Google UI, loaded on first render. `null` in a build without a client ID: the import below is then dead code
// and the bundler leaves the chunk out.
export const GoogleCalendarSection: Component | null = import.meta.env.VITE_GOOGLE_CLIENT_ID
  ? defineAsyncComponent(() => import('./google/GoogleCalendarSection.vue'))
  : null
export const GoogleCoverageNotice: Component | null = import.meta.env.VITE_GOOGLE_CLIENT_ID
  ? defineAsyncComponent(() => import('./google/GoogleCoverageNotice.vue'))
  : null
