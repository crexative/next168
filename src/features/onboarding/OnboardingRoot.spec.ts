// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { h, nextTick, ref } from 'vue'
import { testDocument, fixedNow } from '@/repositories/testSupport'
import CheckInView from '@/features/checkin/CheckInView.vue'
import { WebLlmProvider, type WebLlmEngine } from '@/features/assistant/WebLlmProvider'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { PERSIST_REQUESTED_KEY } from '@/features/settings/data/storageProtection'
import OnboardingRoot from './OnboardingRoot.vue'

// The check-in is its own full-screen route: it is on screen only while a test fills it in.
const checkInShown = ref(false)
const screen = { render: () => [h(OnboardingRoot), checkInShown.value ? h(CheckInView) : null] }
const persist = vi.fn().mockResolvedValue(true)
const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage')
let mounted: Mounted | undefined

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  persist.mockClear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fixedNow())
  Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true })
})

afterEach(() => {
  mounted?.unmount()
  document.body.innerHTML = ''
  if (storageDescriptor) Object.defineProperty(navigator, 'storage', storageDescriptor)
  else Reflect.deleteProperty(navigator, 'storage')
  vi.useRealTimers()
})

async function prepareAssistant(): Promise<void> {
  const engine: WebLlmEngine = {
    chat: { completions: { create: async () => ({ choices: [] }) } },
    interruptGenerate: () => undefined,
    unload: async () => undefined,
  }
  const provider = new WebLlmProvider({
    probe: async () => ({ webGpu: true, shaderF16: true, maxBufferSize: undefined, deviceMemoryGb: undefined, storageQuotaBytes: undefined, storageUsageBytes: undefined }),
    createWorker: () => ({ terminate: () => undefined }) as unknown as Worker,
    loadModule: async () => ({
      CreateWebWorkerMLCEngine: async () => engine,
      hasModelInCache: async () => false,
      deleteModelAllInfoInCache: async () => undefined,
    }),
  })
  try {
    await provider.prepare(() => undefined, new AbortController().signal)
  } finally {
    await provider.dispose()
  }
}

async function clickSetup(testId: string, nextScreen: string | null): Promise<void> {
  // The screen that is leaving (inert, aria-hidden) may still be in the DOM for a frame.
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>(`[data-testid=setup] [data-testid=${testId}]`)]
  buttons.find((button) => button.closest('[aria-hidden=true]') === null)!.click()
  await vi.waitFor(() => {
    const setup = document.body.querySelector('[data-testid=setup]')
    if (nextScreen === null) expect(setup).toBeNull()
    else expect(setup?.getAttribute('data-screen')).toBe(nextScreen)
  })
}

// The check-in closes today: there is no date to pick, so a second save edits the same day's entry.
// The check-in conversation (teleported to the body): leave every question for later, then write the note and save.
async function saveCheckIn(text: string): Promise<void> {
  checkInShown.value = true
  await nextTick()
  const step = () => document.body.querySelector<HTMLElement>('[data-testid="checkin"]')?.dataset.step
  while (step() !== 'final') {
    document.body.querySelector<HTMLButtonElement>('[data-testid="checkin-skip"]')!.click()
    await nextTick()
  }
  document.body.querySelector<HTMLButtonElement>('[data-testid="checkin-add-note"]')?.click()
  await nextTick()
  const note = document.body.querySelector<HTMLTextAreaElement>('[data-testid="checkin-note"]')!
  note.value = text
  note.dispatchEvent(new Event('input'))
  await nextTick()
  document.body.querySelector<HTMLButtonElement>('[data-testid="checkin-save"]')!.click()
  await mounted!.store.settled()
  await nextTick()
  checkInShown.value = false
  await nextTick()
}

it.each([
  ['close', true], ['finish', true], ['close', false], ['finish', false],
] as const)('%s with persistence granted=%s requests only after the first check-in, once across model loads and reloads', async (completion, granted) => {
  persist.mockResolvedValue(granted)
  mounted = await mountWithPlanner(screen, { settings: { ...testDocument().settings, onboardingDone: false } })
  await vi.waitFor(() => expect(document.body.querySelector('[data-testid=setup]')).not.toBeNull())
  expect(persist).not.toHaveBeenCalled()
  if (completion === 'close') {
    // Closing writes nothing: the first setup stays unfinished.
    document.body.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label="Not now"]')!.click()
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid=setup]')).toBeNull())
    expect(mounted.store.document!.settings.onboardingDone).toBe(false)
  } else {
    // Skip every question, then start with an empty week.
    for (const [screen, nextScreen] of [['sleep', 'workStudy'], ['workStudy', 'exercise'], ['exercise', 'more'], ['more', 'summary']] as const) {
      expect(document.body.querySelector('[data-testid=setup]')!.getAttribute('data-screen')).toBe(screen)
      await clickSetup('setup-secondary', nextScreen)
    }
    await clickSetup('setup-primary', null)
    await vi.waitFor(() => expect(mounted!.store.document!.settings.onboardingDone).toBe(true))
  }
  expect(mounted.store.document!.checkIns).toEqual([])
  expect(persist).not.toHaveBeenCalled()
  expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).toBeNull()

  await prepareAssistant()
  expect(persist).not.toHaveBeenCalled()

  await saveCheckIn('A day worth keeping')
  expect(mounted.store.document!.checkIns).toHaveLength(1)
  expect(persist).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).not.toBeNull()
  await saveCheckIn('Added the same evening')
  expect(mounted.store.document!.checkIns).toEqual([expect.objectContaining({ note: 'Added the same evening' })])
  expect(persist).toHaveBeenCalledTimes(1)
  await prepareAssistant()
  expect(persist).toHaveBeenCalledTimes(1)

  const saved = structuredClone(mounted.store.document!)
  mounted.unmount()
  mounted = await mountWithPlanner(screen, saved)
  expect(persist).toHaveBeenCalledTimes(1)
})
