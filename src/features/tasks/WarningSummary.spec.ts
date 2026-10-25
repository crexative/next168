// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { PlannerDocument, Task } from '@/core/model'
import { testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import * as fixes from './warningFixes'
import TasksView from './TasksView.vue'

// P0 spec §3.4 and §4 A8/A9: fixes are worked out only for the warning cards on screen (the first 3, then pages of 10
// behind «Ver todas»), and a fix on a revealed card still changes the stored plan.
// Real fixes for the first cards a person can see; past that, the spy only counts (the base computed every warning).
const spy = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./warningFixes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./warningFixes')>()
  return { ...actual, warningFixes: vi.fn((...args: Parameters<typeof actual.warningFixes>) => (++spy.calls <= 40 ? actual.warningFixes(...args) : {})) }
})
const warningFixes = vi.mocked(fixes.warningFixes)

const SUNDAY_10_AM = new Date('2026-10-25T15:00:00.000Z') // Bogotá
const FAMILY = { id: 'c-family', name: 'Familia', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } } as const

// 976 tasks filed under a category with no routine blocks (each one is a warning) and 24 that fit any free time.
function planner(warnings: number, fitting: number): Partial<PlannerDocument> {
  const task = (i: number, extra: Partial<Task>): Task => ({ id: `t${String(i).padStart(4, '0')}`, title: `Tarea ${i}`, durationMin: 15, priority: 2, createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), ...extra })
  return {
    settings: { ...testDocument().settings, onboardingDone: true, timeZone: 'America/Bogota' },
    categories: [FAMILY],
    blocks: [],
    tasks: [
      ...Array.from({ length: warnings }, (_, i) => task(i, { categoryId: FAMILY.id })),
      ...Array.from({ length: fitting }, (_, i) => task(warnings + i, {})),
    ],
  }
}

let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); warningFixes.mockClear(); spy.calls = 0; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(SUNDAY_10_AM) })
afterEach(() => { useUndoToast().dismiss(); mounted?.unmount(); mounted = undefined; vi.useRealTimers(); document.body.innerHTML = '' })

const find = (selector: string) => mounted!.host.querySelector<HTMLElement>(selector)
const cards = () => [...mounted!.host.querySelectorAll<HTMLElement>('li.warning')]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim()

it.each([
  [1, 'Y 1 más no cabe en los próximos 7 días.'],
  [2, 'Y 2 más no caben en los próximos 7 días.'],
] as const)('renders the Spanish summary for %i hidden warnings', async (count, expected) => {
  mounted = await mountWithPlanner(TasksView, planner(3 + count, 0), 'es')
  expect(cards()).toHaveLength(3)
  expect(text(find('[data-testid=warning-summary] p'))).toBe(expected)
})

it('A9: with 976 warnings, fixes are worked out for 3 cards per render and «Ver todas» adds 10 cards and 10 calls', async () => {
  mounted = await mountWithPlanner(TasksView, planner(976, 24), 'es')
  expect(warningFixes.mock.calls.length).toBeLessThanOrEqual(3)
  expect(cards()).toHaveLength(3)
  expect(text(find('[data-testid=warning-summary]'))).toContain('Y 973 más no caben en los próximos 7 días.')

  // Another render (a task added elsewhere) works out the cards on screen again, never the hidden ones.
  warningFixes.mockClear()
  await mounted.store.commit((draft) => { draft.tasks.push({ id: 'zz', title: 'Otra', durationMin: 15, priority: 3, createdAt: SUNDAY_10_AM.toISOString() }) })
  await nextTick()
  expect(warningFixes.mock.calls.length).toBeLessThanOrEqual(3)

  warningFixes.mockClear()
  find('[data-testid=show-all-warnings]')!.click()
  await nextTick()
  expect(cards()).toHaveLength(13)
  expect(warningFixes.mock.calls.length).toBe(10)
  expect(text(find('[data-testid=warning-summary]'))).toContain('Y 963 más no caben en los próximos 7 días.')
}, 120_000)

it('A8: «Hacerla hoy» on a card revealed by «Ver todas» makes the task due today and its warning goes away', async () => {
  mounted = await mountWithPlanner(TasksView, planner(6, 0), 'es')
  expect(cards()).toHaveLength(3)
  find('[data-testid=show-all-warnings]')!.click()
  await nextTick()
  expect(cards()).toHaveLength(6)
  expect(find('[data-testid=warning-summary]')).toBeNull()
  const fifth = find('[data-testid=warning-t0004]')!
  fifth.querySelector<HTMLButtonElement>('[data-testid=fix-today]')!.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.tasks.find((task) => task.id === 't0004')).toMatchObject({ categoryId: FAMILY.id, dueDate: '2026-10-25' })
  expect(find('[data-testid=warning-t0004]')).toBeNull()
  expect(cards()).toHaveLength(5)
})

it('A8: the first card\'s fix is worked out and works with no «Ver todas» when 3 or fewer tasks do not fit', async () => {
  mounted = await mountWithPlanner(TasksView, planner(3, 0), 'es')
  expect(cards()).toHaveLength(3)
  expect(find('[data-testid=warning-summary]')).toBeNull()
  find('[data-testid=warning-t0000]')!.querySelector<HTMLButtonElement>('[data-testid=fix-today]')!.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-25')
  expect(find('[data-testid=warning-t0000]')).toBeNull()
})
