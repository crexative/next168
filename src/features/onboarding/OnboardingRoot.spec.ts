// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { testDocument, fixedNow } from '@/repositories/testSupport'
import CheckInView from '@/features/checkin/CheckInView.vue'
import { WebLlmProvider, type WebLlmEngine } from '@/features/assistant/WebLlmProvider'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { PERSIST_REQUESTED_KEY } from '@/features/settings/data/storageProtection'
import OnboardingRoot from './OnboardingRoot.vue'

const screen = { render: () => [h(OnboardingRoot), h(CheckInView)] }
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

async function clickSetup(testId: string): Promise<void> {
  // The screen that is leaving (inert, aria-hidden) may still be in the DOM for a frame.
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>(`[data-testid=setup] [data-testid=${testId}]`)]
  buttons.find((button) => button.closest('[aria-hidden=true]') === null)!.click()
  await mounted!.store.settled()
  await nextTick()
  await nextTick()
}

async function saveCheckIn(date: string): Promise<void> {
  const form = mounted!.host.querySelector<HTMLFormElement>('form.checkin-form')!
  const dateInput = form.querySelector<HTMLInputElement>('input[type=date]')!
  dateInput.value = date
  dateInput.dispatchEvent(new Event('input'))
  dateInput.dispatchEvent(new Event('change'))
  await nextTick()
  const note = form.querySelector('textarea')!
  note.value = 'A day worth keeping'
  note.dispatchEvent(new Event('input'))
  await nextTick()
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  await mounted!.store.settled()
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
    await mounted.store.settled()
    await nextTick()
    expect(mounted.store.document!.settings.onboardingDone).toBe(false)
  } else {
    // Skip every question, then start with an empty week.
    for (const screen of ['sleep', 'workStudy', 'exercise', 'more']) {
      expect(document.body.querySelector('[data-testid=setup]')!.getAttribute('data-screen')).toBe(screen)
      await clickSetup('setup-secondary')
    }
    await clickSetup('setup-primary')
    await vi.waitFor(() => expect(mounted!.store.document!.settings.onboardingDone).toBe(true))
  }
  expect(mounted.store.document!.checkIns).toEqual([])
  expect(persist).not.toHaveBeenCalled()
  expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).toBeNull()

  await prepareAssistant()
  expect(persist).not.toHaveBeenCalled()

  await saveCheckIn('2026-10-23')
  expect(mounted.store.document!.checkIns).toHaveLength(1)
  expect(persist).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).not.toBeNull()
  await saveCheckIn('2026-10-24')
  expect(mounted.store.document!.checkIns).toHaveLength(2)
  expect(persist).toHaveBeenCalledTimes(1)
  await prepareAssistant()
  expect(persist).toHaveBeenCalledTimes(1)

  const saved = structuredClone(mounted.store.document!)
  mounted.unmount()
  mounted = await mountWithPlanner(screen, saved)
  expect(persist).toHaveBeenCalledTimes(1)
})
