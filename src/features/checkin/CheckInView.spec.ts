// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import { setHourCycle } from '@/ui/format'
import CheckInView from './CheckInView.vue'
import { consumeSavedFlag } from './checkinFlash'

// 2026-10-24 is a Saturday; the plan sleeps every night 22:00 → 06:00 and works Monday to Friday 09:00 → 17:00.
const sleepCategory = { id: 'sleep', name: 'Sleep', colorKey: 'purple' as const, icon: '😴', goal: { type: 'none' as const, hoursPerWeek: 0 } }
const workCategory = { id: 'work', name: 'Work', colorKey: 'blue' as const, icon: '💼', goal: { type: 'max' as const, hoursPerWeek: 40 } }
const planned: PlannerDocument = {
  ...testDocument(), revision: 1, categories: [sleepCategory, workCategory],
  blocks: [
    { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'work', categoryId: 'work', title: 'Work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  ],
}

let app: App | undefined
let host: HTMLElement

let repos: ReturnType<typeof createTestRepositories>

async function mount(first: PlannerDocument, cold = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  host = document.createElement('div')
  document.body.appendChild(host)
  await repos.planner.save(first, 0)
  if (!cold) await store.load()
  i18n.global.locale.value = 'en'
  app = createApp(CheckInView).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  return store
}

const clock = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim()
const text = (testId: string) => clock(host.querySelector(`[data-testid="${testId}"]`)?.textContent)
const radios = (group: number) => host.querySelectorAll('[role="radiogroup"]')[group]!.querySelectorAll<HTMLButtonElement>('[role="radio"]')
const submit = () => host.querySelector<HTMLButtonElement>('.checkin-form > button[type=submit]')!.click()

async function editFact(testId: string, value: string): Promise<void> {
  host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button`)!.click()
  await nextTick()
  const field = host.querySelector<HTMLInputElement>(`[data-testid="${testId}"] input`)!
  field.value = value
  field.dispatchEvent(new Event('input'))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await nextTick()
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(fixedNow()); window.location.hash = '' })
afterEach(() => { useUndoToast().dismiss(); document.querySelector('.toolbar-inner')?.remove(); app?.unmount(); host?.remove(); app = undefined; vi.runOnlyPendingTimers(); vi.useRealTimers(); i18n.global.locale.value = 'en' })

describe('check-in form', () => {
  it('has a back control to Today, since the check-in has no tab', async () => {
    await mount(planned)
    const back = host.querySelector<HTMLAnchorElement>('[data-testid="back-button"]')!
    expect(back.getAttribute('href')).toBe('#/today')
    expect(back.getAttribute('aria-label')).toBe('Back to Today')
    expect(host.querySelector('form')!.contains(back)).toBe(false)
  })

  it('puts the back control top-leading in the shell toolbar when there is one, not under the title', async () => {
    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar-inner'
    document.body.appendChild(toolbar)
    await mount(planned)
    await nextTick()
    expect(toolbar.querySelector('[data-testid="back-button"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="back-button"]')).toBeNull()
    expect(toolbar.querySelector('.toolbar-back')?.classList.contains('is-in-toolbar')).toBe(true)
  })

  it('names the day in a line of its own and has no date field to pick', async () => {
    await mount(planned)
    expect(text('checkin-date')).toBe('Saturday, October 24')
    expect(host.querySelector('input[type=date]')).toBeNull()
    expect(host.textContent).not.toContain('Date you woke up')
  })

  it('says the night and the morning as sentences, prefilled from the plan, and says where they come from', async () => {
    await mount(planned)
    expect(text('fact-bedtime')).toBe('You went to bed at 10:00 PM last night')
    expect(text('fact-wake')).toBe('You woke up at 6:00 AM today')
    expect(host.querySelector('[data-testid="plan-hint"]')?.textContent).toContain('Times come from your plan')
    expect(host.querySelector('[data-testid="fact-bedtime"] button')?.getAttribute('aria-label')).toBe('You went to bed at 10:00\u00a0PM last night. Change')
  })

  // verify4 defect 14: "…a las 10:00 p. m.. Cambiar" and "¿A qué hora…?. Cambiar" in the accessible names.
  it.each(['en', 'es', 'fr', 'pt', 'de'])('never doubles the end of a sentence in an accessible name (%s, 12 h)', async (locale) => {
    setHourCycle('h12')
    try {
      for (const document of [planned, { ...planned, blocks: [] }]) {
        await mount(document)
        i18n.global.locale.value = locale
        await nextTick()
        const labels = [...host.querySelectorAll('[data-testid^="fact-"] button')].map((button) => button.getAttribute('aria-label') ?? '')
        expect(labels.length).toBeGreaterThan(0)
        for (const label of labels) expect(label, label).not.toMatch(/\.\.(?!\.)|[?!]\./u)
        app!.unmount(); host.remove(); app = undefined
      }
    } finally {
      setHourCycle('auto')
    }
  })

  it('opens the time of a sentence when it is tapped, and goes back to the sentence once it is set', async () => {
    await mount(planned)
    host.querySelector<HTMLButtonElement>('[data-testid="fact-bedtime"] button')!.click()
    await nextTick()
    const field = host.querySelector<HTMLInputElement>('[data-testid="fact-bedtime"] input')!
    expect(field.value).toBe('22:00')
    expect(host.querySelector('[data-testid="fact-bedtime"] label')?.textContent).toBe('When did you go to bed last night?')
    expect(window.document.activeElement).toBe(field)
    field.value = '23:30'
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await nextTick()
    expect(host.querySelector('[data-testid="fact-bedtime"] input')).toBeNull()
    expect(text('fact-bedtime')).toBe('You went to bed at 11:30 PM last night')
    expect(window.document.activeElement).toBe(host.querySelector('[data-testid="fact-bedtime"] button'))
  })

  it('asks the question while a time is unknown, and agrees the Spanish article with the hour', async () => {
    await mount({ ...planned, blocks: [] })
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(text('fact-bedtime')).toBe('¿A qué hora te acostaste anoche?')
    await editFact('fact-bedtime', '01:30')
    expect(text('fact-bedtime')).toBe('Anoche te acostaste a la 1:30')
    await editFact('fact-bedtime', '23:00')
    expect(text('fact-bedtime')).toBe('Anoche te acostaste a las 23:00')
  })

  it('hides "work ended" on a day without work and shows it for a stored time', async () => {
    await mount(planned)
    expect(host.querySelector('[data-testid="fact-work-end"]')).toBeNull()
    app!.unmount(); host.remove()
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', workEnd: 1080 }] })
    expect(text('fact-work-end')).toBe('You finished work at 6:00 PM today')
  })

  it('fills "work ended" from the plan on a day with work', async () => {
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    await mount(planned)
    expect(text('fact-work-end')).toBe('You finished work at 5:00 PM today')
  })

  it('shows a saved check-in exactly as stored, without the plan’s times', async () => {
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1410, wake: 420 }] })
    expect(text('fact-bedtime')).toBe('You went to bed at 11:30 PM last night')
    expect(text('fact-wake')).toBe('You woke up at 7:00 AM today')
    expect(host.querySelector('[data-testid="plan-hint"]')).toBeNull()
  })

  it('asks only stress, with its end words, and no second exercise question', async () => {
    await mount(planned)
    const groups = [...host.querySelectorAll('[role="radiogroup"]')]
    expect(groups).toHaveLength(1)
    expect(host.querySelector(`#${CSS.escape(groups[0]!.getAttribute('aria-labelledby')!)}`)?.textContent).toBe('Stress today')
    expect(radios(0)).toHaveLength(5)
    expect(host.textContent).not.toContain('Did you exercise?')
    const ends = host.querySelector('[data-testid="choice-ends"]')!
    expect([...ends.querySelectorAll('[aria-hidden="true"]')].map((node) => node.textContent)).toEqual(['calm', 'high'])
    expect(groups[0]!.getAttribute('aria-describedby')).toBe(ends.id)
    expect(ends.querySelector('.visually-hidden')?.textContent).toBe('1 is calm, 5 is high stress')
    // Nothing is picked yet, yet the row stays reachable with Tab through its first choice.
    expect([...radios(0)].filter((radio) => radio.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('after midnight and before 04:00 closes the day before, and saves it there', async () => {
    vi.setSystemTime(new Date('2026-10-25T00:30:00Z'))
    const store = await mount(planned)
    expect(text('checkin-date')).toBe('Saturday, October 24')
    radios(0)[1]!.click()
    await nextTick()
    submit()
    await store.settled()
    expect(store.document?.checkIns.map((checkIn) => checkIn.date)).toEqual(['2026-10-24'])
  })

  it.each([
    ['America/Bogota', '2026-10-25T00:30:00Z', '2026-10-24', 'Saturday, October 24'],
    ['America/Bogota', '2026-10-25T05:30:00Z', '2026-10-24', 'Saturday, October 24'],
    ['America/Bogota', '2026-10-25T08:59:00Z', '2026-10-24', 'Saturday, October 24'],
    ['America/Bogota', '2026-10-25T09:00:00Z', '2026-10-25', 'Sunday, October 25'],
    ['Europe/Madrid', '2026-03-29T01:30:00Z', '2026-03-28', 'Saturday, March 28'],
    ['Europe/Madrid', '2026-03-29T02:00:00Z', '2026-03-29', 'Sunday, March 29'],
    ['Europe/Madrid', '2026-10-25T02:59:00Z', '2026-10-24', 'Saturday, October 24'],
    ['Europe/Madrid', '2026-10-25T03:00:00Z', '2026-10-25', 'Sunday, October 25'],
  ])('captures the planner day on cold load in %s at %s', async (timeZone, instant, date, label) => {
    vi.setSystemTime(new Date(instant))
    const store = await mount({ ...planned, settings: { ...planned.settings, timeZone }, checkIns: [{ date, note: 'stored for this day' }] }, true)
    expect(host.querySelector('form')).toBeNull()
    await store.load()
    await nextTick()
    expect(text('checkin-date')).toBe(label)
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('stored for this day')
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date, note: 'stored for this day' }])
  })

  it('captures at document arrival, then keeps the displayed day across midnight and 04:00', async () => {
    vi.setSystemTime(new Date('2026-10-25T08:59:00Z')) // 03:59 in Bogota
    const store = await mount({ ...planned, settings: { ...planned.settings, timeZone: 'America/Bogota' } }, true)
    vi.setSystemTime(new Date('2026-10-25T09:00:00Z')) // The document arrives at 04:00.
    await store.load()
    await nextTick()
    expect(text('checkin-date')).toBe('Sunday, October 25')
    for (const instant of ['2026-10-26T05:30:00Z', '2026-10-26T09:00:00Z']) {
      vi.setSystemTime(new Date(instant))
      document.dispatchEvent(new Event('visibilitychange'))
      await store.commit((draft) => { draft.settings.weekStartsOn = 0 })
      await nextTick()
      expect(text('checkin-date')).toBe('Sunday, October 25')
    }
    submit()
    await store.settled()
    expect(store.document?.checkIns.map((entry) => entry.date)).toEqual(['2026-10-25'])
  })

  it('saves with one tap on stress, returns to Today and leaves the confirmation for its card', async () => {
    const store = await mount(planned)
    radios(0)[1]!.click()
    await nextTick()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1320, wake: 360, stress: 2 }])
    expect(window.location.hash).toBe('#/today')
    expect(consumeSavedFlag()).toBe(true)
  })

  it('saves the times as changed', async () => {
    const store = await mount(planned)
    await editFact('fact-bedtime', '23:15')
    await editFact('fact-wake', '07:30')
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1395, wake: 450 }])
  })

  it('moves the selection with the arrow keys', async () => {
    await mount(planned)
    const first = radios(0)
    first[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(first[0]!.getAttribute('aria-checked')).toBe('false')
    expect(first[1]!.getAttribute('aria-checked')).toBe('true')
  })

  it('clears the optional answer and removes its stored field on save', async () => {
    const store = await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1320, wake: 360, stress: 3, note: 'ok' }] })
    const clear = () => host.querySelector<HTMLButtonElement>('[data-testid="choice-clear"]')
    expect([...radios(0)].filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    clear()!.click()
    await nextTick()
    expect([...radios(0)].filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(0)
    // Nothing left to clear, and focus did not vanish with the button.
    expect(clear()).toBeNull()
    expect(window.document.activeElement?.getAttribute('role')).toBe('radio')
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1320, wake: 360, note: 'ok' }])
  })

  it('offers no clear action while the question is unanswered, and names the question when it is', async () => {
    await mount(planned)
    expect(host.querySelectorAll('[data-testid="choice-clear"]')).toHaveLength(0)
    app!.unmount(); host.remove()
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', stress: 4 }] })
    expect(host.querySelector('[data-testid="choice-clear"]')?.getAttribute('aria-label')).toBe('Clear: Stress today')
  })

  it('keeps what was typed through unrelated commits and reloads when its own entry changes elsewhere', async () => {
    const store = await mount(planned)
    const note = host.querySelector<HTMLTextAreaElement>('textarea')!
    note.value = 'typed, not saved'
    note.dispatchEvent(new Event('input'))
    await store.commit((draft) => { draft.checkIns.push({ date: '2026-10-20', note: 'another day' }); draft.settings.weekStartsOn = 0 })
    await nextTick()
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('typed, not saved')
    await store.commit((draft) => { draft.checkIns.push({ date: '2026-10-24', note: 'synced from another device' }) })
    await nextTick()
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('synced from another device')
  })

  it('removes the entry when every answer has been cleared', async () => {
    const store = await mount({ ...planned, checkIns: [{ date: '2026-10-24', stress: 3 }] })
    host.querySelectorAll<HTMLButtonElement>('[data-testid="choice-clear"]').forEach((button) => button.click())
    await nextTick()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([])
  })
})

