import type { CalendarSourceStore } from '@/core/model'
import type { ShellRegistry } from '@/app/contracts'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { provideCalendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import { calendarServices, calendarTextRevision } from './calendarStore'
import { calendarSourceRevision, expandCalendarSources } from './occurrenceSource'

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

// The calendars section itself lives under Settings → Integrations and advanced (features/settings).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the registry contract stays; this slice adds no view or section of its own
export default function registerCalendars(_registry: ShellRegistry): void {
  setExternalOccurrenceSource(expandCalendarSources, calendarSourceRevision)
  provideCalendarSourceStore(currentTexts)
}
