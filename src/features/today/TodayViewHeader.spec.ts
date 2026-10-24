// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, newTestId, testDocument } from '@/repositories/testSupport'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { useUndoToast } from '@/ui/undoToast'
import TodayView from './TodayView.vue'

// Saturday 2026-10-24. Family 10:00–14:00, Reading 15:00–16:00, Sleep 22:00–06:00, plus one task inside Family.
const base: PlannerDocument = {
  ...testDocument({ workspaceId: 'ws-today' }), revision: 1,
  categories: [
    { id: 'family', name: 'Family', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'family', categoryId: 'family', title: 'Family lunch', days: [6], start: 600, end: 840 },
    { id: 'read', categoryId: 'family', title: 'Reading', days: [6], start: 900, end: 960 },
    { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
  ],
  tasks: [{ id: 'task', categoryId: 'family', title: 'Call grandma', durationMin: 30, priority: 1, createdAt: '2026-10-23T08:00:00.000Z' }],
  checkIns: [{ date: '2026-10-22' }],
}

let app: App | undefined
let host: HTMLElement

async function mount(at: string, seed: PlannerDocument = base) {
  vi.setSystemTime(new Date(at))
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: () => new Date(at), newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  host = document.createElement('div')
  document.body.appendChild(host)
  await repos.planner.save(seed, 0)
  await store.load()
  i18n.global.locale.value = 'en'
  app = createApp(TodayView).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  await nextTick()
  return store
}

const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); window.localStorage.clear(); setExternalOccurrenceSource(async () => []) })
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); host?.remove(); app = undefined; vi.useRealTimers() })

describe('Today header and cards', () => {
  it('shows the free hours and how many of today’s items are done', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    expect(text('free-hours')).toBe('23 h free from now to Sunday · of 168')
    // Family lunch + Reading + Sleep start today, plus the placed task; nothing is done yet.
    expect(text('day-progress')).toBe('0 of 4 done today')
    await store.commit((draft) => { draft.tasks[0]!.doneAt = '2026-10-24T11:00:00.000Z' })
    await nextTick()
    expect(text('day-progress')).toBe('1 of 4 done today')
  })

  it('puts a placed task in "Next" when it starts before the next block', async () => {
    await mount('2026-10-24T14:30:00Z')
    expect(text('now-title')).toBe('Unplanned')
    expect(text('now-free-for')).toBe('in 30 min')
    expect(text('now-next')).toContain('Reading')
  })

  it('only offers the check-in card from 20:00, then shows it done with the streak', async () => {
    await mount('2026-10-24T19:59:00Z')
    expect(host.querySelector('[data-testid="checkin-card"]')).toBeNull()
    app!.unmount(); host.remove()
    const store = await mount('2026-10-24T20:00:00Z')
    expect(host.querySelector('[data-testid="checkin-card"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="checkin-done"]')).toBeNull()
    await store.commit((draft) => { draft.checkIns.push({ date: '2026-10-23' }, { date: '2026-10-24' }) })
    await nextTick()
    expect(text('checkin-done')).toBe('Done ✓ · streak 3')
  })
})

describe('Today status questions', () => {
  it('asks for status inside the Now card, and not for blocks that started before the plan was first seen', async () => {
    await mount('2026-10-24T12:00:00Z', { ...base, checkIns: [] , tasks: [] })
    // First time the plan is seen at 12:00 (no older evidence): Family lunch started at 10:00 and is not asked.
    expect(host.querySelector('.now-card [role="group"]')).toBeNull()
    expect(host.querySelector('[role="group"]')).toBeNull()
  })

  it('asks when older evidence shows the plan existed', async () => {
    await mount('2026-10-24T12:00:00Z')
    expect(host.querySelector('.now-card [role="group"]')?.getAttribute('aria-label')).toBe('How did Family lunch go?')
  })

  it('completes a task from its row and undoes it from the toast', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    host.querySelector<HTMLButtonElement>('[data-testid="task-check"]')!.click()
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeTruthy()
    expect(host.querySelector('[data-testid="task-check"]')).toBeNull()
    const toast = useUndoToast()
    expect(toast.toast.value?.message).toBe('Task done: Call grandma')
    toast.undo()
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeUndefined()
    expect(host.querySelector('[data-testid="task-check"]')).not.toBeNull()
  })
})
