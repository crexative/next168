import type { CalendarSourceStore } from '@/core/model'
import type { ShellRegistry } from '@/app/contracts'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { provideCalendarLifecycle, provideCalendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import { calendarServices, calendarTextRevision, cancelCalendarRefreshes, capturePurgeEpoch, writeIfUnpurged } from './calendarStore'
import { calendarSourceRevision, expandCalendarSources } from './occurrenceSource'
import { googleAvailable, refreshGoogleAvailability } from './googleCalendar'
import { captureLabsFlag } from './googleGate'

export { useCalendarEvents } from './useCalendarEvents'
export { configureCalendarServices } from './calendarStore'
export { default as CalendarOverlay } from './CalendarOverlay.vue'
export { default as EventSheet } from './EventSheet.vue'

// Resolves the services on every call, so a reconfiguration is honoured by export and import too.
const currentTexts: CalendarSourceStore = {
  get: (id) => calendarServices().texts.get(id),
  put: async (id, text) => {
    await calendarServices().texts.put(id, text)
    calendarTextRevision.value++
  },
  delete: async (id) => {
    await calendarServices().texts.delete(id)
    calendarTextRevision.value++
  },
  list: () => calendarServices().texts.list(),
}

// The calendars section itself is the Settings › Calendars page (features/settings).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the registry contract stays; this slice adds no view or section of its own
export default function registerCalendars(_registry: ShellRegistry): void {
  setExternalOccurrenceSource(expandCalendarSources, calendarSourceRevision)
  if (import.meta.env.VITE_GOOGLE_CLIENT_ID) captureLabsFlag()
  refreshGoogleAvailability()
  // The connection starts with the app (not with the first screen that shows it), so the copy saved on this device is
  // on Week, Today and the AI prompt at once, and every change that deletes it is seen. Google's own script still loads
  // only when the Connect sheet opens. The import resolves after main.ts installed Pinia.
  if (import.meta.env.VITE_GOOGLE_CLIENT_ID && googleAvailable.value) void import('./google/useGoogleConnection').then(({ useGoogleConnection }) => { useGoogleConnection() })
  provideCalendarSourceStore(currentTexts)
  provideCalendarLifecycle({ cancelRefreshes: cancelCalendarRefreshes, textsChanged: () => { calendarTextRevision.value++ }, capturePurgeEpoch, writeIfUnpurged })
}