// Saturday 2026-10-24, now 12:00 UTC: Gym 08:00–09:00 and Run 10:00–11:00 are over, Yoga 11:50–13:00 is in its last
// minutes' reach only after 12:50, and an older check-in shows the plan existed before today.
const exerciseCategory = { id: 'exercise', name: 'Exercise', colorKey: 'green' as const, icon: '🏃', goal: { type: 'min' as const, hoursPerWeek: 4 } }
const trained: PlannerDocument = {
  ...planned, categories: [...planned.categories, exerciseCategory],
  checkIns: [{ date: '2026-10-20' }],
  blocks: [
    ...planned.blocks,
    { id: 'gym', categoryId: 'exercise', title: 'Gym', days: [6], start: 480, end: 540 },
    { id: 'run', categoryId: 'exercise', title: 'Run', days: [6], start: 600, end: 660 },
    { id: 'yoga', categoryId: 'exercise', title: 'Yoga', days: [6], start: 710, end: 780 },
  ],
}
const circle = (title: string) => [...host.querySelectorAll<HTMLElement>('[data-testid="checkin-block"]')].find((row) => row.textContent?.includes(title))?.querySelector<HTMLButtonElement>('[data-testid="status-control"]')
const listed = () => [...host.querySelectorAll('[data-testid="checkin-block"] .t-body')].map((node) => node.textContent)

