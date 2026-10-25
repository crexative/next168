// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore, type PlannerRepositoryWithExtras } from '@/stores/plannerStore'
import { documentFingerprint } from '@/repositories/storageCommit'
import { createTestRepositories, fixedNow, MemoryStore, mutexRunner, newTestId, testDocument } from '@/repositories/testSupport'
import type { RunExclusive } from '@/repositories/storageCommit'
import TodayView from '@/features/today/TodayView.vue'
import WeekView from '@/features/week/WeekView.vue'
import CategorySettings from '@/features/settings/categories/CategorySettings.vue'
import { draftOf, saveDraft } from '../draftStorage'
import { setupRequest } from '../reopen'
import { createState } from '../setupModel'
import { env } from '../setupFixtures'
import SetupHost from './SetupHost.vue'
import { registerIcons } from '@/ui/icons'
import { ArrowRight } from 'lucide-vue-next'
import { setHourCycle } from '@/ui/format'

// The guided setup's lifecycle on a real store and repository: what a draft is applied to, the single guarded commit,
// what a refused commit shows, and what nothing may do while a save is pending.
const DRAFT_KEY = 'next168-setup-draft'
const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue' as const, icon: '💼', goal: { type: 'max' as const, hoursPerWeek: 40 } }
const WORK_BLOCK = { id: 'b-work', categoryId: 'c-work', title: 'Work', days: [1, 2, 3, 4, 5] as PlannerDocument['blocks'][number]['days'], start: 540, end: 1020 }
const firstRun = (extra: Partial<PlannerDocument> = {}): PlannerDocument => ({ ...testDocument({ workspaceId: 'ws-1' }), settings: { ...testDocument().settings, onboardingDone: false }, ...extra })

let app: App | undefined
let host: HTMLElement | undefined

interface Mounted { store: ReturnType<typeof usePlannerStore>; memory: MemoryStore; stored: () => PlannerDocument }

