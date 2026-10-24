import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { IDBFactory } from 'fake-indexeddb'
import registerCalendars from '@/features/calendars'
import { configureCalendarServices, useCalendarStore } from '@/features/calendars/calendarStore'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import TodayView from './TodayView.vue'

let cleanup = () => undefined as void
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { cleanup(); setExternalOccurrenceSource(async () => []); vi.useRealTimers() })

describe('TodayView', () => {
  it('removes a deleted calendar event and moves its task into the freed time without remounting', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
    registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn() })
    const planner = usePlannerStore(), calendars = useCalendarStore()
    await planner.load()
    expect(await planner.commit(draft => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 720, end: 840 })
      draft.tasks.push({ id: 'task', categoryId: 'work', title: 'Write report', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString() })
    })).toEqual({ ok: true })
    await calendars.importFile('Team', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:busy\r\nDTSTART:20261024T120000Z\r\nDTEND:20261024T130000Z\r\nSUMMARY:Team meeting\r\nEND:VEVENT\r\nEND:VCALENDAR')

    i18n.global.locale.value = 'en'
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(TodayView).use(pinia).use(i18n)
    app.mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    const taskStart = () => host.querySelector('[data-kind="task"] .row-time span')?.textContent
    await vi.waitFor(() => expect(host.textContent).toContain('Team meeting'))
    expect(taskStart()).toBe('1:00 PM')

    await calendars.removeSource(planner.document!.calendarSources[0]!.id)
    await vi.waitFor(() => expect(host.textContent).not.toContain('Team meeting'))
    expect(taskStart()).toBe('12:00 PM')
  })

  it('shows a saved event for today even when there are no recurring blocks', async () => {
    configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.events.push({ id: 'dentist', title: 'Dentist', start: '2026-10-24T14:00:00.000Z', end: '2026-10-24T15:00:00.000Z', allDay: false, attendees: [] })
    })
    expect(store.document?.blocks).toEqual([])

    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(TodayView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await nextTick()
    await nextTick()

    expect(host.textContent).toContain('Dentist')
    expect(host.textContent).not.toContain('Nothing planned yet')
  })
})