describe('check-in blocks to mark', () => {
  it('lists today’s finished blocks that are still unmarked, with the timeline’s circle, and nothing else', async () => {
    await mount(trained)
    // Yoga is mid-way (ends 13:00) and Sleep has its own sentences.
    expect(listed()).toEqual(['Gym', 'Run'])
    expect(text('checkin-blocks')).toContain('Not marked yet')
    expect(circle('Gym')!.getAttribute('aria-label')).toBe('Mark Gym as done')
    expect(host.querySelector('[data-testid="checkin-block"] .tabular')?.textContent?.replace(/\s/g, ' ')).toBe('8:00 AM – 9:00 AM')
  })

  it('leaves out blocks that are already marked, and the whole list when nothing is left', async () => {
    const answered = (blockId: string, plannedStartAt: string, plannedEndAt: string) => ({
      date: '2026-10-24', blockId, categoryId: 'exercise', plannedStartAt, plannedEndAt, plannedMinutes: 60, status: 'done' as const,
    })
    await mount({ ...trained, actuals: [answered('gym', '2026-10-24T08:00:00.000Z', '2026-10-24T09:00:00.000Z')] })
    expect(listed()).toEqual(['Run'])
    app!.unmount(); host.remove()
    await mount({ ...trained, actuals: [answered('gym', '2026-10-24T08:00:00.000Z', '2026-10-24T09:00:00.000Z'), answered('run', '2026-10-24T10:00:00.000Z', '2026-10-24T11:00:00.000Z')] })
    expect(host.querySelector('[data-testid="checkin-blocks"]')).toBeNull()
  })

  it('does not ask about blocks that started before the plan was first seen, nor when it was never seen', async () => {
    window.localStorage.setItem(`next168-plan-since:${trained.workspaceId}`, String(Date.parse('2026-10-24T09:30:00Z')))
    await mount({ ...trained, checkIns: [] })
    // Gym (08:00) began before the plan existed; Run (10:00) did not.
    expect(listed()).toEqual(['Run'])
    app!.unmount(); host.remove()
    window.localStorage.clear()
    await mount({ ...trained, checkIns: [] })
    expect(host.querySelector('[data-testid="checkin-blocks"]')).toBeNull()
  })

  it('keeps a block listed while it is answered here, showing its answer, so the toast can undo it', async () => {
    const store = await mount(trained)
    circle('Gym')!.click()
    await store.settled()
    await nextTick()
    expect(listed()).toEqual(['Gym', 'Run'])
    expect(circle('Gym')!.getAttribute('data-status')).toBe('done')
    expect(useUndoToast().toast.value?.message).toBe('Gym: Done')
    useUndoToast().undo()
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toEqual([])
    expect(circle('Gym')!.getAttribute('data-status')).toBe('none')
  })

  it('derives exercise from the blocks: a done block is a yes, saved with the check-in', async () => {
    const store = await mount(trained)
    circle('Gym')!.click()
    await store.settled()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ date: '2026-10-24', exercise: 'yes' })
  })

  it.each(['click', 'Enter'])('saving partial minutes by %s leaves the wrap-up open and unsaved', async (method) => {
    expect(consumeSavedFlag()).toBe(false)
    window.location.hash = '#/checkin'
    const store = await mount(trained)
    const note = host.querySelector<HTMLTextAreaElement>('textarea')!
    note.value = 'draft wrap-up'
    note.dispatchEvent(new Event('input'))
    circle('Gym')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="status-partial"]')!.click()
    await nextTick()
    const panel = host.querySelector<HTMLElement>('[data-testid="status-minutes"]')!
    const input = panel.querySelector<HTMLInputElement>('input')!
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (method === 'click') panel.querySelector<HTMLButtonElement>('button')!.click()
    else {
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      input.dispatchEvent(enter)
      expect(enter.defaultPrevented).toBe(true)
    }
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toMatchObject([{ blockId: 'gym', status: 'partial', actualMinutes: 25 }])
    expect(store.document?.checkIns).toEqual(trained.checkIns)
    expect(window.location.hash).toBe('#/checkin')
    expect(consumeSavedFlag()).toBe(false)
    expect(note.value).toBe('draft wrap-up')
    expect(host.querySelector('form form')).toBeNull()
    expect(panel.tagName).not.toBe('FORM')
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ date: '2026-10-24', exercise: 'yes', note: 'draft wrap-up' })
    expect(window.location.hash).toBe('#/today')
  })

  it('clears a saved exercise answer after the last mark is removed, including a queued clear', async () => {
    const store = await mount(trained)
    circle('Gym')!.click()
    await store.settled()
    submit()
    await store.settled()
    await nextTick()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
    circle('Gym')!.click()
    submit()
    await store.settled()
    expect(store.document?.actuals).toEqual([])
    expect(store.document?.checkIns.at(-1)).not.toHaveProperty('exercise')
    const persisted = await repos.planner.load()
    expect(persisted.kind).toBe('ok')
    if (persisted.kind === 'ok') expect(persisted.document.checkIns.at(-1)).not.toHaveProperty('exercise')
  })

  it.each(['yes', 'no', 'not-planned'] as const)('clears a stale %s answer when planned exercise is unmarked', async (exercise) => {
    const store = await mount({ ...trained, checkIns: [{ date: '2026-10-24', exercise, note: 'keep me' }] })
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', note: 'keep me' }])
  })

  it.each([false, true])('preserves a legacy answer only without exercise blocks (category present: %s)', async (categoryPresent) => {
    const store = await mount({ ...planned, categories: categoryPresent ? trained.categories : planned.categories, checkIns: [{ date: '2026-10-24', exercise: 'yes' }] })
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', exercise: 'yes' }])
  })

  it('forgets which blocks it listed when the workspace is replaced', async () => {
    const store = await mount(trained)
    circle('Gym')!.click()
    await store.settled()
    await nextTick()
    expect(listed()).toEqual(['Gym', 'Run'])
    // Another workspace (imported, restored) where Gym was answered long ago: it has no reason to stay on this list.
    store.document = { ...structuredClone(trained), workspaceId: 'ws-imported', actuals: structuredClone(store.document!.actuals) }
    await nextTick()
    await nextTick()
    expect(listed()).toEqual(['Run'])
  })

  it('reads the timeline inside the save, so a mark still being written is not missed', async () => {
    const store = await mount(trained)
    circle('Gym')!.click()
    // The mark is queued, not yet applied: the save queued after it must still see it.
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
  })

  it('derives a no when every exercise block was skipped', async () => {
    const store = await mount({ ...trained, blocks: trained.blocks.filter((block) => block.id !== 'run' && block.id !== 'yoga') })
    circle('Gym')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="status-skipped"]')!.click()
    await store.settled()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'no' })
  })

  it('states nothing while an exercise block is still unmarked, and reads the timeline as it stands when saving', async () => {
    const store = await mount(trained)
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).not.toHaveProperty('exercise')
    window.location.hash = ''
    // Marked elsewhere (another tab) after this form loaded: the save still agrees with the timeline.
    await store.commit((draft) => { draft.actuals.push({ date: '2026-10-24', blockId: 'run', categoryId: 'exercise', plannedStartAt: '2026-10-24T10:00:00.000Z', plannedEndAt: '2026-10-24T11:00:00.000Z', plannedMinutes: 60, status: 'partial', actualMinutes: 30 }) })
    await nextTick()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
  })
})

