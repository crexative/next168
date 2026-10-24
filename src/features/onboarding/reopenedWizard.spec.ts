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
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const root = () => document.body.querySelector<HTMLElement>('[data-testid=onboarding]')!
const row = (id: string) => root().querySelector<HTMLElement>(`[data-template="${id}"]`)!
const button = (label: string) => [...root().querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
async function click(label: string) { button(label).click(); await nextTick(); await nextTick() }
const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role=dialog]')]

async function open(overrides: Partial<PlannerDocument> = {}) {
  mounted = await mountWithPlanner(OnboardingHost, { categories: [work, sleep], settings: { ...testDocument().settings, onboardingDone: true }, ...overrides })
  await reopenOnboarding(mounted.store)
  await nextTick()
  return mounted
}

async function renameWork(name: string) {
  row('work').querySelector<HTMLButtonElement>('.routine-line')!.click()
  await nextTick(); await nextTick()
  const field = [...dialogs().pop()!.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith('Title'))!.querySelector('input')!
  field.value = name; field.dispatchEvent(new Event('input'))
  await nextTick()
  dialogs().pop()!.querySelector<HTMLButtonElement>('button[type=submit]')!.click()
  await nextTick(); await nextTick()
}

async function finish() {
  await click('Next'); await click('Finish')
  await mounted!.store.settled()
  await nextTick()
}

describe('reopened onboarding', () => {
  it('reuses saved categories: a rename keeps goal, colour, icon and references, and an untouched one stays byte-identical', async () => {
    const tasks: PlannerDocument['tasks'] = [{ id: 'existing-task', title: 'Draft', categoryId: work.id, durationMin: 30, priority: 2, createdAt: fixedNow().toISOString() }]
    const { store } = await open({ tasks })
    const untouched = JSON.stringify(store.document!.categories.find((category) => category.id === sleep.id))
    await renameWork('Studio')
    await finish()
    expect(store.document!.categories.find((category) => category.id === work.id)).toEqual({ ...work, name: 'Studio' })
    expect(JSON.stringify(store.document!.categories.find((category) => category.id === sleep.id))).toBe(untouched)
    expect(store.document!.categories).toHaveLength(2)
    expect(store.document!.tasks).toEqual(tasks)
    expect(store.document!.settings.onboardingDone).toBe(true)
  })

  it('shows blocks a category already has as plain text, counts them, and adds no duplicates when finished untouched', async () => {
    const { store } = await open({ blocks })
    const savedCategories = JSON.stringify(store.document!.categories)
    expect(root().querySelector('[data-testid=week-counter]')!.textContent).toContain('21 h assigned')
    expect(row('work').querySelectorAll('.routine-line')).toHaveLength(0)
    expect(row('work').textContent).toMatch(/9:00\sAM–3:00\sPM/)
    expect(row('work').textContent).toMatch(/5:00\sPM–8:00\sPM|5:00–8:00\sPM/)
    await finish()
    expect(store.document!.blocks).toEqual(blocks)
    expect(JSON.stringify(store.document!.categories)).toBe(savedCategories)
    expect(store.document!.settings.onboardingDone).toBe(true)
  })

  it('initialises ticks and names from saved categories, including custom ones', async () => {
    const custom: Category = { id: 'art', name: 'Painting', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 7 } }
    await open({ categories: [{ ...work, name: 'Studio' }, custom] })
    const selected = [...root().querySelectorAll<HTMLInputElement>('.routine-head input[type=checkbox]')].filter((box) => box.checked).map((box) => box.getAttribute('aria-label'))
    expect(selected.sort()).toEqual(['Use Painting', 'Use Studio'])
    expect(row('category:art').querySelectorAll('.routine-line')).toHaveLength(0)
  })

  it('loads fresh category values and counts each time it is reopened', async () => {
    const { store } = await open()
    document.body.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label=Close]')!.click()
    await store.settled()
    await store.commit((draft) => {
      draft.categories = [{ ...work, name: 'Office' }]
      draft.blocks = blocks.filter((block) => block.categoryId === work.id)
    })
    await reopenOnboarding(store); await nextTick()
    expect(root().querySelector<HTMLInputElement>('input[aria-label="Use Office"]')!.checked).toBe(true)
    expect(root().querySelector<HTMLInputElement>('input[aria-label="Use Sleep"]')!.checked).toBe(false)
    expect(root().querySelector('[data-testid=week-counter]')!.textContent).toContain('15 h assigned')
  })

  it.each(['categories', 'revision', 'queued'] as const)('refuses a finish after a %s change since opening', async (change) => {
    const { store } = await open()
    await renameWork('Studio')
    await click('Next')
    const externalCommit = store.commit((draft) => {
      if (change === 'categories') draft.categories[0]!.goal.hoursPerWeek = 20
      else draft.checkIns.push({ date: '2026-10-24', note: 'Another tab' })
    })
    if (change !== 'queued') { await externalCommit; await nextTick() }
    button('Finish').click()
    await store.settled(); await nextTick()
    expect(store.document!.settings.onboardingDone).toBe(false)
    expect(store.document!.categories[0]!.goal.hoursPerWeek).toBe(change === 'categories' ? 20 : 40)
    expect(store.document!.categories[0]!.name).toBe('Work')
    expect(store.document!.blocks).toEqual([])
    expect(root().querySelector('[role=alert]')!.textContent).toContain('changed')
    expect(root().dataset.step).toBe('0')
    expect(store.document!.revision).toBe(3)
    // The refused draft is not offered again after a reload.
    expect(sessionStorage.length).toBe(0)
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

  it('saves once when "Finish" is pressed twice while the save is pending', async () => {
    const { store } = await open()
    await click('Next')
    const finishButton = button('Finish')
    finishButton.click(); finishButton.click()
    await store.settled(); await nextTick()
    expect(store.document!.revision).toBe(3)
    expect(store.document!.blocks.filter((block) => block.categoryId === work.id)).toHaveLength(1)
  })

  it('closes the Semana editor when the workspace finishes setup elsewhere while it is open', async () => {
    const { store } = await open()
    row('work').querySelector<HTMLButtonElement>('.routine-line')!.click()
    await nextTick(); await nextTick()
    expect(dialogs()).toHaveLength(2)
    await store.commit((draft) => { draft.settings.onboardingDone = true })
    await nextTick()
    await vi.waitFor(() => expect(dialogs()).toHaveLength(0))
  })
})
