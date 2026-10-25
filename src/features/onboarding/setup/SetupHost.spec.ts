// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore, type PlannerRepositoryWithExtras } from '@/stores/plannerStore'
import { documentFingerprint } from '@/repositories/storageCommit'
import { createTestRepositories, fixedNow, MemoryStore, mutexRunner, newTestId, testDocument } from '@/repositories/testSupport'
import type { RunExclusive } from '@/repositories/storageCommit'
import { draftOf, saveDraft } from '../draftStorage'
import { setupRequest } from '../reopen'
import { createState } from '../setupModel'
import { env } from '../setupFixtures'
import SetupHost from './SetupHost.vue'

// The guided setup's lifecycle on a real store and repository: what a draft is applied to, the single guarded commit,
// what a refused commit shows, and what nothing may do while a save is pending.
const DRAFT_KEY = 'next168-setup-draft'
const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue' as const, icon: '💼', goal: { type: 'max' as const, hoursPerWeek: 40 } }
const WORK_BLOCK = { id: 'b-work', categoryId: 'c-work', title: 'Work', days: [1, 2, 3, 4, 5] as PlannerDocument['blocks'][number]['days'], start: 540, end: 1020 }
const firstRun = (extra: Partial<PlannerDocument> = {}): PlannerDocument => ({ ...testDocument({ workspaceId: 'ws-1' }), settings: { ...testDocument().settings, onboardingDone: false }, ...extra })

let app: App | undefined
let host: HTMLElement | undefined

interface Mounted { store: ReturnType<typeof usePlannerStore>; memory: MemoryStore; stored: () => PlannerDocument }

async function mount(document: PlannerDocument | null, options: { runExclusive?: RunExclusive; withoutGuard?: boolean } = {}): Promise<Mounted> {
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
  app = createApp(SetupHost).use(pinia).use(i18n)
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
    const close = window.document.body.querySelector<HTMLButtonElement>('[role=dialog] .sheet-close')!
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
    window.document.body.querySelector<HTMLButtonElement>('[role=dialog] .sheet-close')!.click()
    await settle()
    expect({ document: memory.data.get('document'), backup: memory.data.get('backup') }).toEqual(bytes)
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!)).toMatchObject({ open: false, screen: 'workStudy' })
    expect(localStorage.getItem('next168-setup-dismissed')).toBe('ws-1')
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
