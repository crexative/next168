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
import { setupOpen } from '@/features/onboarding/reopen'
import TodayView from './TodayView.vue'
import { setupRequest } from '@/features/onboarding/reopen'

// Saturday 2026-10-24. Family 10:00–14:00, Reading 15:00–16:00, Sleep 22:00–06:00, plus one task inside Family.
const base: PlannerDocument = {
  ...testDocument({ workspaceId: 'ws-today' }), revision: 1,
  settings: { ...testDocument().settings, onboardingDone: true },
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
let repos: ReturnType<typeof createTestRepositories>

async function mount(at: string, seed: PlannerDocument = base) {
  vi.setSystemTime(new Date(at))
  const pinia = createPinia()
  setActivePinia(pinia)
  repos = createTestRepositories()
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

const clock = (value: string | undefined) => value?.replace(/\s/g, ' ')
const controlOf = (selector: string) => host.querySelector<HTMLButtonElement>(`${selector} [data-testid="status-control"]`)
const taskCircle = () => controlOf('[data-kind="task"]')

describe('Today header and cards', () => {
  it('replaces the two-row card with one line: the date and the live free hours', async () => {
    await mount('2026-10-24T12:00:00Z')
    expect(text('today-subtitle')).toBe('Saturday, October 24 · 23 h free this week')
    expect(host.querySelector('[data-testid="free-hours"], [data-testid="day-progress"], .today-stats')).toBeNull()
  })

  it('says only the date while the first-run setup is open, then the free hours once it is done', async () => {
    setupOpen.value = true
    try {
      const store = await mount('2026-10-24T12:00:00Z', { ...base, settings: { ...base.settings, onboardingDone: false } })
      expect(text('today-subtitle')).toBe('Saturday, October 24')
      await store.commit((draft) => { draft.settings.onboardingDone = true })
      await nextTick()
      expect(text('today-subtitle')).toBe('Saturday, October 24 · 23 h free this week')
    } finally {
      setupOpen.value = false
    }
  })

  it('shows the free hours again when the first-run setup is closed without finishing', async () => {
    setupOpen.value = true
    try {
      await mount('2026-10-24T12:00:00Z', { ...base, settings: { ...base.settings, onboardingDone: false } })
      expect(text('today-subtitle')).toBe('Saturday, October 24')
      setupOpen.value = false
      await nextTick()
      expect(text('today-subtitle')).toBe('Saturday, October 24 · 23 h free this week')
    } finally {
      setupOpen.value = false
    }
  })

  it('keeps the subtitle number in step with the plan: whole hours, never tenths', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    await store.commit((draft) => { draft.blocks.push({ id: 'walk', categoryId: 'family', title: 'Walk', days: [6], start: 1000, end: 1090 }) })
    await nextTick()
    // 90 more planned minutes today: 23 h 0 min - 1 h 30 min = 21 h 30 min, shown rounded.
    expect(text('today-subtitle')).toMatch(/· 2[12] h free this week$/)
    expect(text('today-subtitle')).not.toMatch(/[.,]\d/)
  })

  it('puts a placed task in "Next" when it starts before the next block', async () => {
    await mount('2026-10-24T14:30:00Z')
    expect(clock(text('now-title'))).toBe('Free time until 3:00 PM')
    expect(text('now-next')).toContain('Reading')
  })

  it('starts a re-fitted task on a tidy five-minute time, not at the minute the plan was recalculated', async () => {
    await mount('2026-10-24T12:31:30Z')
    const start = host.querySelector('[data-kind="task"] [data-testid="timeline-start"]')?.textContent
    expect(clock(start)).toBe('12:35 PM')
    expect(clock(host.querySelector('[data-kind="task"] [data-testid="timeline-end"]')?.textContent)).toBe('1:05 PM')
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
  it('does not ask for status inside the Now card while the block is mid-way, even when the plan existed before', async () => {
    await mount('2026-10-24T12:00:00Z')
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Family lunch')
    expect(controlOf('.now-card')).toBeNull()
    expect(host.querySelector('[role="group"]')).toBeNull()
  })

  it('asks in the last minutes of the block when older evidence shows the plan existed', async () => {
    await mount('2026-10-24T13:55:00Z')
    expect(controlOf('.now-card')?.getAttribute('aria-label')).toBe('Mark Family lunch as done')
  })

  it('does not ask about a block that started before the plan was first seen', async () => {
    await mount('2026-10-24T13:55:00Z', { ...base, checkIns: [], tasks: [] })
    // First time the plan is seen at 13:55 (no older evidence): Family lunch started at 10:00 and is not asked.
    expect(controlOf('.now-card')).toBeNull()
    expect(host.querySelector('[data-testid="status-control"]')).toBeNull()
  })

  it('completes a task from its row and undoes it from the toast', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    taskCircle()!.click()
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeTruthy()
    expect(taskCircle()).toBeNull()
    const toast = useUndoToast()
    expect(toast.toast.value?.message).toBe('Task done: Call grandma')
    toast.undo()
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeUndefined()
    expect(taskCircle()).not.toBeNull()
  })

  it('asks about a block that started after the stored “plan first seen” moment, even with no other evidence', async () => {
    window.localStorage.setItem('next168-plan-since:ws-today', String(Date.parse('2026-10-24T09:00:00Z')))
    await mount('2026-10-24T13:55:00Z', { ...base, checkIns: [], tasks: [] })
    expect(controlOf('.now-card')?.getAttribute('aria-label')).toBe('Mark Family lunch as done')
  })

  it('stamps the finish time with the current moment', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    taskCircle()!.click()
    await store.settled()
    expect(store.document?.tasks[0]?.doneAt).toBe('2026-10-24T12:00:00.000Z')
  })

  it('shows no “done” toast when the save did not go through', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    vi.spyOn(repos.planner, 'save').mockResolvedValueOnce({ kind: 'error', reason: 'disk-full' })
    taskCircle()!.click()
    await store.settled()
    await nextTick()
    expect(useUndoToast().toast.value).toBeNull()
    expect(store.document?.tasks[0]?.doneAt).toBeUndefined()
  })

  it('leaves the task done and raises no error when the undo no longer applies', async () => {
    const store = await mount('2026-10-24T12:00:00Z')
    taskCircle()!.click()
    await store.settled()
    await store.commit((draft) => { draft.tasks[0]!.title = 'Renamed on another device' })
    useUndoToast().undo()
    await store.settled()
    await nextTick()
    expect(store.document?.tasks[0]?.doneAt).toBeTruthy()
    expect(store.error).toBeNull()
  })

  it('does not let an all-day busy calendar entry push today’s tasks out of the plan', async () => {
    setExternalOccurrenceSource(async () => [{ sourceId: 's', uid: 'holiday', title: 'Holiday', start: '2026-10-24', end: '2026-10-25', allDay: true, busy: true }])
    await mount('2026-10-24T12:00:00Z')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    expect(taskCircle()).not.toBeNull()
  })

  it('shows only the date and the free hours on a day with nothing to do', async () => {
    await mount('2026-10-24T12:00:00Z', { ...base, blocks: [], tasks: [], checkIns: [] })
    expect(text('today-subtitle')).toBe('Saturday, October 24 · 36 h free this week')
  })

  it('does not pull focus to the check-in card when Today opens without a fresh save', async () => {
    await mount('2026-10-24T20:30:00Z')
    expect(host.querySelector('[data-testid="checkin-card"]')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(window.document.activeElement).toBe(window.document.body)
  })
})

describe('Today block status', () => {
  const lunchRow = () => [...host.querySelectorAll<HTMLElement>('[data-testid="timeline-item"]')].find((row) => row.textContent?.includes('Family lunch'))!
  const lunchCircle = () => lunchRow().querySelector<HTMLButtonElement>('[data-testid="status-control"]')!
  const actuals = (store: Awaited<ReturnType<typeof mount>>) => store.document!.actuals.map((actual) => [actual.blockId, actual.status])
  const answered = (status: 'done' | 'partial' | 'skipped'): PlannerDocument => ({
    ...base,
    actuals: [{ date: '2026-10-24', blockId: 'family', categoryId: 'family', plannedStartAt: '2026-10-24T10:00:00.000Z', plannedEndAt: '2026-10-24T14:00:00.000Z', plannedMinutes: 240, status, ...(status === 'partial' ? { actualMinutes: 60 } : {}) }],
  })

  it('marks a finished block done with one tap, tells so in a toast and undoes it', async () => {
    const store = await mount('2026-10-24T14:30:00Z')
    expect(lunchCircle().getAttribute('data-status')).toBe('none')
    lunchCircle().click()
    await store.settled()
    await nextTick()
    expect(actuals(store)).toEqual([['family', 'done']])
    expect(lunchCircle().getAttribute('data-status')).toBe('done')
    expect(useUndoToast().toast.value?.message).toBe('Family lunch: Done')
    useUndoToast().undo()
    await store.settled()
    await nextTick()
    expect(actuals(store)).toEqual([])
    expect(lunchCircle().getAttribute('data-status')).toBe('none')
  })

  it('undoes an answer back to the previous one exactly, minutes included', async () => {
    const store = await mount('2026-10-24T14:30:00Z', answered('partial'))
    lunchCircle().click()
    await store.settled()
    expect(store.document!.actuals[0]).toMatchObject({ status: 'done' })
    expect(store.document!.actuals[0]).not.toHaveProperty('actualMinutes')
    useUndoToast().undo()
    await store.settled()
    expect(store.document!.actuals[0]).toMatchObject({ status: 'partial', actualMinutes: 60 })
  })

  it('takes a done answer back with a second tap, and the toast offers it again', async () => {
    const store = await mount('2026-10-24T14:30:00Z', answered('done'))
    lunchCircle().click()
    await store.settled()
    await nextTick()
    expect(actuals(store)).toEqual([])
    expect(useUndoToast().toast.value?.message).toBe('Answer removed: Family lunch')
    useUndoToast().undo()
    await store.settled()
    expect(actuals(store)).toEqual([['family', 'done']])
  })

  it('does not overwrite a newer answer when the undo no longer applies, and raises no error', async () => {
    const store = await mount('2026-10-24T14:30:00Z')
    lunchCircle().click()
    await store.settled()
    await store.commit((draft) => { draft.actuals[0]!.status = 'skipped' })
    useUndoToast().undo()
    await store.settled()
    await nextTick()
    expect(actuals(store)).toEqual([['family', 'skipped']])
    expect(store.error).toBeNull()
  })

  it('shows no toast and keeps the circle open when the save did not go through', async () => {
    const store = await mount('2026-10-24T14:30:00Z')
    vi.spyOn(repos.planner, 'save').mockResolvedValueOnce({ kind: 'error', reason: 'disk-full' })
    lunchCircle().click()
    await store.settled()
    await nextTick()
    expect(useUndoToast().toast.value).toBeNull()
    expect(actuals(store)).toEqual([])
  })

  it('commits once when the circle is tapped twice before the first save settles', async () => {
    const store = await mount('2026-10-24T14:30:00Z')
    const save = vi.spyOn(repos.planner, 'save')
    const circle = lunchCircle()
    circle.click()
    circle.click()
    await store.settled()
    expect(save).toHaveBeenCalledTimes(1)
    expect(actuals(store)).toEqual([['family', 'done']])
  })

  it('asks the question of a block still in progress only from its last ten minutes', async () => {
    await mount('2026-10-24T13:49:00Z')
    expect(host.querySelector('[data-testid="status-control"][aria-label="Mark Family lunch as done"]')).toBeNull()
    app!.unmount(); host.remove()
    await mount('2026-10-24T13:50:00Z')
    expect(controlOf('.now-card')).not.toBeNull()
  })
})

describe('Today wiring', () => {
  const empty: PlannerDocument = { ...base, blocks: [], tasks: [], settings: { ...base.settings, onboardingDone: true } }

  it('offers "Set up my week" on an empty Today instead of the link to Week, and opening it writes nothing', async () => {
    const store = await mount('2026-10-24T12:00:00Z', empty)
    const prompt = host.querySelector<HTMLButtonElement>('[data-testid="setup-week"]')!
    expect(prompt.textContent).toBe('Set up my week · 1 min')
    expect(host.querySelector('a[href="#/week"]')).toBeNull()
    const revision = store.document!.revision
    const requests = setupRequest.value
    prompt.click()
    await store.settled()
    expect(setupRequest.value).toBe(requests + 1)
    expect(store.document!.revision).toBe(revision)
    expect(store.document!.settings.onboardingDone).toBe(true)
  })

  it('keeps the link to Week when the planner is read-only and the wizard cannot be offered', async () => {
    const store = await mount('2026-10-24T12:00:00Z', empty)
    store.$patch({ status: 'readonly' })
    await nextTick()
    expect(store.writable).toBe(false)
    expect(host.querySelector('[data-testid="setup-week"]')).toBeNull()
    expect(host.querySelector('a[href="#/week"]')).not.toBeNull()
  })

  it('reaches the assistant through the toolbar icon only', async () => {
    const toolbar = document.createElement('div')
    toolbar.id = 'toolbar-actions'
    document.body.appendChild(toolbar)
    try {
      await mount('2026-10-24T12:00:00Z')
      await nextTick()
      expect(toolbar.querySelector('[data-testid="assistant-entry"]')?.getAttribute('href')).toBe('#/assistant')
      expect(host.querySelector('a[href="#/assistant"]')).toBeNull()
    } finally {
      toolbar.remove()
    }
  })
})

it('keeps the header separator attached on both sides at a wrap boundary', async () => {
  await mount('2026-10-24T12:00:00Z')
  expect(host.querySelector('[data-testid="today-subtitle"]')?.textContent).toContain('\u00a0·\u00a0')
})
