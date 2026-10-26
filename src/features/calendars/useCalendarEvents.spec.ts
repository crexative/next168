import { expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { configureCalendarServices, useCalendarStore } from './calendarStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { useCalendarEvents } from './useCalendarEvents'
const raw = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:recurring\r\nDTSTART;TZID=America/Bogota:20261019T090000\r\nDTEND;TZID=America/Bogota:20261019T100000\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly review\r\nEND:VEVENT\r\nEND:VCALENDAR'
it('re-expands offline raw sources after navigation and exposes missing-data failures', async () => {
  setActivePinia(createPinia())
  const repositories = createTestRepositories(), texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  configurePlannerStore({ repository: repositories.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'America/Bogota' })
  configureCalendarServices({ texts, fetcher: { fetch: async () => { throw new Error('Unexpected network call') } } })
  const planner = usePlannerStore(), calendars = useCalendarStore()
  await planner.load(); await calendars.importFile('Offline calendar', raw)
  const range = ref({ start: '2026-10-19', end: '2026-10-26' })
  const scope = effectScope()
  const calendar = scope.run(() => useCalendarEvents(range))!
  try {
    await vi.waitFor(() => expect(calendar.events.value[0]?.start).toBe('2026-10-19T14:00:00.000Z'))
    range.value = { start: '2027-02-01', end: '2027-02-08' }
    await vi.waitFor(() => expect(calendar.events.value[0]?.start).toBe('2027-02-01T14:00:00.000Z'))
    const id = planner.document!.calendarSources[0]!.id
    await texts.delete(id)
    range.value = { start: '2027-02-08', end: '2027-02-15' }
    await vi.waitFor(() => expect(calendar.errors.value[id]).toBe('calendars.missingFile'))
    expect(calendar.events.value).toEqual([])
  } finally { scope.stop() }
})
it('reports a missing text for a source whose id is named like an Object.prototype member', async () => {
  setActivePinia(createPinia())
  const repositories = createTestRepositories(), texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  configurePlannerStore({ repository: repositories.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts, fetcher: { fetch: async () => { throw new Error('Unexpected network call') } } })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit((draft) => { draft.calendarSources.push({ id: '__proto__', name: 'Odd id', kind: 'file', colorKey: 'blue' }) })
  const scope = effectScope()
  const calendar = scope.run(() => useCalendarEvents(ref({ start: '2026-10-19', end: '2026-10-26' })))!
  try {
    await vi.waitFor(() => expect(Object.entries(calendar.errors.value)).toEqual([['__proto__', 'calendars.missingFile']]))
  } finally { scope.stop() }
})
