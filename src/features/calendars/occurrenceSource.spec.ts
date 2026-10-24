import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { useExternalOccurrences, setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { calendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import registerCalendars from './index'
import { configureCalendarServices, useCalendarStore } from './calendarStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'

const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:source-event\r\nDTSTART:20261024T120000Z\r\nDTEND:20261024T130000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
let consumer: ReturnType<typeof effectScope>

beforeEach(async () => {
  setActivePinia(createPinia())
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  await usePlannerStore().load()
  registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn() })
  consumer = effectScope()
})
afterEach(() => { consumer.stop(); setExternalOccurrenceSource(async () => []) })

function observe() {
  return consumer.run(() => useExternalOccurrences(() => ({ fromDate: '2026-10-24', days: 7, timeZone: 'UTC' })))!
}

describe('registered calendar occurrence source', () => {
  it('removes occurrences after metadata is deleted without changing the requested range', async () => {
    const calendars = useCalendarStore(), planner = usePlannerStore()
    await calendars.importFile('Team', feed('Deleted event'))
    const occurrences = observe()
    await vi.waitFor(() => expect(occurrences.value.map(event => event.title)).toEqual(['Deleted event']))

    expect(await planner.commit(draft => { draft.calendarSources = [] })).toEqual({ ok: true })
    await vi.waitFor(() => expect(occurrences.value).toEqual([]))
  })

  it('replaces cached content even when all source metadata stays identical', async () => {
    const calendars = useCalendarStore(), planner = usePlannerStore()
    await calendars.importFile('Team', feed('Old event'))
    const source = planner.document!.calendarSources[0]!
    const occurrences = observe()
    await vi.waitFor(() => expect(occurrences.value.map(event => event.title)).toEqual(['Old event']))

    await calendarSourceStore()!.put(source.id, feed('Replacement event'))
    await vi.waitFor(() => expect(occurrences.value.map(event => event.title)).toEqual(['Replacement event']))
    expect(planner.document!.calendarSources).toEqual([source])

    await calendarSourceStore()!.delete(source.id)
    await vi.waitFor(() => expect(occurrences.value).toEqual([]))
  })

  it('refreshes URL content when its synchronization timestamp is unchanged', async () => {
    let title = 'Before refresh'
    configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow, fetcher: { fetch: async () => feed(title) } })
    const calendars = useCalendarStore()
    await calendars.addUrl('Team', 'https://example.invalid/calendar.ics')
    const id = usePlannerStore().document!.calendarSources[0]!.id
    const occurrences = observe()
    await vi.waitFor(() => expect(occurrences.value.map(event => event.title)).toEqual(['Before refresh']))

    title = 'After refresh'
    await calendars.refreshSource(id)
    await vi.waitFor(() => expect(occurrences.value.map(event => event.title)).toEqual(['After refresh']))
  })

  it('discards an expansion still reading a source that has since been removed', async () => {
    const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
    configureCalendarServices({ texts, now: fixedNow })
    await useCalendarStore().importFile('Team', feed('Obsolete event'))
    let resolveText!: (text: string) => void
    const pending = new Promise<string>(resolve => { resolveText = resolve })
    const read = vi.spyOn(texts, 'get').mockReturnValueOnce(pending)
    const occurrences = observe()
    expect(read).toHaveBeenCalledTimes(1)

    expect(await usePlannerStore().commit(draft => { draft.calendarSources = [] })).toEqual({ ok: true })
    await nextTick()
    resolveText(feed('Obsolete event'))
    await pending
    await nextTick()
    await nextTick()
    expect(occurrences.value).toEqual([])
  })
})
