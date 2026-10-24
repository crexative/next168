import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick } from 'vue'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import WeekView from './WeekView.vue'
import UndoToast from '@/ui/UndoToast.vue'
import { useUndoToast } from '@/ui/undoToast'
import { resetPlacementMemory } from './taskPlacement'

let cleanup = () => undefined as void
const realMatchMedia = window.matchMedia
afterEach(() => { cleanup(); useUndoToast().dismiss(); resetPlacementMemory(); vi.useRealTimers(); window.matchMedia = realMatchMedia })

// A narrow screen: nothing matches (min-width: 768px), as on a phone.
function usePhoneScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}
beforeEach(() => { globalThis.document.body.innerHTML = '<div id="toolbar-actions"></div>' })

const tick = async () => { for (let i = 0; i < 5; i++) { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)) } }

// "+" opens a small menu; the block form is its first entry.
async function addBlockFromMenu(): Promise<void> {
  globalThis.document.querySelector<HTMLElement>('[data-testid="week-add"]')!.click()
  await tick()
  globalThis.document.querySelector<HTMLElement>('[data-testid="add-block"]')!.click()
  await tick()
}

describe('WeekView saving', () => {
  it('shows the moved-task notice on reopen and Undo restores its expired slot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 540, end: 600, days: [0, 1, 2, 3, 4, 5, 6] })
      draft.tasks.push({ id: 'report', title: 'Report', categoryId: 'work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' })
    })
    i18n.global.locale.value = 'es'
    const mount = () => {
      const host = globalThis.document.createElement('div')
      globalThis.document.body.append(host)
      const app = createApp({ render: () => [h(WeekView), h(UndoToast)] })
      app.use(pinia).use(i18n).mount(host)
      cleanup = () => { app.unmount(); host.remove() }
      return host
    }
    const first = mount()
    await tick()
    expect(first.querySelector('[data-date="2026-10-21"] [data-testid="week-task"]')?.getAttribute('data-start-minute')).toBe('540')
    expect(first.querySelector('.toast')).toBeNull()
    cleanup()

    vi.setSystemTime(new Date('2026-10-21T10:05:00Z'))
    const reopened = mount()
    await tick()
    expect(reopened.querySelector('[data-date="2026-10-21"] [data-testid="week-task"]')).toBeNull()
    expect(reopened.querySelector('[data-date="2026-10-22"] [data-testid="week-task"]')).not.toBeNull()
    expect(reopened.querySelector('[role="status"]')?.textContent).toContain('pasó a mañana')
    const undo = reopened.querySelector<HTMLButtonElement>('.toast-action')!
    expect(undo?.textContent).toBe('Deshacer')
    undo.click()
    await tick()
    expect(reopened.querySelector('[data-date="2026-10-21"] [data-testid="week-task"]')?.getAttribute('data-start-minute')).toBe('540')
    expect(reopened.querySelector('[data-date="2026-10-22"] [data-testid="week-task"]')).toBeNull()
    expect(useUndoToast().toast.value).toBeNull()
  })

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
    expect(dialogs[0]!.querySelector('h2')?.textContent).toBe('Edit routine')
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

    await addBlockFromMenu()
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

    await addBlockFromMenu()
    // The category is a chip, selected for the first one that is not Sleep.
    expect(globalThis.document.querySelector<HTMLElement>('[role="dialog"] [role="radio"][aria-checked="true"]')!.dataset.categoryId).toBe('work')
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
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    const trigger = globalThis.document.querySelector<HTMLElement>('[data-testid="week-add"]')!
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
    expect(items.map(hint)).toEqual(['Something to do; finds its own free slot', 'An appointment on a day and time', 'Repeats every week'])
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-event"]')!.click()
    await tick()
    expect(globalThis.document.querySelector('[role="dialog"] h2')?.textContent).toBe('New event')
    expect(globalThis.document.querySelector('[role="menu"]')).toBeNull()
  })

  it('shows a task as a dashed chunk inside its block and a done block with a visible status', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [0, 1, 2, 3, 4, 5, 6] })
      draft.tasks.push({ id: 'report', title: 'Write report', categoryId: 'work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' })
      draft.actuals.push({ date: '2026-10-20', blockId: 'focus', categoryId: 'work', plannedStartAt: '2026-10-20T10:00:00.000Z', plannedEndAt: '2026-10-20T13:00:00.000Z', plannedMinutes: 180, status: 'done' })
    })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    const chunk = host.querySelector<HTMLElement>('[data-date="2026-10-21"] [data-testid="week-task"]')!
    expect(chunk.dataset.startMinute).toBe('600')
    expect(chunk.dataset.endMinute).toBe('660')
    expect(chunk.getAttribute('aria-label')).toMatch(/^Task: Write report, 10:00/)
    expect(chunk.querySelector('.task-box')).not.toBeNull()
    const done = host.querySelector<HTMLElement>('[data-date="2026-10-20"] [data-block-id="focus"]')!
    expect(done.dataset.status).toBe('done')
    expect(done.querySelector('[data-testid="block-status"]')?.textContent?.trim()).toBe('Done')
    expect(done.getAttribute('aria-label')).toMatch(/, Done$/)
    expect(host.querySelector('[data-date="2026-10-21"] [data-block-id="focus"]')?.hasAttribute('data-status')).toBe(false)
  })

  it('pages between weeks with the range label and returns to this week with Today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T10:15:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [1] })
    })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    const range = () => host.querySelector('[data-testid="week-range"]')!.textContent!.replace(/\s/g, ' ')
    const click = async (id: string) => { host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click(); await tick() }
    expect(range()).toBe('Oct 19 – 25')
    // "Today" appears only once another week is shown.
    expect(host.querySelector('[data-testid="week-today"]')).toBeNull()
    expect(host.querySelector('[data-date="2026-10-19"]')).not.toBeNull()
    await click('week-next')
    expect(range()).toBe('Oct 26 – Nov 1')
    expect(host.querySelector('[data-date="2026-10-26"]')).not.toBeNull()
    expect(host.querySelector('[data-date="2026-10-19"]')).toBeNull()
    expect(host.querySelector('[data-testid="week-today"]')).not.toBeNull()
    await click('week-previous')
    await click('week-previous')
    expect(range()).toBe('Oct 12 – 18')
    await click('week-today')
    expect(range()).toBe('Oct 19 – 25')
    expect(host.querySelector('[data-testid="week-today"]')).toBeNull()
    expect(host.querySelector('[data-testid="now-line"]')).not.toBeNull()
  })

  it('switches a phone between one day and the whole week and opens a day from the overview', async () => {
    usePhoneScreen()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T10:15:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => {
      draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [1, 3] })
    })
    i18n.global.locale.value = 'en'
    const host = globalThis.document.createElement('div')
    globalThis.document.body.append(host)
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()

    expect(host.querySelector('[data-testid="week-overview"]')).toBeNull()
    expect(host.querySelector('.pager')).not.toBeNull()
    expect(host.querySelector('.pager')?.getAttribute('data-active-date')).toBe('2026-10-21')
    expect(host.querySelector<HTMLElement>('[data-testid="pager-track"]')?.style.transform).toBe('translateX(calc(-200% + 0px))')
    // The thumb-zone "+" replaces the toolbar one on a phone.
    expect(host.querySelector('.fab-anchor [data-testid="week-add"]')).not.toBeNull()
    expect(globalThis.document.querySelector('#toolbar-actions [data-testid="week-add"]')).toBeNull()
    // One toolbar button switches between a day and the whole week; its name says what it will show.
    const toggle = () => host.querySelector<HTMLElement>('[data-testid="week-view-toggle"]')!
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(0)
    expect(toggle().getAttribute('aria-label')).toBe('Show the whole week')
    toggle().click()
    await tick()
    expect(toggle().getAttribute('aria-label')).toBe('Show one day')
    expect(host.querySelector('.pager')).toBeNull()
    expect(host.querySelectorAll('[data-testid="week-overview"] .day-column')).toHaveLength(7)
    expect(host.querySelector('[data-testid="week-overview"] .legend')?.textContent).toContain('Work')
    host.querySelector<HTMLElement>('[data-testid="week-overview"] .overview-day:nth-child(5)')!.click()
    await tick()
    expect(host.querySelector('[data-testid="week-overview"]')).toBeNull()
    expect(host.querySelector('.pager')?.getAttribute('data-active-date')).toBe('2026-10-22')
    expect(host.querySelector<HTMLElement>('[data-testid="pager-track"]')?.style.transform).toBe('translateX(calc(-300% + 0px))')
    host.querySelector<HTMLElement>('[data-testid="week-next"]')!.click()
    await tick()
    expect(host.querySelector('.pager')?.getAttribute('data-active-date')).toBe('2026-10-29')
    host.querySelector<HTMLElement>('[data-testid="week-today"]')!.click()
    await tick()
    expect(host.querySelector('.pager')?.getAttribute('data-active-date')).toBe('2026-10-21')
    expect(host.querySelector<HTMLElement>('[data-testid="pager-track"]')?.style.transform).toBe('translateX(calc(-200% + 0px))')
  })
})

