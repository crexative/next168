import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import WeekView from './WeekView.vue'

let cleanup = () => undefined as void
afterEach(() => { cleanup(); vi.useRealTimers() })
beforeEach(() => { globalThis.document.body.innerHTML = '<div id="toolbar-actions"></div>' })

const tick = async () => { for (let i = 0; i < 5; i++) { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)) } }

describe('WeekView saving', () => {
  it('opens the selected conflicting block by id and removes the event sheet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T10:15:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    const date = new Date().toISOString().slice(0, 10)
    await store.commit((draft) => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push(
        { id: 'first', categoryId: 'work', title: 'Focus', start: 540, end: 600, days: [0, 1, 2, 3, 4, 5, 6] },
        { id: 'second', categoryId: 'work', title: 'Focus', start: 555, end: 615, days: [0, 1, 2, 3, 4, 5, 6] },
      )
      draft.events.push({ id: 'event', title: 'Team sync', start: `${date}T09:00:00Z`, end: `${date}T10:00:00Z`, allDay: false, attendees: [] })
    })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    host.querySelector<HTMLButtonElement>('.busy')!.click()
    await tick()
    const conflicts = globalThis.document.querySelectorAll<HTMLButtonElement>('[data-testid="busy-details-conflict"] button')
    expect(conflicts).toHaveLength(2)
    expect([...conflicts].map((button) => button.textContent?.trim())).toEqual(['Conflicts with Focus', 'Conflicts with Focus'])
    conflicts[1]!.click()
    await tick()

    expect(globalThis.document.querySelector('[data-testid="busy-details"]')).toBeNull()
    const dialogs = globalThis.document.querySelectorAll<HTMLElement>('[role="dialog"]')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]!.querySelector('h2')?.textContent).toBe('Edit block')
    expect(dialogs[0]!.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('Focus')
    expect(dialogs[0]!.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('09:15')
  })

  it('creates exactly one block when the form is submitted again while the save is pending', async () => {
    const { planner } = createTestRepositories()
    let release = () => undefined as void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let armed = false
    const slow = Object.create(planner) as typeof planner
    slow.save = async (document, expected) => { if (armed) await gate; return planner.save(document, expected) }
    configurePlannerStore({ repository: slow, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => { draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }) })

    armed = true

    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    globalThis.document.querySelector<HTMLElement>('#toolbar-actions button')!.click()
    await tick()
    const dialog = globalThis.document.querySelector<HTMLElement>('[role="dialog"]')!
    const title = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    title.value = 'Focus'
    title.dispatchEvent(new Event('input'))
    await nextTick()
    const form = dialog.querySelector<HTMLFormElement>('form')!
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(submit.disabled).toBe(false)

    form.dispatchEvent(new Event('submit', { cancelable: true }))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await nextTick()
    expect(submit.disabled).toBe(true)
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    release()
    await tick()

    expect(store.document?.blocks.map((block) => block.title)).toEqual(['Focus'])
  })

  it('preselects the first category that is not Sleep in the New block sheet', async () => {
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.categories.push(
        { id: 'sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
        { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
      )
    })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    globalThis.document.querySelector<HTMLElement>('#toolbar-actions button')!.click()
    await tick()
    expect(globalThis.document.querySelector<HTMLSelectElement>('[role="dialog"] select')!.value).toBe('work')
  })
})
