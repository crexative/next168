// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Category, PlannerDocument } from '@/core/model'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import { configurePlannerStore } from '@/stores/plannerStore'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import OnboardingHost from './OnboardingHost.vue'
import { reopenOnboarding } from './reopen'

const work: Category = { id: 'saved-work', name: 'Work', colorKey: 'blue', icon: '💼', customColor: '#123456', goal: { type: 'max', hoursPerWeek: 40 } }
const sleep: Category = { id: 'saved-sleep', name: 'Rest', colorKey: 'pink', icon: '😴', customColor: '#abcdef', goal: { type: 'min', hoursPerWeek: 50 } }
const blocks: PlannerDocument['blocks'] = [
  { id: 'morning', categoryId: work.id, title: 'Morning', days: [1, 3], start: 540, end: 900, notes: 'Keep this' },
  { id: 'evening', categoryId: work.id, title: 'Evening', days: [5], start: 1020, end: 1200 },
  { id: 'night', categoryId: sleep.id, title: 'Rest', days: [6], start: 1380, end: 300 },
]
let mounted: Mounted | undefined
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const root = () => document.body.querySelector<HTMLElement>('[data-testid=onboarding]')!
const row = (id: string) => root().querySelector<HTMLElement>(`[data-template="${id}"]`)!
const button = (label: string) => [...root().querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
async function click(label: string) { button(label).click(); await nextTick(); await nextTick() }
function input(element: HTMLInputElement, value: string) { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })) }

async function open(overrides: Partial<PlannerDocument> = {}) {
  mounted = await mountWithPlanner(OnboardingHost, { categories: [work, sleep], settings: { ...testDocument().settings, onboardingDone: true }, ...overrides })
  await reopenOnboarding(mounted.store)
  await nextTick()
  return mounted
}

async function editWork() {
  row('work').querySelector<HTMLButtonElement>('.edit-button')!.click()
  await nextTick()
}

async function goalHours(value: string) {
  row('work').querySelector<HTMLButtonElement>('.goal-chip')!.click()
  await nextTick()
  input(row('work').querySelector<HTMLInputElement>('input[type=number]')!, value)
  await nextTick()
}

async function finish() {
  await click('Next'); await click('Next'); await click('Finish')
  await mounted!.store.settled()
  await nextTick()
}

