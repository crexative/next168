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
import { dropDraft } from './checkInDraft'

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

// The check-in is a conversation in a full-screen frame teleported to the body (R_Cierre).
const frame = () => document.body.querySelector<HTMLElement>('.setup-frame')
const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector)
const clock = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim()
const text = (testId: string) => clock($(`[data-testid="${testId}"]`)?.textContent)
const question = () => text('checkin-question')
const step = () => $('[data-testid="checkin"]')?.dataset.step
const answers = () => [...document.body.querySelectorAll('[data-testid^="answer-"].answer')].map((node) => clock(node.textContent))
const tap = async (testId: string) => { $<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click(); await nextTick() }
const skip = () => tap('checkin-skip')
const submit = () => $<HTMLButtonElement>('[data-testid="checkin-save"]')!.click()
// Answers stress (or leaves it) and reaches the last turn, where the note and "Save" are.
async function toFinal(stress?: string): Promise<void> {
  while (step() !== 'final') {
    if (step() === 'stress' && stress) await tap(`stress-${stress}`)
    else await skip()
  }
}

async function editFact(fact: string, value: string): Promise<void> {
  const told = $<HTMLButtonElement>(`[data-testid="answer-${fact}"]`)
  if (told) { told.click(); await nextTick() }
  const field = $<HTMLInputElement>('[data-testid="fact-input"]')!
  field.value = value
  field.dispatchEvent(new Event('input'))
  field.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
  await nextTick()
}

