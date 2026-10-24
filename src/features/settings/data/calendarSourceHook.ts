import type { CalendarSourceStore } from '@/core/model'

// The calendars slice registers its IndexedDB/companion store here so export and import carry source texts.
let store: CalendarSourceStore | undefined

export function provideCalendarSourceStore(next: CalendarSourceStore | undefined): void {
  store = next
}

export function calendarSourceStore(): CalendarSourceStore | undefined {
  return store
}