describe('reopened onboarding', () => {
  it('saves goal and colour edits on the reused ID and leaves an untouched category byte-identical', async () => {
    const { store } = await open()
    const untouched = JSON.stringify(store.document!.categories.find((category) => category.id === sleep.id))
    await editWork()
    row('work').querySelector<HTMLInputElement>('input[type=radio][value=red]')!.click()
    await click('Next')
    await goalHours('32')
    await click('Next'); await click('Finish')
    await store.settled()
    expect(store.document!.categories.find((category) => category.id === work.id)?.goal.hoursPerWeek).toBe(32)
    expect(store.document!.categories.find((category) => category.id === work.id)?.colorKey).toBe('red')
    expect(store.document!.categories.find((category) => category.id === work.id)?.customColor).toBeUndefined()
    expect(store.document!.categories.find((category) => category.id === work.id)?.icon).toBe(work.icon)
    expect(JSON.stringify(store.document!.categories.find((category) => category.id === sleep.id))).toBe(untouched)
    expect(store.document!.categories).toHaveLength(2)
    expect(store.document!.settings.onboardingDone).toBe(true)
  })

  it('renames a reused category without changing its goal, colour or references', async () => {
    const tasks: PlannerDocument['tasks'] = [{ id: 'existing-task', title: 'Draft', categoryId: work.id, durationMin: 30, priority: 2, createdAt: fixedNow().toISOString() }]
    const { store } = await open({ blocks, tasks })
    await editWork()
    input(row('work').querySelector<HTMLInputElement>('input.name')!, 'Studio')
    await finish()
    expect(store.document!.categories.find((category) => category.id === work.id)).toEqual({ ...work, name: 'Studio' })
    expect(store.document!.blocks).toEqual(blocks)
    expect(store.document!.tasks).toEqual(tasks)
    expect(store.document!.categories).toHaveLength(2)
  })

  it('a goal-only edit preserves the original name, custom colour and icon', async () => {
    const { store } = await open()
    await click('Next'); await goalHours('32'); await click('Next'); await click('Finish')
    await store.settled()
    expect(store.document!.categories.find((category) => category.id === work.id)).toEqual({ ...work, goal: { type: 'max', hoursPerWeek: 32 } })
  })

  it('initialises selection, names, colours and goals from saved categories, including custom ones', async () => {
    const custom: Category = { id: 'art', name: 'Painting', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 7 } }
    await open({ categories: [{ ...work, name: 'Studio', colorKey: 'orange', goal: { type: 'min', hoursPerWeek: 22 } }, custom] })
    const selected = [...root().querySelectorAll<HTMLInputElement>('.chip input[type=checkbox]')].filter((box) => box.checked).map((box) => box.getAttribute('aria-label'))
    expect(selected.sort()).toEqual(['Use Painting', 'Use Studio'])
    await editWork()
    expect(row('work').querySelector<HTMLInputElement>('input.name')!.value).toBe('Studio')
    expect(row('work').querySelector<HTMLInputElement>('input[type=radio][value=orange]')!.checked).toBe(true)
    await click('Next')
    expect(row('work').querySelector('.goal-chip')!.textContent).toContain('Min 22 h')
    expect(root().textContent).toContain('Min 7 h')
  })

  it('counts the saved schedules and adds no duplicate sketches when finished untouched', async () => {
    const { store } = await open({ blocks })
    const savedCategories = JSON.stringify(store.document!.categories)
    expect(root().querySelector('[data-testid=week-counter]')!.textContent).toContain('21 of 168 h planned')
    expect(row('work').textContent).toContain('15 h per week')
    await click('Next')
    expect(row('work').textContent).toContain('09:00–15:00')
    expect(row('work').textContent).toContain('17:00–20:00')
    expect(row('work').querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
    await click('Next'); await click('Finish')
    await store.settled()
    expect(store.document!.blocks).toEqual(blocks)
    expect(JSON.stringify(store.document!.categories)).toBe(savedCategories)
    expect(store.document!.settings.onboardingDone).toBe(true)
  })

  it('loads fresh category values and planned hours each time it is reopened', async () => {
    const { store } = await open()
    await click('Not now'); await store.settled()
    await store.commit((draft) => {
      draft.categories = [{ ...work, name: 'Office', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 30 } }]
      draft.blocks = blocks.filter((block) => block.categoryId === work.id)
    })
    await reopenOnboarding(store); await nextTick()
    expect(root().querySelector<HTMLInputElement>('input[aria-label="Use Office"]')!.checked).toBe(true)
    expect(root().querySelector<HTMLInputElement>('input[aria-label="Use Sleep"]')!.checked).toBe(false)
    expect(root().querySelector('[data-testid=week-counter]')!.textContent).toContain('15 of 168 h planned')
    await editWork()
    expect(row('work').querySelector<HTMLInputElement>('input.name')!.value).toBe('Office')
    expect(row('work').querySelector<HTMLInputElement>('input[value=green]')!.checked).toBe(true)
    await click('Next')
    expect(row('work').querySelector('.goal-chip')!.textContent).toContain('Max 30 h')
  })

  it.each(['categories', 'revision', 'queued'] as const)('refuses a finish after a %s change since opening', async (change) => {
    const { store } = await open()
    await click('Next'); await goalHours('32'); await click('Next')
    const externalCommit = store.commit((draft) => {
      if (change === 'categories') draft.categories[0]!.goal.hoursPerWeek = 20
      else draft.checkIns.push({ date: '2026-10-24', note: 'Another tab' })
    })
    if (change !== 'queued') { await externalCommit; await nextTick() }
    button('Finish').click()
    await store.settled(); await nextTick()
    expect(store.document!.settings.onboardingDone).toBe(false)
    expect(store.document!.categories[0]!.goal.hoursPerWeek).toBe(change === 'categories' ? 20 : 40)
    expect(store.document!.blocks).toEqual([])
    expect(root().querySelector('[role=alert]')!.textContent).toContain('changed')
    expect(root().dataset.step).toBe('0')
    expect(store.document!.revision).toBe(3)
  })

  it('refuses an unseen other-tab write through the repository compare-and-swap', async () => {
    const { store } = await open()
    const repos = createTestRepositories()
    const opened = structuredClone(store.document!)
    await repos.planner.save(opened, 0)
    configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const external = structuredClone(opened)
    external.revision += 1
    external.categories[0]!.colorKey = 'yellow'
    expect((await repos.planner.save(external, opened.revision)).kind).toBe('ok')
    await finish()
    expect(store.document).toEqual(external)
    expect(await repos.planner.load()).toEqual({ kind: 'ok', document: external })
    expect(root().querySelector('[role=alert]')!.textContent).toContain('changed')
    expect(root().dataset.step).toBe('0')
  })
})
