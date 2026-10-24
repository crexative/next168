import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import TodayView from './TodayView.vue'

let cleanup = () => undefined as void
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('TodayView', () => {
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
