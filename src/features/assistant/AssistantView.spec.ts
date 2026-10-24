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

async function mountView(locale = 'en') {
  assistant = createAssistant({ rules: new RulesProvider(), webllm: { id: 'webllm', availability: async () => 'unavailable', prepare: async () => undefined, ask: async () => ({ answer: '' }), dispose: async () => undefined } })
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => locale, timeZone: () => 'UTC' })
  await usePlannerStore().load()
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  host = document.createElement('div'); document.body.append(host)
  app = createApp(AssistantView).use(pinia).use(i18n); app.mount(host)
  await nextTick()
  return host
}

it('starts with a back control, the question box and three suggested questions, in that order', async () => {
  const view = await mountView()
  const order = [...view.querySelectorAll('[data-testid=back-button], [data-testid=composer], [data-testid=suggestions], [data-testid=chat], [data-testid=notes]')].map((element) => element.getAttribute('data-testid'))
  expect(order).toEqual(['back-button', 'composer', 'suggestions', 'chat', 'notes'])
  expect(view.querySelectorAll('[data-testid=suggestions] button')).toHaveLength(3)
  expect(view.querySelector('.card')).toBeNull()
})

it('answers a suggested question with one tap and then hides the suggestions', async () => {
  const view = await mountView()
  view.querySelector<HTMLButtonElement>('[data-testid=suggestions] button')!.click()
  await vi.waitFor(() => expect(view.querySelectorAll('[data-role=assistant]')).toHaveLength(1))
  expect(view.querySelector('[data-role=user]')!.textContent).toBe('How many free hours do I have?')
  expect(view.querySelector('[data-testid=suggestions]')).toBeNull()
})

it('keeps the model status as a footnote', async () => {
  const view = await mountView()
  const note = view.querySelector('[data-testid=assistant-status]')!
  expect(note.className).toContain('t-footnote')
  await vi.waitFor(() => expect(note.textContent).toBe('Quick answers: Ready · On-device model: Not available'))
  expect(view.querySelector('footer.notes')!.contains(note)).toBe(true)
})
