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
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; vi.useRealTimers() })

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
    store.document = { ...workspace('ws-b'), revision: 1, categories: [category] }
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    expect(store.document?.tasks).toEqual([])
  })
})
