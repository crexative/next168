// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument, Task } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import { LAST_TASK_CATEGORY_KEY } from './lastCategory'
import TaskSheet from './TaskSheet.vue'

const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } } as const
const STUDY = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } } as const
const TASK: Task = { id: 't-1', title: 'Read a chapter', categoryId: 'c-study', durationMin: 45, dueDate: '2026-10-30', priority: 1, createdAt: '2026-10-24T08:00:00.000Z' }

let app: App | undefined
let host: HTMLElement
const closed = vi.fn()

async function open(taskId: string | undefined, overrides: Partial<PlannerDocument> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await repos.planner.save({ ...testDocument({ workspaceId: 'ws-a' }), categories: [WORK, STUDY], tasks: [TASK], ...overrides, revision: 1 }, 0)
  const store = usePlannerStore()
  await store.load()
  i18n.global.locale.value = 'en'
  const isOpen = ref(true)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(defineComponent({
    setup: () => () => h(TaskSheet, { open: isOpen.value, taskId, 'onUpdate:open': (value: boolean) => { isOpen.value = value; if (!value) closed() } }),
  })).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  await nextTick()
  return { store, isOpen }
}

const dialog = () => document.body.querySelector<HTMLElement>('[role=dialog]')!
const titleField = () => dialog().querySelector<HTMLInputElement>('[data-testid=task-title]')!
const when = () => dialog().querySelector<HTMLSelectElement>('[data-testid=task-when]')!
const save = () => dialog().querySelector<HTMLButtonElement>('button[type=submit]')!
async function set(field: HTMLInputElement | HTMLSelectElement, value: string, event = 'input') {
  field.value = value
  field.dispatchEvent(new Event(event))
  await nextTick()
}

beforeEach(() => { localStorage.clear(); closed.mockClear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); host?.remove(); document.body.innerHTML = ''; app = undefined; vi.useRealTimers() })

describe('editing a task', () => {
  it('shows what the task holds, with "More options" already open because it has a category, a date and a priority', async () => {
    await open('t-1')
    expect(titleField().value).toBe('Read a chapter')
    expect(when().value).toBe('c-study')
    expect(dialog().querySelector<HTMLElement>('[data-testid=task-more-options]')!.style.display).not.toBe('none')
    expect(dialog().querySelector<HTMLInputElement>('[data-testid=task-due]')!.value).toBe('2026-10-30')
    // 45 min is not one of the chips, yet the task's own length stays selected and visible.
    expect(dialog().querySelector('[role=radio][aria-checked=true]')!.textContent?.trim()).toBe('45 min')
  })

  it('saves the changes, and "any free slot" removes the category from the stored task', async () => {
    const { store, isOpen } = await open('t-1')
    await set(titleField(), 'Read two chapters')
    await set(when(), '', 'change')
    save().click()
    await store.settled()
    const [task] = store.document!.tasks
    expect(task).toMatchObject({ id: 't-1', title: 'Read two chapters', durationMin: 45, dueDate: '2026-10-30', priority: 1, createdAt: TASK.createdAt })
    expect(task).not.toHaveProperty('categoryId')
    expect(isOpen.value).toBe(false)
  })

  it('refuses to save over a task that changed elsewhere, says so, and writes nothing', async () => {
    const { store, isOpen } = await open('t-1')
    await set(titleField(), 'My edit')
    store.document = { ...store.document!, tasks: [{ ...TASK, title: 'Edited on another device' }] }
    save().click()
    await store.settled()
    await nextTick()
    expect(store.document!.tasks[0]!.title).toBe('Edited on another device')
    expect(dialog().querySelector('[role=alert]')?.textContent).toContain('changed elsewhere')
    expect(isOpen.value).toBe(true)
    expect(store.error).toBeNull()
  })

  it('writes once when the save is pressed twice before the first finishes', async () => {
    const { store } = await open('t-1')
    await set(titleField(), 'Once')
    save().click()
    save().click()
    await store.settled()
    expect(store.document!.revision).toBe(2)
  })

  it('closes, and writes nothing, when the workspace is replaced under the open sheet', async () => {
    const { store, isOpen } = await open('t-1')
    await set(titleField(), 'Stale edit')
    store.document = testDocument({ workspaceId: 'ws-b', categories: [WORK, STUDY], tasks: [TASK], revision: 1 })
    await nextTick()
    expect(isOpen.value).toBe(false)
    expect(store.document!.tasks[0]!.title).toBe('Read a chapter')
  })

  it('deletes with a plain "Delete task" action and offers Undo, which brings the task back', async () => {
    const { store, isOpen } = await open('t-1')
    dialog().querySelector<HTMLButtonElement>('[data-testid=task-delete]')!.click()
    await store.settled()
    await nextTick()
    expect(store.document!.tasks).toEqual([])
    expect(isOpen.value).toBe(false)
    expect(useUndoToast().toast.value).not.toBeNull()
    useUndoToast().undo()
    await store.settled()
    expect(store.document!.tasks).toEqual([TASK])
  })

  it('has no Cancel button on the phone: the close button and the swipe are the way out', async () => {
    await open('t-1')
    const labels = [...dialog().querySelectorAll('button')].map((button) => button.textContent?.trim())
    expect(labels).not.toContain('Cancel')
  })
})