async function mount(document: PlannerDocument | null, options: { runExclusive?: RunExclusive; withoutGuard?: boolean; entry?: Component } = {}): Promise<Mounted> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const memory = new MemoryStore()
  const repos = createTestRepositories({ store: memory, runExclusive: options.runExclusive })
  if (document) await memory.write({ document: JSON.stringify(document) })
  const repository: PlannerRepositoryWithExtras = options.withoutGuard
    ? new Proxy(repos.planner, { get: (target, key) => (key === 'saveGuarded' ? undefined : Reflect.get(target, key, target)) })
    : repos.planner
  configurePlannerStore({ repository, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  await store.load()
  i18n.global.locale.value = 'en'
  host = window.document.createElement('div')
  window.document.body.append(host)
  const entry = options.entry
  app = createApp(entry ? { render: () => [h(entry), h(SetupHost)] } : SetupHost).use(pinia).use(i18n)
  app.mount(host)
  await settle()
  return { store, memory, stored: () => JSON.parse(memory.data.get('document') as string) as PlannerDocument }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) {
    await nextTick()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const setup = () => window.document.body.querySelector<HTMLElement>('[data-testid=setup]')
const screen = () => setup()?.getAttribute('data-screen')
// The leaving screen (inert, aria-hidden) may still be in the DOM for a frame.
const live = (selector: string) => [...window.document.body.querySelectorAll<HTMLButtonElement>(`[data-testid=setup] ${selector}`)].find((element) => element.closest('[aria-hidden=true]') === null)

async function click(selector: string): Promise<void> {
  const button = live(selector)
  if (!button) throw new Error(`no ${selector} on ${screen()}`)
  button.click()
  await settle()
}

async function skipToSummary(): Promise<void> {
  for (let guard = 0; guard < 8 && screen() !== 'summary'; guard++) await click('[data-testid=setup-secondary]')
  expect(screen()).toBe('summary')
}

beforeEach(() => {
  registerIcons({ send: ArrowRight })
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  window.document.body.innerHTML = ''
  app = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('focus on arrival', () => {
  function backgroundButton(): HTMLButtonElement {
    const button = window.document.createElement('button')
    button.textContent = 'Background action'
    window.document.body.append(button)
    button.focus()
    return button
  }

  async function escape(): Promise<void> {
    window.document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(setup()).toBeNull()
  }

  const plannerBytes = (memory: MemoryStore) => ({ document: memory.data.get('document'), backup: memory.data.get('backup') })

  it('focuses Understood for an open stale draft, so Escape leaves without writing and restores background focus', async () => {
    const opener = backgroundButton()
    const document = firstRun()
    saveDraft(draftOf(createState(document, env), { kind: 'stored', workspaceId: document.workspaceId, fingerprint: 'stale' }, true))
    const { memory, stored } = await mount(document)
    const before = plannerBytes(memory)
    expect(setup()!.querySelector('[data-testid=changed-elsewhere]')).not.toBeNull()
    expect(window.document.activeElement).toBe(live('[data-testid=understood]'))
    await escape()
    expect(window.document.activeElement).toBe(opener)
    expect(plannerBytes(memory)).toEqual(before)
    expect(stored()).toEqual(document)
  })

  it('focuses Understood when a closed stale draft is reopened, and Escape writes no planner data', async () => {
    const opener = backgroundButton()
    const document = firstRun({ settings: { ...testDocument().settings, onboardingDone: true } })
    saveDraft(draftOf(createState(document, env), { kind: 'stored', workspaceId: document.workspaceId, fingerprint: 'stale' }, false))
    const { memory } = await mount(document)
    const before = plannerBytes(memory)
    expect(setup()).toBeNull()
    setupRequest.value += 1
    await settle()
    expect(window.document.activeElement).toBe(live('[data-testid=understood]'))
    await escape()
    expect(window.document.activeElement).toBe(opener)
    expect(plannerBytes(memory)).toEqual(before)
  })

  it('focuses Understood after a save conflict replaces the conversation inside the open frame', async () => {
    const { memory } = await mount(firstRun())
    await skipToSummary()
    // The focused conversation disappears when the refused save reveals the conflict notice.
    live('[data-testid=setup-primary]')!.focus()
    await memory.write({ document: JSON.stringify(firstRun({ categories: [WORK] })) })
    const before = plannerBytes(memory)
    await click('[data-testid=setup-primary]')
    expect(window.document.activeElement).toBe(live('[data-testid=understood]'))
    await escape()
    expect(plannerBytes(memory)).toEqual(before)
  })

  it.each([
    ['Today', TodayView, '[data-testid=setup-week]'],
    ['Week', WeekView, '[data-testid=setup-week]'],
    ['Settings', CategorySettings, '[data-testid=setup-guided-row] button'],
  ] as const)('reopening from %s focuses the current question and Escape restores the opener without writing', async (_name, entry, selector) => {
    const toolbar = window.document.createElement('div')
    toolbar.id = 'toolbar-actions'
    window.document.body.append(toolbar)
    const { memory } = await mount(firstRun(), { entry })
    expect(window.document.activeElement).toBe(live('h3'))
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('workStudy')
    await escape()
    const before = plannerBytes(memory)
    const opener = host!.querySelector<HTMLButtonElement>(selector)!
    expect(opener).not.toBeNull()
    opener.focus()
    opener.click()
    await settle()
    expect(screen()).toBe('workStudy')
    expect(window.document.activeElement).toBe(live('h3'))
    await escape()
    expect(window.document.activeElement).toBe(opener)
    expect(plannerBytes(memory)).toEqual(before)
  })
})

describe('which draft is applied (A5)', () => {
  async function storedDraft(document: PlannerDocument, fingerprint: string, edit: (state: ReturnType<typeof createState>) => void): Promise<void> {
    const state = createState(document, env)
    edit(state)
    saveDraft(draftOf(state, { kind: 'stored', workspaceId: document.workspaceId, fingerprint }, true))
  }

  it('applies a draft bound to exactly the stored content, on its own screen', async () => {
    const document = firstRun({ categories: [WORK], blocks: [WORK_BLOCK] })
    await storedDraft(document, await documentFingerprint(document), (state) => { state.screen = 'workStudy'; state.categories[0]!.ranges[0]!.end = 1080 })
    await mount(document)
    expect(screen()).toBe('workStudy')
    expect(setup()!.textContent).toContain('Picking up where you left off.')
  })

  it('does not apply a draft made on other stored content: one plain message, the current week, the draft gone', async () => {
    const document = firstRun({ categories: [WORK], blocks: [WORK_BLOCK] })
    await storedDraft(document, 'another-fingerprint', (state) => { state.screen = 'workStudy'; state.categories[0]!.name = 'Draft only' })
    const { stored } = await mount(document)
    expect(setup()!.querySelector('[role=alert]')!.textContent).toBe('Your week changed in another window. Here is the current version.')
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    await click('[data-testid=understood]')
    expect(screen()).toBe('summary')
    expect(setup()!.textContent).toContain('Work')
    expect(setup()!.textContent).not.toContain('Draft only')
    expect(stored()).toEqual(document)
  })

  it('says so too when a closed draft no longer matches and the person opens the setup again', async () => {
    const document = firstRun({ settings: { ...testDocument().settings, onboardingDone: true }, categories: [WORK], blocks: [WORK_BLOCK] })
    const state = createState(document, env)
    state.screen = 'workStudy'
    saveDraft(draftOf(state, { kind: 'stored', workspaceId: document.workspaceId, fingerprint: 'another-fingerprint' }, false))
    await mount(document)
    expect(setup()).toBeNull()
    setupRequest.value += 1
    await settle()
    expect(setup()!.querySelector('[data-testid=changed-elsewhere]')).not.toBeNull()
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('never applies a draft that holds a block id the stored document does not have', async () => {
    const document = firstRun({ categories: [WORK], blocks: [WORK_BLOCK] })
    await storedDraft(document, await documentFingerprint(document), (state) => { state.screen = 'workStudy'; state.categories[0]!.ranges[0]!.blockId = 'b-gone' })
    await mount(document)
    expect(setup()!.querySelector('[data-testid=changed-elsewhere]')).not.toBeNull()
    await click('[data-testid=understood]')
    expect(screen()).toBe('summary')
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })
})

describe('a refused commit (R3.1)', () => {
  it('writes nothing, says so once, reloads and shows the current week; a second save works on it', async () => {
    const { memory, stored, store } = await mount(firstRun())
    await skipToSummary()
    // Another window replaces the content without moving the revision, and this tab is not told.
    const other = firstRun({ categories: [{ ...WORK, id: 'c-other', name: 'From the other window' }] })
    await memory.write({ document: JSON.stringify(other) })
    const load = vi.spyOn(store, 'load')
    await click('[data-testid=setup-primary]')
    expect(stored()).toEqual(other)
    expect(load).toHaveBeenCalled()
    expect(setup()!.querySelector('[role=alert]')!.textContent).toBe('Your week changed in another window. Here is the current version.')
    await click('[data-testid=understood]')
    expect(screen()).toBe('summary')
    expect(setup()!.textContent).toContain('From the other window')
    await click('[data-testid=setup-primary]')
    expect(setup()).toBeNull()
    expect(stored().revision).toBe(other.revision + 1)
    expect(stored().categories.map((category) => category.name)).toEqual(['From the other window'])
    expect(stored().settings.onboardingDone).toBe(true)
  })

  it('keeps the existing error screen when the reload is not usable', async () => {
    const { memory, store } = await mount(firstRun())
    await skipToSummary()
    await memory.write({ document: JSON.stringify(firstRun({ categories: [WORK] })) })
    // The refusal is real; the explicit reload that follows cannot read storage any more.
    const load = store.load
    vi.spyOn(store, 'load').mockImplementation(async () => { memory.failReads = true; await load() })
    await click('[data-testid=setup-primary]')
    expect(store.status).toBe('error')
    expect(setup()).toBeNull()
  })
})

describe('while a save is pending (R3.2, A24)', () => {
  function gatedLock(): { runExclusive: RunExclusive; hold: () => void; release: () => void } {
    const inner = mutexRunner()
    let gate: Promise<void> = Promise.resolve()
    let open: () => void = () => undefined
    return {
      runExclusive: (task) => inner(async () => { await gate; return task() }),
      hold: () => { gate = new Promise((resolve) => { open = resolve }) },
      release: () => open(),
    }
  }

  it('is inert: nothing closes it, nothing can be edited, a second Save is ignored, and one revision is written', async () => {
    const lock = gatedLock()
    const { stored } = await mount(firstRun(), { runExclusive: lock.runExclusive })
    const before = stored().revision
    await skipToSummary()
    lock.hold()
    live('[data-testid=setup-primary]')!.click()
    live('[data-testid=setup-primary]')!.click()
    await settle()
    expect(setup()!.closest('.setup-lock')!.hasAttribute('inert')).toBe(true)
    expect(setup()!.getAttribute('aria-busy')).toBe('true')
    const close = window.document.body.querySelector<HTMLButtonElement>('[role=dialog] .setup-close')!
    expect(close.disabled).toBe(true)
    close.click()
    window.document.body.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(setup()).not.toBeNull()
    lock.release()
    await settle()
    expect(setup()).toBeNull()
    expect(stored().revision).toBe(before + 1)
  })

  it('has no timer that moves the flow: ten seconds on a question leave it there', async () => {
    // Fake timers from the start, so any timer the flow sets is one this test controls.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('workStudy')
    await vi.advanceTimersByTimeAsync(10_000)
    await settle()
    expect(screen()).toBe('workStudy')
  })
})

describe('closing and finishing', () => {
  it('a first setup lands on Today; a later one stays where it was opened', async () => {
    window.location.hash = '#/week'
    await mount(firstRun())
    await skipToSummary()
    await click('[data-testid=setup-primary]')
    expect(setup()).toBeNull()
    expect(window.location.hash).toBe('#/today')
    app!.unmount()
    window.document.body.innerHTML = ''
    window.location.hash = '#/week'
    await mount(firstRun({ settings: { ...testDocument().settings, onboardingDone: true }, categories: [WORK], blocks: [WORK_BLOCK] }))
    setupRequest.value += 1
    await settle()
    expect(screen()).toBe('summary')
    await click('[data-testid=setup-primary]')
    expect(setup()).toBeNull()
    expect(window.location.hash).toBe('#/week')
  })


  it('closing writes nothing, keeps the answers and does not open by itself again', async () => {
    const { memory } = await mount(firstRun())
    await click('[data-testid=setup-primary]')
    const bytes = { document: memory.data.get('document'), backup: memory.data.get('backup') }
    window.document.body.querySelector<HTMLButtonElement>('[role=dialog] .setup-close')!.click()
    await settle()
    expect({ document: memory.data.get('document'), backup: memory.data.get('backup') }).toEqual(bytes)
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!)).toMatchObject({ open: false, screen: 'workStudy' })
    expect(localStorage.getItem('next168-setup-dismissed')).toBe('ws-1')
  })

  // verify4 defect 6: closed on a planner that was not stored yet, it opened by itself again after the first write.
  it('closed before anything is stored, it stays closed after the first write and a reload', async () => {
    const { store, memory } = await mount(null)
    expect(setup()).not.toBeNull()
    window.document.body.querySelector<HTMLButtonElement>('[role=dialog] .setup-close')!.click()
    await settle()
    expect(setup()).toBeNull()
    expect(await store.commit((draft) => { draft.settings.weekStartsOn = 0 })).toEqual({ ok: true })
    await settle()
    expect(setup()).toBeNull()

    app?.unmount()
    host?.remove()
    const pinia = createPinia()
    setActivePinia(pinia)
    const repos = createTestRepositories({ store: memory })
    configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    await usePlannerStore().load()
    expect(usePlannerStore().stored).toBe(true)
    host = window.document.createElement('div')
    window.document.body.append(host)
    app = createApp(SetupHost).use(pinia).use(i18n)
    app.mount(host)
    await settle()
    expect(setup()).toBeNull()
    // Opening it on purpose still works.
    setupRequest.value += 1
    await settle()
    expect(setup()).not.toBeNull()
  })

  it('after a save whose draft removal throws, the draft is already invalid: no message and no flow on the next load (A26)', async () => {
    const { store, stored } = await mount(firstRun())
    await skipToSummary()
    // Node versions expose sessionStorage differently (own method vs prototype), so stub both to make removal throw everywhere.
    const denied = () => { throw new DOMException('denied', 'SecurityError') }
    const removeOnProto = vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, 'removeItem').mockImplementation(denied)
    const remove = vi.spyOn(sessionStorage, 'removeItem').mockImplementation(denied)
    await click('[data-testid=setup-primary]')
    expect(stored().settings.onboardingDone).toBe(true)
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull()
    remove.mockRestore()
    removeOnProto.mockRestore()
    app!.unmount()
    window.document.body.innerHTML = ''
    const pinia = createPinia()
    setActivePinia(pinia)
    void store
    const again = await mount(stored())
    expect(setup()).toBeNull()
    expect(again.stored().revision).toBe(stored().revision)
  })
})

describe('the trust line (A34)', () => {
  it('says the data stays on this device in the browser, and is absent with the companion', async () => {
    await mount(firstRun())
    expect(setup()!.querySelector('[data-testid=setup-trust]')).not.toBeNull()
    app!.unmount()
    window.document.body.innerHTML = ''
    await mount(firstRun(), { withoutGuard: true })
    expect(setup()).not.toBeNull()
    expect(setup()!.querySelector('[data-testid=setup-trust]')).toBeNull()
  })
})

describe('the conversation', () => {
  const turns = () => [...window.document.body.querySelectorAll<HTMLButtonElement>('[data-testid=setup] [data-answer]')]
  const turn = (screen: string) => turns().find((element) => element.dataset.answer === screen)!
  const quick = (value: string) => click(`[data-value=${value}]`)

  it('shows English PM and AM in the other-time editor with a 12-hour clock', async () => {
    setHourCycle('h12')
    try {
      await mount(firstRun())
      await click('[data-field=start]')
      await click('[data-testid=other-time]')
      const period = () => live('[data-testid=time-period]')!.textContent!.trim().replace(/\s/g, ' ')

      expect(period()).toBe('PM')
      expect(period()).not.toContain('p. m.')
      await click('[data-testid=time-period]')
      expect(period()).toBe('AM')
      expect(period()).not.toMatch(/[ap]\.\s*m\./)
    } finally {
      setHourCycle('auto')
    }
  })

  it('returns from an earlier answer to the current question without reconfirming later answers', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    await quick('work')
    await click('[data-testid=setup-primary]')
    await quick('no')
    expect(screen()).toBe('exercise')
    turn('sleep').click()
    await settle()
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('exercise')
    expect(turn('commute').textContent).toContain('No')
  })

  it('asks only the newly needed study time after changing work to both', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    await quick('work')
    await click('[data-testid=setup-primary]')
    await quick('no')
    turn('workStudy').click()
    await settle()
    await quick('both')
    expect(screen()).toBe('study')
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('exercise')
    expect(turn('commute').textContent).toContain('No')
  })

  it('from the summary asks only the later range made invalid by an earlier edit, then returns to the summary', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    await quick('work')
    await click('[data-testid=setup-primary]')
    await quick('no')
    await quick('no')
    await click('[data-testid=setup-secondary]')
    expect(screen()).toBe('summary')
    turn('sleep').click()
    await settle()
    await click('[data-field=end]')
    await click('[data-testid=other-time]')
    for (let hour = 0; hour < 3; hour++) await click('[data-step=hour-up]')
    await click('[data-testid=time-use]')
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('work')
    await click('[data-field=start]')
    await click('[data-minute="600"]')
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('summary')
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).answers).toMatchObject({ commute: 'no', exercise: 'no' })
  })

  it.each(['en', 'es', 'fr', 'pt', 'de'] as const)('shows a visible send label and arrow in %s', async (locale) => {
    await mount(firstRun())
    i18n.global.locale.value = locale
    await settle()
    const send = live('[data-testid=setup-primary]')!
    expect(send.textContent?.trim()).toBe(i18n.global.t('onboarding.guided.sendShort'))
    expect(send.textContent?.trim()).not.toBe('onboarding.guided.sendShort')
    expect(send.querySelector('svg')).not.toBeNull()
  })

  it('renders the right-pointing send icon instead of arrow-up', async () => {
    await mount(firstRun())
    const send = live('[data-testid=setup-primary]')!
    const icon = send.querySelector('svg.lucide-arrow-right')
    expect(icon).not.toBeNull()
    expect(send.querySelector('svg.lucide-arrow-up')).toBeNull()
    // Sized to its 17 px label, so the word and the arrow read as one control.
    expect(icon?.getAttribute('width')).toBe('22')
    expect(icon?.getAttribute('height')).toBe('22')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(send.getAttribute('aria-label')).toBe(i18n.global.t('onboarding.guided.send'))
  })

  it('keeps every answer above the question; changing an earlier one drops what no longer applies and brings it back with that answer', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    await quick('both')
    expect(screen()).toBe('work')
    // An edit on the work screen that must survive the detour.
    const work = window.document.body.querySelector<HTMLButtonElement>('[data-testid=setup] [data-field=end]')!
    work.click()
    await settle()
    window.document.body.querySelector<HTMLButtonElement>('[data-testid=setup] [data-minute="1080"]')!.click()
    await settle()
    await click('[data-testid=setup-primary]')
    await click('[data-testid=setup-primary]')
    await quick('yes')
    expect(screen()).toBe('commuteRanges')
    expect(turns().map((element) => element.dataset.answer)).toEqual(['sleep', 'workStudy', 'work', 'study', 'commute'])
    expect(turn('workStudy').getAttribute('aria-label')).toBe('Change: Do you work or study? Both')

    turn('workStudy').click()
    await settle()
    expect(screen()).toBe('workStudy')
    expect(turns().map((element) => element.dataset.answer)).toEqual(['sleep'])
    await quick('neither')
    expect(screen()).toBe('exercise')
    expect(turns().map((element) => element.dataset.answer)).toEqual(['sleep', 'workStudy'])
    expect(turn('workStudy').textContent).toContain('Neither')

    turn('workStudy').click()
    await settle()
    await quick('both')
    // Only the trip ranges were still unanswered: work and study do not need reconfirmation.
    expect(screen()).toBe('commuteRanges')
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)!)
    expect(draft.categories.find((category: { key: string }) => category.key === 'work').ranges[0].end).toBe(1080)
    expect(draft.answers.commute).toBe('yes')
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('exercise')
  })

  it('a reload in the middle brings back the whole conversation, answers included', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    await quick('work')
    await click('[data-testid=setup-primary]')
    await quick('no')
    expect(screen()).toBe('exercise')
    const before = turns().map((element) => [element.dataset.answer, element.textContent])
    app!.unmount()
    window.document.body.innerHTML = ''
    const background = window.document.createElement('button')
    window.document.body.append(background)
    background.focus()
    await mount(firstRun())
    expect(screen()).toBe('exercise')
    expect(window.document.activeElement).toBe(live('h3'))
    expect(turns().map((element) => [element.dataset.answer, element.textContent])).toEqual(before)
    expect(before.map(([screen]) => screen)).toEqual(['sleep', 'workStudy', 'work', 'commute'])
  })

  it('Enter on the question sends the answer on show; on a quick-reply question it does nothing by itself', async () => {
    await mount(firstRun())
    const heading = live('h3')!
    expect(window.document.activeElement).toBe(heading)
    heading.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(screen()).toBe('workStudy')
    live('h3')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(screen()).toBe('workStudy')
  })

  it('not answering is a reply too, and it lands in the conversation', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-secondary]')
    expect(screen()).toBe('workStudy')
    expect(turn('sleep').textContent).toContain('Later')
  })

  it('opened at the summary of an existing week, it shows the week with no conversation behind it', async () => {
    await mount(firstRun({ settings: { ...testDocument().settings, onboardingDone: true }, categories: [WORK], blocks: [WORK_BLOCK] }))
    setupRequest.value += 1
    await settle()
    expect(screen()).toBe('summary')
    expect(window.document.activeElement).toBe(live('h3'))
    expect(turns()).toEqual([])
    expect(live('[data-testid=week-card]')).toBeDefined()
  })

  it('Send is the validation: grey with its reason while there is nothing to send, in colour once there is', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-secondary]')
    await click('[data-testid=setup-secondary]')
    await click('[data-testid=setup-secondary]')
    expect(screen()).toBe('more')
    const send = () => live('[data-testid=setup-primary]')!
    expect(send().disabled).toBe(true)
    const reason = () => window.document.getElementById(send().getAttribute('aria-describedby')!.split(' ')[1]!)
    expect(reason()!.textContent).toBe('Pick at least one, or "Later".')
    await click('[data-chip=family]')
    expect(send().disabled).toBe(false)
    expect(send().getAttribute('aria-describedby')!.split(' ')).toHaveLength(1)
    await click('[data-testid=setup-primary]')
    expect(screen()).toBe('extra:family')
    // A time with no days cannot be sent until it has one.
    await click('[data-field=days]')
    await click('[data-preset=pick]')
    await click('[data-day="6"][aria-pressed=true]')
    expect(send().disabled).toBe(true)
    expect(reason()!.textContent).toBe('First fix the time that is marked.')
  })

  it('after an answer, the next answer is in reach: focus on the first reply, or on Send when the times are ready', async () => {
    await mount(firstRun())
    await click('[data-testid=setup-primary]')
    expect(window.document.activeElement?.getAttribute('data-value')).toBe('work')
    await quick('work')
    expect(window.document.activeElement).toBe(live('[data-testid=setup-primary]'))
    expect(window.document.activeElement!.getAttribute('aria-describedby')).toBe(live('h3')!.id)
  })
})
