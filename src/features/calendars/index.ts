import type { ShellRegistry } from '@/app/contracts'
import CalendarsSection from '@/features/settings/calendars/CalendarsSection.vue'

export default function registerCalendars(registry: ShellRegistry): void {
  registry.registerSettingsSection({ id: 'calendars', component: CalendarsSection, titleKey: 'calendars.heading', order: 30 })
}
export { useCalendarEvents } from './useCalendarEvents'
export { configureCalendarServices } from './calendarStore'
export { default as CalendarOverlay } from './CalendarOverlay.vue'
export { default as EventSheet } from './EventSheet.vue'