beforeEach(() => { dropDraft(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(fixedNow()); window.location.hash = '' })
afterEach(() => { vi.unstubAllGlobals(); useUndoToast().dismiss(); app?.unmount(); host?.remove(); app = undefined; vi.runOnlyPendingTimers(); vi.useRealTimers(); i18n.global.locale.value = 'en' })

describe('check-in conversation', () => {
  it('opens as a full-screen conversation whose × leads back to Today, since the check-in has no tab', async () => {
    window.location.hash = '#/checkin'
    await mount(planned)
    expect(frame()?.getAttribute('role')).toBe('dialog')
    const close = $<HTMLButtonElement>('.setup-close')!
    expect(close.getAttribute('aria-label')).toBe('Back to Today')
    close.click()
    expect(window.location.hash).toBe('#/today')
  })

  it('names the day in a line of its own and has no date field to pick', async () => {
    await mount(planned)
    expect(text('checkin-date')).toBe('Day wrap-up · Saturday, October 24')
    expect($('input[type=date]')).toBeNull()
  })

  it('tells the night and the morning from the plan as your answers, and asks only what is still open', async () => {
    await mount(planned)
    expect(answers()).toEqual(['You went to bed at 10:00 PM last night', 'You woke up at 6:00 AM today'])
    expect(step()).toBe('stress')
    expect(question()).toBe('How stressed were you today?')
    // Told facts are not counted as parts: stress and the last turn are.
    expect(clock($('.progress .count')?.textContent)).toBe('Part 1 of 2')
    expect($('[data-testid="answer-bedtime"]')?.getAttribute('aria-label')).toBe('Change: When did you go to bed last night? You went to bed at 10:00\u00a0PM last night')
  })

  // verify4 defect 14: "…a las 10:00 p. m.. Cambiar" and "¿A qué hora…?. Cambiar" in the accessible names.
  it.each(['en', 'es', 'fr', 'pt', 'de'])('never doubles the end of a sentence in an accessible name (%s, 12 h)', async (locale) => {
    setHourCycle('h12')
    try {
      await mount(planned)
      i18n.global.locale.value = locale
      await nextTick()
      const labels = [...document.body.querySelectorAll('.answer')].map((button) => button.getAttribute('aria-label') ?? '')
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) expect(label, label).not.toMatch(/\.\.(?!\.)|[?!]\./u)
    } finally {
      setHourCycle('auto')
    }
  })

  it('asks a told time again when it is tapped, prefilled, and goes back to the open question once it is set', async () => {
    await mount(planned)
    await tap('answer-bedtime')
    expect(step()).toBe('bedtime')
    expect(question()).toBe('When did you go to bed last night?')
    expect($<HTMLInputElement>('[data-testid="fact-input"]')!.value).toBe('22:00')
    await editFact('bedtime', '23:30')
    expect(answers()[0]).toBe('You went to bed at 11:30 PM last night')
    expect(step()).toBe('stress')
  })

  it('counts a told time being changed as no part: the count shows the next part asked', async () => {
    await mount(planned)
    await tap('answer-wake')
    expect(step()).toBe('wake')
    expect(clock($('.progress .count')?.textContent)).toBe('Part 1 of 2')
  })

  it('keeps a question left for later in the conversation, to answer before saving', async () => {
    const store = await mount(planned)
    await skip()
    expect(step()).toBe('final')
    const open = $<HTMLButtonElement>('[data-testid="answer-stress"]')!
    expect(clock(open.textContent)).toBe('Not answered')
    expect(open.getAttribute('aria-label')).toBe('Answer: How stressed were you today? Not answered')
    open.click()
    await nextTick()
    expect(step()).toBe('stress')
    await tap('stress-4')
    expect(step()).toBe('final')
    expect(text('answer-stress')).toBe('4')
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ date: '2026-10-24', stress: 4 })
  })

  it('keeps unsaved answers when closed with × and shows them again on reopening, until saved', async () => {
    window.location.hash = '#/checkin'
    await mount(planned)
    await tap('stress-2')
    expect(frame()?.dataset).toBeDefined()
    $<HTMLButtonElement>('.setup-close')!.click()
    app!.unmount(); host.remove()
    const store = await mount(planned)
    await toFinal()
    expect(text('answer-stress')).toBe('2')
    submit()
    await store.settled()
    app!.unmount(); host.remove()
    await mount({ ...planned, checkIns: [] })
    expect(step()).toBe('stress')
  })

  it('never brings back an answer undone after reopening: the next close keeps only what is still unsaved', async () => {
    window.location.hash = '#/checkin'
    const reopen = async (document: PlannerDocument) => { $<HTMLButtonElement>('.setup-close')!.click(); app!.unmount(); host.remove(); return mount(document) }
    await mount(planned)
    await tap('stress-2')
    await reopen(planned)
    expect(text('answer-stress')).toBe('2')
    expect(text('checkin-unsaved')).toBe('Your earlier answers are not saved yet.')
    await tap('answer-stress')
    await skip()
    await reopen(planned)
    expect(step()).toBe('stress')
    expect($('[data-testid="checkin-unsaved"]')).toBeNull()

    // The same over a saved answer: 3 saved, 5 kept on close, then set back to 3 and closed.
    const saved = { ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1320, wake: 360, stress: 3 as const }] }
    await reopen(saved)
    await tap('answer-stress')
    await tap('stress-5')
    await reopen(saved)
    expect(text('answer-stress')).toBe('5')
    await tap('answer-stress')
    await tap('stress-3')
    const store = await reopen(saved)
    expect(text('answer-stress')).toBe('3')
    expect($('[data-testid="checkin-unsaved"]')).toBeNull()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toMatchObject([{ date: '2026-10-24', stress: 3 }])
  })

  it('asks a told time again, with its question, when its answer was withdrawn', async () => {
    await mount(planned)
    await tap('answer-bedtime')
    await skip()
    const row = $('[data-step="bedtime"]')!
    expect(clock(row.querySelector('.turn-question')?.textContent)).toBe('When did you go to bed last night?')
    expect(text('answer-bedtime')).toBe('Not answered')
  })

  it('tells a time saved elsewhere while the check-in is open, instead of asking it', async () => {
    const store = await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1320, stress: 2 }] })
    expect(step()).toBe('wake')
    await store.commit((draft) => { draft.checkIns = [{ date: '2026-10-24', bedtime: 1320, wake: 390, stress: 2 }] })
    await nextTick()
    await nextTick()
    expect(step()).toBe('final')
    expect(answers()).toContain('You woke up at 6:30 AM today')
    expect($('[data-step="wake"] .turn-question')).toBeNull()
  })

  it('asks a time while it is unknown, and agrees the Spanish article with the hour', async () => {
    await mount({ ...planned, blocks: [] })
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(question()).toBe('¿A qué hora te acostaste anoche?')
    await editFact('bedtime', '01:30')
    expect(answers()).toEqual(['Anoche te acostaste a la 1:30'])
    await editFact('bedtime', '23:00')
    expect(answers()).toEqual(['Anoche te acostaste a las 23:00'])
  })

  it('leaves "work ended" out on a day without work and tells it for a stored time', async () => {
    await mount(planned)
    expect($('[data-testid="answer-workEnd"]')).toBeNull()
    app!.unmount(); host.remove()
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1320, wake: 360, workEnd: 1080 }] })
    expect(text('answer-workEnd')).toBe('You finished work at 6:00 PM today')
  })

  it('fills "work ended" from the plan on a day with work', async () => {
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
    await mount(planned)
    expect(text('answer-workEnd')).toBe('You finished work at 5:00 PM today')
  })

  it('tells a saved check-in exactly as stored, without the plan’s times', async () => {
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1410, wake: 420 }] })
    expect(text('answer-bedtime')).toBe('You went to bed at 11:30 PM last night')
    expect(text('answer-wake')).toBe('You woke up at 7:00 AM today')
  })

  it('asks stress as five visible replies with their end words, and no exercise question', async () => {
    await mount(planned)
    const replies = [...document.body.querySelectorAll('[data-testid^="stress-"]')].map((reply) => reply.textContent?.trim())
    expect(replies).toEqual(['1', '2', '3', '4', '5'])
    expect(text('checkin-question')).toBe('How stressed were you today?')
    expect(frame()!.textContent).not.toContain('Did you exercise?')
    expect([...document.body.querySelectorAll('.ends span')].map((node) => node.textContent)).toEqual(['calm', 'high'])
    expect($('.quick-replies')?.getAttribute('aria-label')).toBe('How stressed were you today? 1 is calm, 5 is high stress')
  })

  it('after midnight and before 04:00 closes the day before, and saves it there', async () => {
    vi.setSystemTime(new Date('2026-10-25T00:30:00Z'))
    const store = await mount(planned)
    expect(text('checkin-date')).toBe('Day wrap-up · Saturday, October 24')
    await toFinal('2')
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
    expect($('[data-testid="checkin"]')).toBeNull()
    await store.load()
    await nextTick()
    expect(text('checkin-date')).toBe(`Day wrap-up · ${label}`)
    await toFinal()
    expect($<HTMLTextAreaElement>('[data-testid="checkin-note"]')!.value).toBe('stored for this day')
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
    expect(text('checkin-date')).toBe('Day wrap-up · Sunday, October 25')
    for (const instant of ['2026-10-26T05:30:00Z', '2026-10-26T09:00:00Z']) {
      vi.setSystemTime(new Date(instant))
      document.dispatchEvent(new Event('visibilitychange'))
      await store.commit((draft) => { draft.settings.weekStartsOn = 0 })
      await nextTick()
      expect(text('checkin-date')).toBe('Day wrap-up · Sunday, October 25')
    }
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.map((entry) => entry.date)).toEqual(['2026-10-25'])
  })

  it('answers stress with one tap, then saves, returns to Today and leaves the confirmation for its row', async () => {
    const store = await mount(planned)
    await tap('stress-2')
    expect(step()).toBe('final')
    expect(question()).toBe('This is your wrap-up for today.')
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1320, wake: 360, stress: 2 }])
    expect(window.location.hash).toBe('#/today')
    expect(consumeSavedFlag()).toBe(true)
  })

  it('saves the times as changed', async () => {
    const store = await mount(planned)
    await editFact('bedtime', '23:15')
    await editFact('wake', '07:30')
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1395, wake: 450 }])
  })

  it('withdraws an answer that is being changed when it is left for later, and removes its stored field', async () => {
    const store = await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1320, wake: 360, stress: 3, note: 'ok' }] })
    expect(step()).toBe('final')
    await tap('answer-stress')
    expect(step()).toBe('stress')
    expect($('[data-testid="stress-3"]')?.getAttribute('aria-pressed')).toBe('true')
    await skip()
    expect(text('answer-stress')).toBe('Not answered')
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1320, wake: 360, note: 'ok' }])
  })

  it('keeps what was typed through unrelated commits and reloads when its own entry changes elsewhere', async () => {
    const store = await mount(planned)
    await toFinal()
    await tap('checkin-add-note')
    const note = $<HTMLTextAreaElement>('[data-testid="checkin-note"]')!
    note.value = 'typed, not saved'
    note.dispatchEvent(new Event('input'))
    await store.commit((draft) => { draft.checkIns.push({ date: '2026-10-20', note: 'another day' }); draft.settings.weekStartsOn = 0 })
    await nextTick()
    expect($<HTMLTextAreaElement>('[data-testid="checkin-note"]')!.value).toBe('typed, not saved')
    await store.commit((draft) => { draft.checkIns.push({ date: '2026-10-24', note: 'synced from another device' }) })
    await nextTick()
    // The entry reloads as stored (no times in it), so its open questions come first again.
    expect(step()).toBe('bedtime')
    await toFinal()
    expect($<HTMLTextAreaElement>('[data-testid="checkin-note"]')!.value).toBe('synced from another device')
  })

  it('removes the entry when every answer has been withdrawn', async () => {
    const store = await mount({ ...planned, blocks: [], checkIns: [{ date: '2026-10-24', stress: 3 }] })
    // No plan, no times: the times are asked and left for later.
    while (['bedtime', 'wake', 'workEnd'].includes(step()!)) await skip()
    await tap('answer-stress')
    await skip()
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([])
  })

  it('offers the 22:00 reminder on the last turn, where it moved from Hoy', async () => {
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: async () => 'default' })
    await mount(planned)
    await toFinal()
    expect($('[data-testid="checkin-remind"]')?.getAttribute('role')).toBe('switch')
    expect(frame()!.textContent).toContain('Remind me at 10:00')
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
// The routines still unmarked are asked one by one, in order: "How did Gym go?" → Done · Partly · No.
const asked = () => {
  const titles: string[] = []
  for (const node of document.body.querySelectorAll('.turn')) {
    const line = clock(node.querySelector('.turn-question, .ask')?.textContent)
    const match = line && /^How did (.+) go\?$/.exec(line)
    if (match) titles.push(match[1]!)
  }
  return titles
}
const reply = (status: 'done' | 'partial' | 'skipped') => tap(`answer-${status}`)

