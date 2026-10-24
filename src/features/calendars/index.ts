import type { CalendarSourceStore } from '@/core/model'
import type { ShellRegistry } from '@/app/contracts'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { provideCalendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import CalendarsSection from '@/features/settings/calendars/CalendarsSection.vue'
import { calendarServices } from './calendarStore'
import { expandCalendarSources } from './occurrenceSource'

export { useCalendarEvents } from './useCalendarEvents'
export { configureCalendarServices } from './calendarStore'
export { default as CalendarOverlay } from './CalendarOverlay.vue'
export { default as EventSheet } from './EventSheet.vue'

// Resolves the services on every call, so a reconfiguration is honoured by export and import too.
const currentTexts: CalendarSourceStore = {
  get: (id) => calendarServices().texts.get(id),
  put: (id, text) => calendarServices().texts.put(id, text),
  delete: (id) => calendarServices().texts.delete(id),
  list: () => calendarServices().texts.list(),
}

export default function registerCalendars(registry: ShellRegistry): void {
  registry.registerSettingsSection({ id: 'calendars', component: CalendarsSection, titleKey: 'calendars.heading', order: 30 })
  setExternalOccurrenceSource(expandCalendarSources)
  provideCalendarSourceStore(currentTexts)
}