describe('WeekView wiring', () => {
  async function mountWeek(fill: (draft: import('@/core/model').PlannerDocument) => void) {
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
    const app = createApp(WeekView)
    app.use(pinia).use(i18n).mount(host)
    cleanup = () => { app.unmount(); host.remove() }
    await tick()
    return { host, store }
  }
  const work = { id: 'work', name: 'Work', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }

  it('shows the free-hours badge in the header slot for the current week only', async () => {
    const { host } = await mountWeek((draft) => {
      draft.categories.push(work)
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [1] })
    })
    const badge = () => host.querySelector('[data-testid="week-free-hours-slot"] [data-testid="free-hours"]')
    // Wednesday 10:15 to Monday 00:00 is 109 h 45 min, shown as whole hours; Monday's block is already behind.
    expect(badge()?.textContent?.trim()).toBe('110 h free from now to Sunday · of 168')
    host.querySelector<HTMLElement>('[data-testid="week-next"]')!.click()
    await tick()
    expect(badge()).toBeNull()
    host.querySelector<HTMLElement>('[data-testid="week-today"]')!.click()
    await tick()
    expect(badge()).not.toBeNull()
  })

  it('offers "Set up my week" next to adding a block when the week is empty', async () => {
    const { host, store } = await mountWeek((draft) => { draft.categories.push(work) })
    const prompt = host.querySelector<HTMLButtonElement>('[data-testid="setup-week"]')!
    expect(prompt.textContent).toBe('Set up my week · 1 min')
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Add a routine')).toBe(true)
    prompt.click()
    await store.settled()
    expect(store.document!.settings.onboardingDone).toBe(false)
  })

  it('offers "Set up my week" instead of the Settings link when there are no categories', async () => {
    const { host } = await mountWeek(() => undefined)
    expect(host.querySelector('[data-testid="setup-week"]')).not.toBeNull()
    expect(host.querySelector('a[href="#/settings"]')).toBeNull()
  })

  it('adds a task from "+" without choosing a category: it appears in a free slot, outside the routine blocks', async () => {
    const { host, store } = await mountWeek((draft) => {
      draft.categories.push(work)
      // Work covers Wednesday 10:00-13:00; now is 10:15, so the first free time is 13:00.
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 780, days: [3] })
    })
    globalThis.document.querySelector<HTMLElement>('[data-testid="week-add"]')!.click()
    await tick()
    globalThis.document.querySelector<HTMLElement>('[data-testid="add-task"]')!.click()
    await tick()
    const title = globalThis.document.querySelector<HTMLInputElement>('[role="dialog"] [data-testid="task-title"]')!
    title.value = 'Buy a gift for mum'
    title.dispatchEvent(new Event('input'))
    await tick()
    globalThis.document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')!.click()
    await store.settled()
    await tick()
    expect(store.document!.tasks).toMatchObject([{ title: 'Buy a gift for mum', durationMin: 60 }])
    expect(store.document!.tasks[0]).not.toHaveProperty('categoryId')
    const chunk = host.querySelector<HTMLElement>('[data-date="2026-10-21"] [data-testid="week-task"]')!
    expect(chunk.dataset.startMinute).toBe('780')
    expect(chunk.getAttribute('aria-label')).toContain('Buy a gift for mum')
    await vi.waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull())
  })

  it('opens the task sheet when a placed task is tapped, and a change made there moves it', async () => {
    const { host, store } = await mountWeek((draft) => {
      draft.categories.push(work)
      draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', start: 600, end: 840, days: [3] })
      draft.tasks.push({ id: 'report', title: 'Report', categoryId: 'work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' })
    })
    host.querySelector<HTMLElement>('[data-testid="week-task"]')!.click()
    await tick()
    const dialog = globalThis.document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('h2')?.textContent).toBe('Edit task')
    const title = dialog.querySelector<HTMLInputElement>('[data-testid="task-title"]')!
    expect(title.value).toBe('Report')
    title.value = 'Final report'
    title.dispatchEvent(new Event('input'))
    await tick()
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
    await store.settled()
    await tick()
    expect(store.document!.tasks[0]!.title).toBe('Final report')
    expect(host.querySelector('[data-testid="week-task"]')!.getAttribute('aria-label')).toContain('Final report')
  })
})
