import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { AssistantError, type AssistantProvider } from './provider'
import { RulesProvider } from './RulesProvider'
import { createAssistant } from './useAssistant'
import AssistantView from './AssistantView.vue'

let assistant: ReturnType<typeof createAssistant>
vi.mock('./useAssistant', async (importOriginal) => ({ ...(await importOriginal<typeof import('./useAssistant')>()), useAssistant: () => assistant }))
let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); localStorage.clear() })

it('offers a retry after a download failed online and succeeds on the second try', async () => {
  const prepare = vi.fn()
    .mockRejectedValueOnce(new AssistantError('network'))
    .mockResolvedValueOnce(undefined)
  const model: AssistantProvider = {
    id: 'webllm', availability: async () => 'downloadable', prepare, ask: async () => ({ answer: 'ok' }), dispose: async () => undefined,
  }
  assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  i18n.global.locale.value = 'en'
  host = document.createElement('div'); document.body.append(host)
  app = createApp(AssistantView).use(pinia).use(i18n); app.mount(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-testid=status-webllm]')?.textContent).toBe('Download needed'))

  await assistant.prepareModel()
  await nextTick()
  expect(host.querySelector('[data-testid=assistant-failure]')?.textContent).toContain('could not be downloaded')
  expect(host.querySelector('[data-testid=assistant-failure]')?.textContent).not.toContain('offline')
  const retry = host.querySelector<HTMLButtonElement>('[data-testid=assistant-retry]')!
  expect(retry).not.toBeNull()
  retry.click()
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(host!.querySelector('[data-testid=assistant-failure]')).toBeNull())
})
