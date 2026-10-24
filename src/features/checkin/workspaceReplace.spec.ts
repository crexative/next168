// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import CheckInView from './CheckInView.vue'
import CategorySettings from '@/features/settings/categories/CategorySettings.vue'
import TasksView from '@/features/tasks/TasksView.vue'
import OnboardingHost from '@/features/onboarding/OnboardingHost.vue'
import { useUndoToast } from '@/ui/undoToast'
import DataSettings from '@/features/settings/data/DataSettings.vue'
import { buildExportFile } from '@/features/settings/data/dataTransfer'

const TODAY = '2026-10-24'

function workspace(id: string, note?: string, extra: Partial<PlannerDocument> = {}): PlannerDocument {
  return testDocument({
    workspaceId: id,
    checkIns: note ? [{ date: TODAY, note }] : [],
    ...extra,
  })
}

let app: App | undefined
let host: HTMLElement

function mount(component: object) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(component).use(pinia).use(i18n)
  return { store, repos, start: () => app!.mount(host) }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); host?.remove(); app = undefined; vi.useRealTimers() })

async function setup(component: object, first: PlannerDocument) {
  const ctx = mount(component)
  await ctx.repos.planner.save(first, 0)
  await ctx.store.load()
  ctx.start()
  await nextTick()
  return ctx
}

describe('check-in form after the workspace is replaced', () => {
  it('shows the entry of the imported workspace instead of the previous values', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'old note'), revision: 1 })
    const note = () => host.querySelector<HTMLTextAreaElement>('textarea')!
    expect(note().value).toBe('old note')

    store.document = workspace('ws-b', 'imported note')
    await nextTick()
    expect(note().value).toBe('imported note')
  })

  it('refuses to commit a form that was prepared for the previous workspace', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'old note'), revision: 1 })
    const imported = { ...workspace('ws-b', 'imported note'), revision: 1 }
    store.document = imported
    // The watcher has not flushed yet: this is a save prepared before the switch.
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.workspaceId).toBe('ws-b')
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'imported note' }])
    expect(store.document?.revision).toBe(1)
  })
})

describe('other forms after the workspace is replaced', () => {
  it('does not let a category editor opened in the old workspace write into the new one', async () => {
    const { store } = await setup(CategorySettings, { ...workspace('ws-a'), revision: 1, categories: [{ id: 'c-old', name: 'Old', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }] })
    host.querySelector<HTMLButtonElement>('.category-button')!.click()
    await nextTick()
    expect(document.body.querySelector('[role=dialog]')).not.toBeNull()
    const imported = { ...workspace('ws-b'), revision: 1, categories: [] }
    store.document = imported
    document.body.querySelector('form.editor')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.workspaceId).toBe('ws-b')
    expect(store.document?.categories).toEqual([])
    await nextTick()
    expect(document.body.querySelector('.sheet-root.is-shown')).toBeNull()
  })

  it('does not let a task typed in the old workspace be added to the new one', async () => {
    const category = { id: 'c-old', name: 'Old', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category] })
    const title = host.querySelector<HTMLInputElement>('input[type=text], input:not([type])')!
    title.value = 'Stale task'
    title.dispatchEvent(new Event('input'))
    await nextTick()
    store.document = { ...workspace('ws-b'), revision: 1, categories: [{ ...category, name: 'Replaced' }] }
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.tasks).toEqual([])
  })
})

describe('content replaced under the same workspace id (restored backup)', () => {
  it('reloads the check-in form with the restored entry', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'old displayed note'), revision: 1 })
    const note = () => host.querySelector<HTMLTextAreaElement>('textarea')!
    expect(note().value).toBe('old displayed note')

    store.document = { ...workspace('ws-a', 'restored backup note'), revision: 2 }
    await nextTick()
    expect(note().value).toBe('restored backup note')
  })

  it('does not let a queued check-in submission overwrite the restored entry', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'old displayed note'), revision: 1 })
    // Same id, same revision: only the stored entry tells the two documents apart.
    store.document = { ...workspace('ws-a', 'restored backup note'), revision: 1 }
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'restored backup note' }])
  })

  it('does not let a queued task be added to a different document with the same id and revision', async () => {
    const category = { id: 'c-old', name: 'Old', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category] })
    const title = host.querySelector<HTMLInputElement>('input[type=text], input:not([type])')!
    title.value = 'Stale task'
    title.dispatchEvent(new Event('input'))
    await nextTick()
    store.document = { ...workspace('ws-a'), revision: 1, updatedAt: '2026-01-01T00:00:00.000Z', categories: [{ ...category, name: 'Replaced' }] }
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.tasks).toEqual([])
  })

  it('does not let a category editor save into content restored under the same id', async () => {
    const old = { id: 'c-old', name: 'Old', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
    const { store } = await setup(CategorySettings, { ...workspace('ws-a'), revision: 1, categories: [old] })
    host.querySelector<HTMLButtonElement>('.category-button')!.click()
    await nextTick()
    store.document = { ...workspace('ws-a'), revision: 1, categories: [{ ...old, name: 'Restored' }] }
    document.body.querySelector('form.editor')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.categories.map((category) => category.name)).toEqual(['Restored'])
  })
})

