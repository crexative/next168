import type { CalendarSourceStore } from '@/core/model'

// The calendars slice registers its IndexedDB/companion store here so export and import carry source texts.
let store: CalendarSourceStore | undefined

export function provideCalendarSourceStore(next: CalendarSourceStore | undefined): void {
  store = next
}

export function calendarSourceStore(): CalendarSourceStore | undefined {
  return store
}

// Delete-all cancels this tab's calendar refreshes first and announces the removed texts afterwards.
export interface CalendarLifecycle {
  cancelRefreshes(): void
  textsChanged(): void
}
let lifecycle: CalendarLifecycle | undefined

export function provideCalendarLifecycle(next: CalendarLifecycle | undefined): void {
  lifecycle = next
}

export function calendarLifecycle(): CalendarLifecycle | undefined {
  return lifecycle
}
