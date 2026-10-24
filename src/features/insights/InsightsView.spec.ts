// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { BlockActual, PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, newTestId, testDocument } from '@/repositories/testSupport'
import { freeHoursWhole } from '@/features/capacity/freeHours'
import InsightsView from './InsightsView.vue'

// Wednesday 2026-10-21 10:15 UTC.
const NOW = '2026-10-21T10:15:00.000Z'
const everyDay = [0, 1, 2, 3, 4, 5, 6]

// Assigned: exercise 3 h, work 40 h, reading 4.5 h, study 7.5 h, sleep 56 h and a 30 min errand = 111.5 h, so
// 56.5 h are unassigned and a per-figure rounding would print 112 + 57 = 169.
const base: PlannerDocument = {
  ...testDocument({ workspaceId: 'ws-insights' }), revision: 1,
  categories: [
    { id: 'exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 4 } },
    { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'reading', name: 'Reading', colorKey: 'orange', goal: { type: 'max', hoursPerWeek: 5 } },
    { id: 'study', name: 'Study', colorKey: 'pink', goal: { type: 'max', hoursPerWeek: 6 } },
    { id: 'sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'errands', name: 'Errands', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'b-exercise', categoryId: 'exercise', title: 'Gym', days: [1, 3, 5], start: 1080, end: 1140 },
    { id: 'b-work', categoryId: 'work', title: 'Work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
    { id: 'b-reading', categoryId: 'reading', title: 'Reading', days: [1, 3, 5], start: 1200, end: 1290 },
    { id: 'b-study', categoryId: 'study', title: 'Study', days: [2, 4, 6], start: 1200, end: 1350 },
    { id: 'b-sleep', categoryId: 'sleep', title: 'Sleep', days: everyDay, start: 0, end: 480 },
    { id: 'b-errands', categoryId: 'errands', title: 'Errands', days: [6], start: 600, end: 630 },
  ],
}

let app: App | undefined
let host: HTMLElement

async function mount(seed: PlannerDocument = base, locale = 'en', at = NOW) {
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
  i18n.global.locale.value = locale as 'en'
  app = createApp(InsightsView).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  await nextTick()
}

const text = (testId: string, scope: ParentNode = host) => scope.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim()
const row = (id: string) => host.querySelector(`[data-testid="goal-row-${id}"]`) as HTMLElement | null

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); window.localStorage.clear() })
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; i18n.global.locale.value = 'en'; vi.useRealTimers() })

describe('Summary: your typical week', () => {
  it('says assigned and unassigned hours in whole numbers that add up to 168', async () => {
    await mount()
    expect(text('capacity-available')).toBe('112 h assigned · 56 h unassigned')
  })

  it('uses the same words in Spanish', async () => {
    await mount(base, 'es')
    expect(text('capacity-available')).toBe('112 h asignadas · 56 h sin asignar')
  })

  it('gives the live free hours one line that matches the free-hours figure everywhere', async () => {
    await mount()
    const free = freeHoursWhole(base, new Date(NOW), 'UTC')
    expect(text('free-hours-live')).toBe(`${free} h free left this week.`)
    expect(host.querySelector('[data-testid="week-split"]')).toBeNull()
    expect(host.textContent).not.toMatch(/Already past|Planned ahead|This week from now/)
  })
})