async function openDelete(first: PlannerDocument) {
  const ctx = await setup(DataSettings, first)
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.includes('Delete'))!
  button.click()
  await nextTick()
  const input = document.body.querySelector<HTMLInputElement>('form.confirm input')!
  input.value = 'DELETE'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  return ctx
}

describe('data settings confirmations', () => {
  it('does not erase a replacement workspace when a stale delete confirmation is submitted', async () => {
    const { store } = await openDelete({ ...workspace('ws-a', 'a note'), revision: 1 })
    store.document = { ...workspace('ws-b', 'b note'), revision: 1 }
    // The watcher has not flushed yet: the confirmation was opened for ws-a.
    document.body.querySelector('form.confirm')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.workspaceId).toBe('ws-b')
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'b note' }])
  })

  it('does not erase content restored under the same workspace id', async () => {
    const { store } = await openDelete({ ...workspace('ws-a', 'a note'), revision: 1 })
    store.document = { ...workspace('ws-a', 'restored note'), revision: 2, updatedAt: '2030-01-01T00:00:00.000Z' }
    document.body.querySelector('form.confirm')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'restored note' }])
  })
})

describe('delete-all and pending actions of the deleted planner', () => {
  it('withdraws an undo offered for the deleted planner, so it cannot write into the fresh one', async () => {
    const { store } = await openDelete({ ...workspace('ws-a', 'a note'), revision: 1 })
    const onUndo = vi.fn()
    useUndoToast().show({ message: 'Block deleted', onUndo })
    document.body.querySelector('form.confirm')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(store.document?.workspaceId).not.toBe('ws-a'))
    await vi.waitFor(() => expect(useUndoToast().toast.value).toBeNull())
    useUndoToast().undo()
    expect(onUndo).not.toHaveBeenCalled()
  })
})

describe('forms bind to their own entry, confirmations to the content hash', () => {
  const category = { id: 'c-1', name: 'Work', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
  const task = { id: 't-1', title: 'Existing', categoryId: 'c-1', durationMin: 30, priority: 2 as const, createdAt: '2026-10-01T00:00:00.000Z' }

  it('keeps an unsaved quick-add draft when another task is completed', async () => {
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [task] })
    const title = host.querySelector<HTMLInputElement>('input[type=text], input:not([type])')!
    title.value = 'Unsaved draft'
    title.dispatchEvent(new Event('input'))
    await nextTick()
    await store.commit((draft) => { draft.tasks[0]!.doneAt = '2026-10-24T10:00:00.000Z' })
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeDefined()
    expect(title.value).toBe('Unsaved draft')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.tasks.map((candidate) => candidate.title)).toContain('Unsaved draft')
  })

  it('keeps the check-in form through an unrelated commit but reloads it when its own entry changes', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'stored note'), revision: 1 })
    const note = () => host.querySelector<HTMLTextAreaElement>('textarea')!
    note().value = 'typed note'
    note().dispatchEvent(new Event('input'))
    await store.commit((draft) => { draft.tasks.push({ id: 't-9', title: 'Other', categoryId: 'c-1', durationMin: 15, priority: 2, createdAt: '2026-10-01T00:00:00.000Z' }) })
    await nextTick()
    expect(note().value).toBe('typed note')

    // Same workspace id, revision and write time: only the entry itself differs.
    store.document = { ...store.document!, checkIns: [{ date: TODAY, note: 'replaced note' }] }
    await nextTick()
    expect(note().value).toBe('replaced note')
  })

  it('refuses a check-in save when its entry changed and says so', async () => {
    const { store } = await setup(CheckInView, { ...workspace('ws-a', 'stored note'), revision: 1 })
    store.document = { ...store.document!, checkIns: [{ date: TODAY, note: 'replaced note' }] }
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    await nextTick()
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'replaced note' }])
    expect(host.querySelector('[role=alert]')?.textContent).toContain('changed elsewhere')
    expect(store.error).toBeNull()
  })

  it('refuses a delete-all confirmation when different content replaced the document with identical metadata', async () => {
    const first = { ...workspace('ws-a', 'content A'), revision: 1 }
    const { store } = await openDelete(first)
    await nextTick()
    store.document = { ...first, checkIns: [{ date: TODAY, note: 'content B' }] }
    await nextTick()
    document.body.querySelector('form.confirm')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    await nextTick()
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'content B' }])
    expect(document.body.querySelector('.sheet-root.is-shown')).toBeNull()
  })

  it('refuses an import-replace confirmation when the document was replaced with identical metadata', async () => {
    const first = { ...workspace('ws-a', 'content A'), revision: 1 }
    const { store } = await setup(DataSettings, first)
    const exported = await buildExportFile({ ...workspace('ws-z', 'imported'), revision: 1 }, {} as never, { now: () => new Date(fixedNow()) })
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([exported.json], 'backup.json', { type: 'application/json' })] })
    input.dispatchEvent(new Event('change'))
    for (let i = 0; i < 10; i++) await nextTick()
    const replace = host.querySelector<HTMLButtonElement>('[data-testid=import-preview] button.destructive, [data-testid=import-preview] button:last-of-type')!
    store.document = { ...first, checkIns: [{ date: TODAY, note: 'content B' }] }
    replace.click()
    await store.settled()
    await nextTick()
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'content B' }])
    expect(host.querySelector('[data-testid=import-preview]')).toBeNull()
  })
})