describe('adding a task from the sheet', () => {
  it('adds one task when the button is pressed twice before the first save finishes', async () => {
    const { store } = await open(undefined, { tasks: [] })
    await set(titleField(), 'Call the bank')
    save().click()
    save().click()
    await store.settled()
    expect(store.document!.tasks).toHaveLength(1)
  })

  it('writes nothing into a replacement workspace, even when it is saved before the sheet has noticed the change', async () => {
    const { store } = await open(undefined, { tasks: [] })
    await set(titleField(), 'Stale task')
    store.document = testDocument({ workspaceId: 'ws-b', categories: [WORK, STUDY], tasks: [], revision: 1 })
    save().click()
    await store.settled()
    expect(store.document!.tasks).toEqual([])
    expect(store.error).toBeNull()
  })

  it('starts with no category, offers the last choice only as a suggestion, and needs a title', async () => {
    localStorage.setItem(LAST_TASK_CATEGORY_KEY, 'c-work')
    const { store } = await open(undefined, { tasks: [] })
    expect(when().value).toBe('')
    const suggestion = dialog().querySelector<HTMLButtonElement>('[data-testid=task-suggested-category]')!
    expect(suggestion.textContent?.trim()).toBe('During Work')
    expect(suggestion.getAttribute('aria-pressed')).toBe('false')
    expect(save().disabled).toBe(true)
    await set(titleField(), 'Call the bank')
    expect(save().disabled).toBe(false)
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Call the bank', durationMin: 60, priority: 2 }])
    expect(store.document!.tasks[0]).not.toHaveProperty('categoryId')
    // A task for any free slot keeps the suggestion for the next one.
    expect(localStorage.getItem(LAST_TASK_CATEGORY_KEY)).toBe('c-work')
  })

  it('files a task under the suggested category with one tap', async () => {
    localStorage.setItem(LAST_TASK_CATEGORY_KEY, 'c-work')
    const { store } = await open(undefined, { tasks: [] })
    await set(titleField(), 'Send the invoice')
    dialog().querySelector<HTMLButtonElement>('[data-testid=task-suggested-category]')!.click()
    await nextTick()
    expect(when().value).toBe('c-work')
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Send the invoice', categoryId: 'c-work' }])
  })

  it('"Today" tapped after midnight in a sheet opened the evening before gives the new day', async () => {
    vi.setSystemTime(new Date('2026-10-26T04:50:00.000Z')) // 23:50 on the 25th in Bogotá
    const { store } = await open(undefined, { tasks: [], settings: { ...testDocument().settings, timeZone: 'America/Bogota' } })
    await set(titleField(), 'Jog')
    vi.setSystemTime(new Date('2026-10-26T05:10:00.000Z')) // 00:10 on the 26th in Bogotá
    const today = dialog().querySelector<HTMLButtonElement>('[data-testid=task-today]')!
    today.click()
    await nextTick()
    expect(today.getAttribute('aria-pressed')).toBe('true')
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
  })

  it('"Today" tapped before midnight and saved after it is due the new day; the chip stays on and the date follows (verify7)', async () => {
    vi.setSystemTime(new Date('2026-10-26T04:58:00.000Z')) // 23:58 on the 25th in Bogotá
    const { store } = await open(undefined, { tasks: [], settings: { ...testDocument().settings, timeZone: 'America/Bogota' } })
    await set(titleField(), 'Jog')
    const today = dialog().querySelector<HTMLButtonElement>('[data-testid=task-today]')!
    today.click()
    await nextTick()
    const due = dialog().querySelector<HTMLInputElement>('[data-testid=task-due]')!
    expect(due.value).toBe('2026-10-25')
    vi.setSystemTime(new Date('2026-10-26T05:03:00.000Z')) // 00:03 on the 26th
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    await nextTick()
    expect(today.getAttribute('aria-pressed')).toBe('true')
    expect(due.value).toBe('2026-10-26')
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
  })

  it('"Today" is saved as the date of the save even when the screen never saw midnight tick by', async () => {
    vi.setSystemTime(new Date('2026-10-26T04:58:00.000Z'))
    const { store } = await open(undefined, { tasks: [], settings: { ...testDocument().settings, timeZone: 'America/Bogota' } })
    await set(titleField(), 'Jog')
    dialog().querySelector<HTMLButtonElement>('[data-testid=task-today]')!.click()
    await nextTick()
    vi.setSystemTime(new Date('2026-10-26T05:03:00.000Z'))
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
  })

  it('a task already due today shows "Today" on until midnight, then off, and keeps its date', async () => {
    vi.setSystemTime(new Date('2026-10-26T04:58:00.000Z'))
    const { store } = await open('t-1', { tasks: [{ ...TASK, dueDate: '2026-10-25' }], settings: { ...testDocument().settings, timeZone: 'America/Bogota' } })
    const today = dialog().querySelector<HTMLButtonElement>('[data-testid=task-today]')!
    expect(today.getAttribute('aria-pressed')).toBe('true')
    vi.setSystemTime(new Date('2026-10-26T05:03:00.000Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(today.getAttribute('aria-pressed')).toBe('false')
    await set(titleField(), 'Read a chapter again')
    save().click()
    await store.settled()
    expect(store.document!.tasks[0]).toMatchObject({ title: 'Read a chapter again', dueDate: '2026-10-25' })
  })

  it('"Today" makes a new task due on the planner\'s date, and a second tap takes it back', async () => {
    // 04:30 UTC on Monday is still Sunday 25 in Bogotá.
    vi.setSystemTime(new Date('2026-10-26T04:30:00.000Z'))
    const { store } = await open(undefined, { tasks: [], settings: { ...testDocument().settings, timeZone: 'America/Bogota' } })
    await set(titleField(), 'Jog')
    const today = dialog().querySelector<HTMLButtonElement>('[data-testid=task-today]')!
    today.click()
    await nextTick()
    expect(today.getAttribute('aria-pressed')).toBe('true')
    today.click()
    await nextTick()
    expect(today.getAttribute('aria-pressed')).toBe('false')
    today.click()
    await nextTick()
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-25' }])
  })

  it('files a task under a category picked after the sheet opened', async () => {
    const { store } = await open(undefined, { tasks: [] })
    await set(titleField(), 'During work')
    await set(when(), 'c-work', 'change')
    save().click()
    await store.settled()
    expect(store.document!.tasks).toMatchObject([{ title: 'During work', categoryId: 'c-work' }])
    expect(localStorage.getItem(LAST_TASK_CATEGORY_KEY)).toBe('c-work')
  })

  it('moves a task to another category it was not filed under when the sheet opened', async () => {
    const { store } = await open('t-1')
    await set(when(), 'c-work', 'change')
    save().click()
    await store.settled()
    expect(store.document!.tasks[0]).toMatchObject({ id: 't-1', categoryId: 'c-work' })
  })

  it('does not file a task under a category that was edited elsewhere after the sheet opened', async () => {
    const { store } = await open(undefined, { tasks: [] })
    await set(titleField(), 'Stale')
    await set(when(), 'c-work', 'change')
    store.document = { ...store.document!, categories: [{ ...WORK, name: 'Renamed' }, STUDY] }
    save().click()
    await store.settled()
    expect(store.document!.tasks).toEqual([])
  })
})


it.each([undefined, 't-1'])('refuses a stale category after Vue has flushed external changes (task %s)', async (taskId) => {
  const { store, isOpen } = await open(taskId, taskId ? {} : { tasks: [] })
  await set(titleField(), 'My edit')
  await set(when(), 'c-work', 'change')
  await store.commit((draft) => { draft.categories.find((category) => category.id === 'c-work')!.name = 'Renamed elsewhere' })
  await nextTick()
  const before = JSON.stringify(store.document)
  save().click()
  await store.settled()
  await nextTick()
  expect(JSON.stringify(store.document)).toBe(before)
  expect(dialog().querySelector('[role=alert]')?.textContent).toContain('changed elsewhere')
  expect(isOpen.value).toBe(true)
})