it.each(['fr', 'de', 'es'])('shows the full back label until it reaches a visible toolbar title (%s)', async (language) => {
  const toolbar = document.createElement('header')
  toolbar.className = 'toolbar'
  toolbar.innerHTML = '<div class="toolbar-inner"><span class="toolbar-title">Title</span><div class="toolbar-actions"></div></div>'
  document.body.appendChild(toolbar)
  let available = 280
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const left = this.classList.contains('toolbar-title') ? available : this.classList.contains('toolbar-actions') ? 300 : 0
    const width = this.matches('.back-button span') ? 110 : this.matches('.back-button svg') ? 22 : 320
    return { left, right: left + width, width, height: 44, top: 0, bottom: 44, x: left, y: 0, toJSON() {} }
  })
  try {
    await mount(planned)
    i18n.global.locale.value = language
    await nextTick()
    const back = toolbar.querySelector<HTMLAnchorElement>('.back-button')!
    expect(back.classList.contains('is-icon-only')).toBe(false)
    toolbar.setAttribute('data-collapsed', 'true')
    available = 70
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(back.classList.contains('is-icon-only')).toBe(true)
    expect(back.getAttribute('aria-label')).toContain(i18n.global.t('app.tabs.today'))
    available = 240
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(back.classList.contains('is-icon-only')).toBe(false)
    toolbar.removeAttribute('data-collapsed')
    available = 70
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(back.classList.contains('is-icon-only')).toBe(false)
  } finally { geometry.mockRestore(); toolbar.remove() }
})