describe('onboarding and undo actions stay bound to what they were prepared for', () => {
  const category = { id: 'c-1', name: 'Work', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
  const task = { id: 't-1', title: 'Existing', categoryId: 'c-1', durationMin: 30, priority: 2 as const, createdAt: '2026-10-01T00:00:00.000Z' }
  const firstRun = (id: string) => ({ ...workspace(id), revision: 1, settings: { ...testDocument().settings, onboardingDone: false } })

  async function atFinish(first: PlannerDocument) {
    const ctx = await setup(OnboardingHost, first)
    const click = async (label: string) => {
      const button = [...document.body.querySelectorAll<HTMLButtonElement>('.onboarding button')].find((candidate) => candidate.textContent?.trim() === label)!
      button.click()
      await nextTick()
    }
    return { ...ctx, click }
  }

  it('rejects old wizard picks after a different first-run workspace replaces it', async () => {
    const { store, click } = await atFinish(firstRun('ws-a'))
    // Sleep and Work come ticked, so the wizard has picks without a tap.
    expect(document.body.querySelector<HTMLInputElement>('.onboarding input[aria-label="Use Sleep"]')!.checked).toBe(true)
    await click('Next')
    store.document = firstRun('ws-b')
    // The watcher has not flushed yet: Finish was prepared for ws-a.
    await click('Finish')
    await store.settled()
    expect(store.document?.workspaceId).toBe('ws-b')
    expect(store.document?.categories).toEqual([])
    expect(store.document?.settings.onboardingDone).toBe(false)
    expect(store.error).toBeNull()
  })

  it('refuses wizard completion after the opening revision changes in the same workspace', async () => {
    const { store, click } = await atFinish(firstRun('ws-a'))
    expect(document.body.querySelector<HTMLInputElement>('.onboarding input[aria-label="Use Sleep"]')!.checked).toBe(true)
    await click('Next')
    await store.commit((draft) => { draft.checkIns.push({ date: TODAY, note: 'x' }) })
    await click('Finish')
    await store.settled()
    expect(store.document?.settings.onboardingDone).toBe(false)
    expect(store.document?.categories).toEqual([])
    expect(store.document?.checkIns).toEqual([{ date: TODAY, note: 'x' }])
  })

  async function clickTaskButton(selector: string) {
    host.querySelector<HTMLButtonElement>(selector)!.click()
    await nextTick()
  }

  it('immediately undoes task completion in the same workspace', async () => {
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [task] })
    await clickTaskButton('button.check')
    await store.settled()
    expect(store.document?.tasks[0]?.doneAt).toBeDefined()
    expect(useUndoToast().toast.value).not.toBeNull()
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.tasks).toEqual([task])
    expect(store.document?.revision).toBe(3)
    expect(store.error).toBeNull()
  })

  it('reopens a completed task in the same workspace', async () => {
    const done = { ...task, doneAt: '2026-10-24T09:00:00.000Z' }
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [done] })
    await clickTaskButton('[data-testid=done-task] button')
    await store.settled()
    expect(store.document?.tasks).toEqual([task])
    expect(store.document?.revision).toBe(2)
    expect(store.error).toBeNull()
  })

  it('immediately undoes task removal in the same workspace', async () => {
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [task] })
    await clickTaskButton('button.remove')
    await store.settled()
    expect(store.document?.tasks).toEqual([])
    expect(useUndoToast().toast.value).not.toBeNull()
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.tasks).toEqual([task])
    expect(store.document?.revision).toBe(3)
    expect(store.error).toBeNull()
  })

  it('does not let a completed-task undo touch a replacement document', async () => {
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [task] })
    await clickTaskButton('button.check')
    await store.settled()
    expect(store.document?.tasks[0]?.doneAt).toBeDefined()
    const replaced = { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [{ ...task, doneAt: '2026-10-20T00:00:00.000Z' }] }
    store.document = replaced
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.tasks[0]?.doneAt).toBe('2026-10-20T00:00:00.000Z')
    expect(store.error).toBeNull()
  })

  it('does not reopen a done task that was replaced after the row was rendered', async () => {
    const done = { ...task, doneAt: '2026-10-24T09:00:00.000Z' }
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [done] })
    const reopen = host.querySelector<HTMLButtonElement>('[data-testid=done-task] button')!
    store.document = { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [{ ...done, doneAt: '2026-10-20T00:00:00.000Z' }] }
    reopen.click()
    await store.settled()
    expect(store.document?.tasks[0]?.doneAt).toBe('2026-10-20T00:00:00.000Z')
  })

  it('does not let a removed-task undo re-add the task to a replacement document', async () => {
    const { store } = await setup(TasksView, { ...workspace('ws-a'), revision: 1, categories: [category], tasks: [task] })
    await clickTaskButton('button.remove')
    await store.settled()
    expect(store.document?.tasks).toEqual([])
    store.document = { ...workspace('ws-b'), revision: 1, categories: [{ ...category, name: 'Other' }] }
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.tasks).toEqual([])
    expect(store.error).toBeNull()
  })

  async function deleteCategory(first: PlannerDocument) {
    const ctx = await setup(CategorySettings, first)
    host.querySelector<HTMLButtonElement>('[data-testid=category-c-1] .category-button')!.click()
    await nextTick()
    // Moving things away is a decision: with blocks or tasks in use the destination is chosen first.
    const target = document.body.querySelector<HTMLSelectElement>('form.editor .danger-zone select')
    if (target) {
      target.value = 'c-2'
      target.dispatchEvent(new Event('change'))
      await nextTick()
    }
    const del = document.body.querySelector<HTMLButtonElement>('form.editor .danger-zone button')!
    del.click()
    await ctx.store.settled()
    expect(useUndoToast().toast.value).not.toBeNull()
    return ctx
  }

  it('immediately undoes deletion of the sole unreferenced category in the same workspace', async () => {
    const { store } = await deleteCategory({ ...workspace('ws-a'), revision: 1, categories: [category] })
    expect(store.document?.categories).toEqual([])
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.categories).toEqual([category])
    expect(store.document?.revision).toBe(3)
    expect(store.error).toBeNull()
  })

  it('immediately restores a deleted category and its moved blocks and tasks in the same workspace', async () => {
    const other = { ...category, id: 'c-2', name: 'Other' }
    const block = { id: 'b-1', categoryId: category.id, title: 'Work block', days: [1], start: 60, end: 120 }
    const untouchedBlock = { ...block, id: 'b-2', categoryId: other.id, start: 120, end: 180 }
    const untouchedTask = { ...task, id: 't-2', categoryId: other.id }
    const { store } = await deleteCategory({ ...workspace('ws-a'), revision: 1, categories: [category, other], blocks: [block, untouchedBlock], tasks: [task, untouchedTask] })
    expect(store.document?.categories).toEqual([other])
    expect(store.document?.blocks).toEqual([{ ...block, categoryId: other.id }, untouchedBlock])
    expect(store.document?.tasks).toEqual([{ ...task, categoryId: other.id }, untouchedTask])
    useUndoToast().undo()
    await store.settled()
    expect(store.document?.categories).toEqual([other, category])
    expect(store.document?.blocks).toEqual([block, untouchedBlock])
    expect(store.document?.tasks).toEqual([task, untouchedTask])
    expect(store.document?.revision).toBe(3)
    expect(store.error).toBeNull()
  })

  it('does not let a deleted-category undo restore it into a replacement document', async () => {
    const { store } = await deleteCategory({ ...workspace('ws-a'), revision: 1, categories: [category] })
    expect(store.document?.categories).toEqual([])
    const other = { ...category, id: 'c-9', name: 'Other' }
    expect((await store.commit((draft) => { Object.assign(draft, workspace('ws-b', undefined, { categories: [other] })) })).ok).toBe(true)
    const replaced = structuredClone(store.document)
    useUndoToast().undo()
    await store.settled()
    expect(store.document).toEqual(replaced)
    expect(store.error).toBeNull()
  })
})
