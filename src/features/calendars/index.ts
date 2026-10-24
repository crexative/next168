import type { CalendarSourceStore } from '@/core/model'
import type { ShellRegistry } from '@/app/contracts'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { provideCalendarLifecycle, provideCalendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import CalendarsSection from '@/features/settings/calendars/CalendarsSection.vue'
import { calendarServices, calendarTextRevision, cancelCalendarRefreshes, capturePurgeEpoch, writeIfUnpurged } from './calendarStore'
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

export default function registerCalendars(registry: ShellRegistry): void {
  registry.registerSettingsSection({ id: 'calendars', component: CalendarsSection, titleKey: 'calendars.heading', order: 30 })
  setExternalOccurrenceSource(expandCalendarSources, calendarSourceRevision)
  provideCalendarSourceStore(currentTexts)
  provideCalendarLifecycle({ cancelRefreshes: cancelCalendarRefreshes, textsChanged: () => { calendarTextRevision.value++ }, capturePurgeEpoch, writeIfUnpurged })
}
