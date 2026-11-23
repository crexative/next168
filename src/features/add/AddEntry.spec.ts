import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick } from 'vue'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import WeekView from '@/features/week/WeekView.vue'
import { resetPlacementMemory } from '@/features/week/taskPlacement'
import { addRequest } from '@/features/onboarding/reopen'
import AddEntry from './AddEntry.vue'

// The shell's one "+" (redesign 2026-11, principle 4): a menu of task, event and routine on every tab but Tasks,
// where it adds a task at once.
let cleanup = () => undefined as void
afterEach(() => { cleanup(); resetPlacementMemory(); vi.useRealTimers() })
beforeEach(() => { globalThis.document.body.innerHTML = '' })

const tick = async () => { for (let i = 0; i < 5; i++) { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)) } }
const work = { id: 'work', name: 'Work', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }

async function mountWeek(fill: (draft: PlannerDocument) => void, view: 'week' | 'tasks' | 'today' = 'week') {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T10:15:00Z'))
  const { planner } = createTestRepositories()
  configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  await store.load()
  await store.commit((draft) => { draft.settings.onboardingDone = true; fill(draft) })
  i18n.global.locale.value = 'en'
  const host = globalThis.document.createElement('div')
  globalThis.document.body.append(host)
  const app = createApp({ render: () => [h(WeekView), h(AddEntry, { view, placement: 'floating' })] })
  app.use(pinia).use(i18n).mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await tick()
  return { host, store }
}

describe('AddEntry', () => {
  // The "+" on Hoy opens Nueva tarea with "Hoy" on; elsewhere it starts with no date.
  it.each([['today', true], ['week', false]] as const)('from %s, Nueva tarea starts with "Hoy" on: %s', async (view, on) => {
    await mountWeek((draft) => { draft.categories.push(work) }, view)
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-entry"]')!.click()
    await tick()
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-task"]')!.click()
    await tick()
    expect(globalThis.document.querySelector<HTMLInputElement>('[role="dialog"] [data-testid="task-today"]')!.checked).toBe(on)
  })

  it('offers Task, Event and Routine from "+" with a one-line hint each, and each entry opens its own sheet', async () => {
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => { draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }) })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp({ render: () => [h(WeekView), h(AddEntry, { view: 'week', placement: 'floating' })] })
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    const trigger = globalThis.document.querySelector<HTMLElement>('[data-testid="add-entry"]')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(globalThis.document.querySelector('[role="menu"]')).toBeNull()
    globalThis.document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    trigger.click()
    await tick()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    globalThis.document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await tick()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(globalThis.document.querySelector('[role="menu"]')).toBeNull()
    trigger.click()
    await tick()
    const items = [...globalThis.document.querySelectorAll('[role="menuitem"]')]
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['Task', 'Event', 'Routine'])
    const hint = (item: Element) => globalThis.document.getElementById(item.getAttribute('aria-describedby')!)?.textContent
    expect(items.map(hint)).toEqual(['Something to do. Finds its own free slot.', 'An appointment on a day and time', 'Repeats every week'])
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-event"]')!.click()
    await tick()
    expect(globalThis.document.querySelector('[role="dialog"] h2')?.textContent).toBe('New event')
    expect(globalThis.document.querySelector('[role="menu"]')).toBeNull()
  })

  it('adds a task from "+" without choosing a category: it appears in a free slot, outside the routine blocks', async () => {
    const { host, store } = await mountWeek((draft) => {
      draft.categories.push(work)
      // Work covers Wednesday 10:00-13:00; now is 10:15, so the first free time is 13:00.
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [3] })
    })
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-entry"]')!.click()
    await tick()
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-task"]')!.click()
    await tick()
    const title = globalThis.document.querySelector<HTMLTextAreaElement>('[role="dialog"] [data-testid="capture-field"]')!
    title.value = 'Buy a gift for mum'
    title.dispatchEvent(new Event('input'))
    await tick()
    // A task with no length is a to-do the week never places, so this one gets an hour.
    ;[...globalThis.document.querySelectorAll<HTMLElement>('[role="dialog"] [data-testid="task-length"] label')].find((chip) => chip.textContent?.trim() === '1 h')!.querySelector('input')!.click()
    await tick()
    globalThis.document.querySelector<HTMLButtonElement>('[role="dialog"] [data-testid="task-add"]')!.click()
    // The capture binds the planner (an async fingerprint) before it commits.
    for (let turn = 0; turn < 10; turn++) { await new Promise((resolve) => setTimeout(resolve, 0)); await store.settled() }
    await tick()
    expect(store.document!.tasks).toMatchObject([{ title: 'Buy a gift for mum', durationMin: 60 }])
    expect(store.document!.tasks[0]).not.toHaveProperty('categoryId')
    const chunk = host.querySelector<HTMLElement>('[data-date="2026-10-21"] [data-testid="week-task"]')!
    expect(chunk.dataset.startMinute).toBe('780')
    expect(chunk.getAttribute('aria-label')).toContain('Buy a gift for mum')
    await vi.waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull())
  })


  it('adds a task directly on Tasks: no menu, and its name says so', async () => {
    await mountWeek((draft) => { draft.categories.push(work) }, 'tasks')
    const trigger = globalThis.document.querySelector<HTMLElement>('[data-testid="add-entry"]')!
    expect(trigger.getAttribute('aria-label')).toBe('New task')
    expect(trigger.hasAttribute('aria-haspopup')).toBe(false)
    trigger.click()
    await tick()
    expect(globalThis.document.querySelector('[role="menu"]')).toBeNull()
    expect(globalThis.document.querySelector('[role="dialog"] [data-testid="capture-field"]')).not.toBeNull()
  })

  it('opens the guided add for a routine', async () => {
    await mountWeek((draft) => { draft.categories.push(work) })
    const before = addRequest.value?.count ?? 0
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-entry"]')!.click()
    await tick()
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-block"]')!.click()
    await tick()
    expect(addRequest.value).toEqual({ entry: 'routine', count: before + 1 })
  })

  it('is not offered while the planner cannot be written', async () => {
    const { store } = await mountWeek((draft) => { draft.categories.push(work) })
    store.$patch({ status: 'readonly' })
    await tick()
    expect(globalThis.document.querySelector('[data-testid="add-entry"]')).toBeNull()
  })
})