describe('check-in routines to mark', () => {
  it('asks about today’s finished routines still unmarked, one at a time with their time, and nothing else', async () => {
    await mount(trained)
    // Yoga is mid-way (ends 13:00) and Sleep is told as sentences.
    expect(question()).toBe('How did Gym go?')
    expect(text('checkin-question')).toBe('How did Gym go?')
    expect(clock($('.bubble .hint')?.textContent)).toBe('8:00 AM – 9:00 AM')
    expect([...document.body.querySelectorAll('[data-testid^="answer-"].quick-reply')].map((node) => node.textContent?.trim())).toEqual(['Done', 'Partly', 'No'])
    await reply('done')
    await usePlannerStore().settled()
    await nextTick()
    expect(question()).toBe('How did Run go?')
    expect(asked()).toEqual(['Gym', 'Run'])
    expect(clock($('.progress .count')?.textContent)).toBe('Part 2 of 4')
  })

  it('leaves out routines that are already marked', async () => {
    const answered = (blockId: string, plannedStartAt: string, plannedEndAt: string) => ({
      date: '2026-10-24', blockId, categoryId: 'exercise', plannedStartAt, plannedEndAt, plannedMinutes: 60, status: 'done' as const,
    })
    await mount({ ...trained, actuals: [answered('gym', '2026-10-24T08:00:00.000Z', '2026-10-24T09:00:00.000Z')] })
    expect(question()).toBe('How did Run go?')
    app!.unmount(); host.remove()
    await mount({ ...trained, actuals: [answered('gym', '2026-10-24T08:00:00.000Z', '2026-10-24T09:00:00.000Z'), answered('run', '2026-10-24T10:00:00.000Z', '2026-10-24T11:00:00.000Z')] })
    expect(step()).toBe('stress')
  })

  it('does not ask about routines that started before the plan was first seen, nor when it was never seen', async () => {
    window.localStorage.setItem(`next168-plan-since:${trained.workspaceId}`, String(Date.parse('2026-10-24T09:30:00Z')))
    await mount({ ...trained, checkIns: [] })
    // Gym (08:00) began before the plan existed; Run (10:00) did not.
    expect(question()).toBe('How did Run go?')
    app!.unmount(); host.remove()
    window.localStorage.clear()
    await mount({ ...trained, checkIns: [] })
    expect(step()).toBe('stress')
  })

  it('records the answer at once, keeps it in the conversation, and the toast can undo it', async () => {
    const store = await mount(trained)
    await reply('done')
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toMatchObject([{ blockId: 'gym', status: 'done' }])
    expect(text('answer-block:gym@2026-10-24T08:00:00.000Z')).toBe('Done')
    expect(useUndoToast().toast.value?.message).toBe('Gym: Done')
    useUndoToast().undo()
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toEqual([])
    expect(question()).toBe('How did Gym go?')
  })

  it('derives exercise from the routines: a done one is a yes, saved with the check-in', async () => {
    const store = await mount(trained)
    await reply('done')
    await store.settled()
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ date: '2026-10-24', exercise: 'yes' })
  })

  it('asks how many minutes for Partly, prefilled with half, and keeps the wrap-up open and unsaved', async () => {
    window.location.hash = '#/checkin'
    const store = await mount(trained)
    await reply('partial')
    const input = $<HTMLInputElement>('[data-testid="checkin-minutes"] input')!
    expect(input.value).toBe('30')
    input.value = '25'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    $('[data-testid="checkin-minutes"]')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toMatchObject([{ blockId: 'gym', status: 'partial', actualMinutes: 25 }])
    expect(text('answer-block:gym@2026-10-24T08:00:00.000Z')).toBe('Partly · 25 min')
    expect(store.document?.checkIns).toEqual(trained.checkIns)
    expect(window.location.hash).toBe('#/checkin')
    expect(consumeSavedFlag()).toBe(false)
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ date: '2026-10-24', exercise: 'yes' })
    expect(window.location.hash).toBe('#/today')
  })

  it('never records more Partly minutes than the routine had planned', async () => {
    const store = await mount(trained)
    await reply('partial')
    const input = $<HTMLInputElement>('[data-testid="checkin-minutes"] input')!
    input.value = '500'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    $('[data-testid="checkin-minutes"]')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await store.settled()
    await nextTick()
    expect(store.document?.actuals).toMatchObject([{ blockId: 'gym', status: 'partial', actualMinutes: 60 }])
  })

  it('clears a saved exercise answer after the last mark is withdrawn', async () => {
    const store = await mount(trained)
    await reply('done')
    await store.settled()
    await toFinal()
    submit()
    await store.settled()
    await nextTick()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
    await tap('answer-block:gym@2026-10-24T08:00:00.000Z')
    await skip()
    await store.settled()
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.actuals).toEqual([])
    expect(store.document?.checkIns.at(-1)).not.toHaveProperty('exercise')
  })

  it.each(['yes', 'no', 'not-planned'] as const)('clears a stale %s answer when planned exercise is unmarked', async (exercise) => {
    const store = await mount({ ...trained, checkIns: [{ date: '2026-10-24', exercise, note: 'keep me' }] })
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', note: 'keep me' }])
  })

  it.each([false, true])('preserves a legacy answer only without exercise blocks (category present: %s)', async (categoryPresent) => {
    const store = await mount({ ...planned, categories: categoryPresent ? trained.categories : planned.categories, checkIns: [{ date: '2026-10-24', exercise: 'yes' }] })
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', exercise: 'yes' }])
  })

  it('forgets which routines it asked about when the workspace is replaced', async () => {
    const store = await mount(trained)
    await reply('done')
    await store.settled()
    await nextTick()
    expect(asked()).toEqual(['Gym', 'Run'])
    // Another workspace (imported, restored) where Gym was answered long ago: it has no reason to stay in the conversation.
    store.document = { ...structuredClone(trained), workspaceId: 'ws-imported', actuals: structuredClone(store.document!.actuals) }
    await nextTick()
    await nextTick()
    expect(asked()).toEqual(['Run'])
  })

  it('reads the timeline inside the save, so a mark still being written is not missed', async () => {
    const store = await mount({ ...trained, blocks: trained.blocks.filter((block) => block.id !== 'run' && block.id !== 'yoga') })
    await reply('done')
    // The mark is queued, not yet applied: the save queued after it must still see it.
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
  })

  it('derives a no when every exercise routine was skipped', async () => {
    const store = await mount({ ...trained, blocks: trained.blocks.filter((block) => block.id !== 'run' && block.id !== 'yoga') })
    await reply('skipped')
    await store.settled()
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'no' })
  })

  it('states nothing while an exercise routine is still unmarked, and reads the timeline as it stands when saving', async () => {
    const store = await mount(trained)
    await toFinal()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).not.toHaveProperty('exercise')
    window.location.hash = ''
    // Marked elsewhere (another tab) after this conversation loaded: the save still agrees with the timeline.
    await store.commit((draft) => { draft.actuals.push({ date: '2026-10-24', blockId: 'run', categoryId: 'exercise', plannedStartAt: '2026-10-24T10:00:00.000Z', plannedEndAt: '2026-10-24T11:00:00.000Z', plannedMinutes: 60, status: 'partial', actualMinutes: 30 }) })
    await nextTick()
    submit()
    await store.settled()
    expect(store.document?.checkIns.at(-1)).toMatchObject({ exercise: 'yes' })
  })
})