describe('Summary: your goals this week', () => {
  it.each([true, false])('keeps deleted-category actuals visible (current categories: %s)', async (hasCurrentCategories) => {
    const actuals: BlockActual[] = [
      {
        date: '2026-10-19', blockId: 'deleted-block', categoryId: 'deleted-category',
        plannedStartAt: '2026-10-19T09:00:00.000Z', plannedEndAt: '2026-10-19T10:00:00.000Z',
        plannedMinutes: 60, status: 'done',
      },
      {
        date: '2026-10-20', blockId: 'deleted-block', categoryId: 'deleted-category',
        plannedStartAt: '2026-10-20T09:00:00.000Z', plannedEndAt: '2026-10-20T10:00:00.000Z',
        plannedMinutes: 60, status: 'partial', actualMinutes: 30,
      },
    ]
    await mount({ ...base, categories: hasCurrentCategories ? base.categories : [], blocks: hasCurrentCategories ? base.blocks : [], actuals }, 'en')
    const retained = row('deleted-category')
    expect(retained).not.toBeNull()
    expect(retained!.querySelector('.name')?.textContent).toBe('Deleted category')
    expect(text('actual-line', retained!)).toBe('Done: 1 h 30 min of 2 h')
    expect(retained!.querySelector('[data-testid="goal-line"]')).toBeNull()
    expect(retained!.querySelector('[data-testid="goal-state"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid="goal-row-deleted-category"]')).toHaveLength(1)
    expect(usePlannerStore().document!.categories.some((category) => category.id === 'deleted-category')).toBe(false)

    i18n.global.locale.value = 'es'
    await nextTick()
    expect(retained!.querySelector('.name')?.textContent).toBe('Categoría eliminada')
    expect(text('actual-line', retained!)).toBe('Hecho: 1 h 30 min de 2 h')
  })

  it('has one row per goal, with one line in whole hours and one mark', async () => {
    await mount()
    expect(text('goal-line', row('exercise')!)).toBe('3 of at least 4 h · 1 h to go')
    expect(text('goal-state', row('exercise')!)).toBe('!')
    expect(text('goal-line', row('reading')!)).toBe('4 of at most 5 h · 1 h left')
    expect(text('goal-state', row('reading')!)).toBe('✓')
    expect(text('goal-line', row('study')!)).toBe('8 of at most 6 h · 2 h over')
    expect(text('goal-state', row('study')!)).toBe('!')
    // A category without a goal has no row, and a row never states its status twice.
    expect(row('sleep')).toBeNull()
    expect(host.querySelector('[data-testid="goal-chip"]')).toBeNull()
  })

  it('says "At the max" at the cap instead of "0 h left"', async () => {
    await mount()
    expect(text('goal-line', row('work')!)).toBe('At the max · 40 h')
    expect(row('work')!.textContent).not.toMatch(/0 min|0 h left/)
    expect(text('goal-state', row('work')!)).toBe('✓')
  })

  it('agrees in number in Spanish: falta 1 h, faltan 14 h', async () => {
    await mount(base, 'es')
    expect(text('goal-line', row('exercise')!)).toBe('3 de al menos 4 h · falta 1 h')
    expect(text('goal-line', row('reading')!)).toBe('4 de como máximo 5 h · queda 1 h')
    const sleepy: PlannerDocument = { ...base, categories: base.categories.map((category) => (category.id === 'sleep' ? { ...category, goal: { type: 'min', hoursPerWeek: 70 } } : category)) }
    app?.unmount(); host.remove()
    await mount(sleepy, 'es')
    expect(text('goal-line', row('sleep')!)).toBe('56 de al menos 70 h · faltan 14 h')
  })

  it('shows what was done next to the plan, on the row of its category', async () => {
    const actual = (blockId: string, categoryId: string, minutes: number): BlockActual => ({
      date: '2026-10-19', blockId, categoryId, plannedStartAt: '2026-10-19T09:00:00.000Z', plannedEndAt: new Date(Date.parse('2026-10-19T09:00:00.000Z') + minutes * 60_000).toISOString(),
      plannedMinutes: minutes, status: 'done',
    })
    await mount({ ...base, actuals: [actual('b-work', 'work', 480), actual('b-sleep', 'sleep', 480)] })
    expect(text('actual-line', row('work')!)).toBe('Done: 8 h of 8 h')
    // Sleep has no goal but something was marked done, so it keeps a row with just that line.
    expect(text('actual-line', row('sleep')!)).toBe('Done: 8 h of 8 h')
    expect(row('sleep')!.querySelector('[data-testid="goal-line"]')).toBeNull()
    expect(host.querySelector('[data-testid^="actual-row-"]')).toBeNull()
  })

  it('invites setting a goal when no category has one', async () => {
    await mount({ ...base, categories: base.categories.map((category) => ({ ...category, goal: { type: 'none', hoursPerWeek: 0 } })) })
    expect(host.querySelector('[data-testid="goals-empty"]')?.textContent).toBe('No goals yet. Set one on a category in Settings.')
  })
})

describe('Summary: last 7 days', () => {
  it('names the window by its dates, not by weekdays that roll', async () => {
    await mount()
    expect(text('measures-range')).toBe('Oct 15 – 21')
  })

  it('names a window that crosses a month by both dates, in the reader\'s language', async () => {
    await mount(base, 'es', '2026-11-03T10:00:00.000Z')
    expect(text('measures-range')).toBe('28 oct – 3 nov')
  })

  it('shows the average stress as a whole number', async () => {
    await mount({ ...base, checkIns: [{ date: '2026-10-20', stress: 3 }, { date: '2026-10-21', stress: 4 }] })
    expect(host.querySelector('[data-testid="measure-stress"] [data-testid="measure-value"]')?.textContent?.trim()).toBe('4')
  })
})
