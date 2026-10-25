import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import type { ExternalOccurrence } from '@/core/model'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import { AssistantError, type AssistantProvider } from './provider'
import { RulesProvider } from './RulesProvider'
import { createAssistant } from './useAssistant'
import AssistantView from './AssistantView.vue'

let assistant: ReturnType<typeof createAssistant>
vi.mock('./useAssistant', async (importOriginal) => ({ ...(await importOriginal<typeof import('./useAssistant')>()), useAssistant: () => assistant }))
let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); localStorage.clear(); setExternalOccurrenceSource(async () => []); vi.restoreAllMocks() })

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
  await vi.waitFor(() => expect(assistant.availability.webllm).toBe('downloadable'))

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

async function mountView(model: Partial<AssistantProvider> = {}, preference?: 'webllm') {
  if (preference) localStorage.setItem('next168-assistant-provider', preference)
  assistant = createAssistant({ rules: new RulesProvider(), webllm: { id: 'webllm', availability: async () => 'unavailable', prepare: async () => undefined, ask: async () => ({ answer: 'From the model.' }), dispose: async () => undefined, ...model } })
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  i18n.global.locale.value = 'en'
  host = document.createElement('div'); document.body.append(host)
  app = createApp(AssistantView).use(pinia).use(i18n); app.mount(host)
  await nextTick()
  await vi.waitFor(() => expect(assistant.availability.webllm).not.toBe('checking'))
  await nextTick()
  return host
}

const order = (view: HTMLElement) => [...view.querySelectorAll('[data-testid=back-button], [data-testid=composer], [data-testid=suggestions], [data-testid=notes]')].map((element) => element.getAttribute('data-testid'))

it('without the model offers only the suggested questions: no question box, no model status, no WebGPU', async () => {
  const view = await mountView()
  expect(order(view)).toEqual(['back-button', 'suggestions', 'notes'])
  expect(view.querySelectorAll('[data-testid=suggestions] button')).toHaveLength(3)
  expect(view.querySelector('input, textarea')).toBeNull()
  expect(view.querySelector('[data-testid=assistant-status]')).toBeNull()
  expect(view.textContent).not.toMatch(/WebGPU|On-device model|Not available/)
  expect(view.querySelector('.card')).toBeNull()
})

it('without the model keeps the suggestions after an answer, so the screen never ends in a dead end', async () => {
  const view = await mountView()
  view.querySelector<HTMLButtonElement>('[data-testid=suggestions] button')!.click()
  await vi.waitFor(() => expect(view.querySelectorAll('[data-role=assistant]')).toHaveLength(1))
  expect(view.querySelector('[data-role=user]')!.textContent).toBe('How many free hours do I have?')
  expect(view.querySelectorAll('[data-testid=suggestions] button')).toHaveLength(3)
})

it('passes loaded external calendar occurrences to assistant.ask for the next suggestion', async () => {
  const external: ExternalOccurrence[] = [{ sourceId: 'calendar', uid: 'meeting', title: 'Client call', start: '2026-10-21T10:05:00Z', end: '2026-10-21T11:00:00Z', busy: true, allDay: false }]
  setExternalOccurrenceSource(async () => external)
  const view = await mountView()
  const ask = vi.spyOn(assistant, 'ask')

  view.querySelectorAll<HTMLButtonElement>('[data-testid=suggestions] button')[1]!.click()

  await vi.waitFor(() => expect(ask).toHaveBeenCalledWith(
    i18n.global.t('assistant.suggestions.next'),
    expect.objectContaining({ external }),
  ))
})

it('with the model in use puts the question box at the bottom, under the conversation', async () => {
  const view = await mountView({ availability: async () => 'available' }, 'webllm')
  expect(order(view)).toEqual(['back-button', 'suggestions', 'composer', 'notes'])
  const input = view.querySelector<HTMLInputElement>('#assistant-question')!
  input.value = 'Move exercise to 7 am'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  view.querySelector<HTMLFormElement>('[data-testid=composer]')!.requestSubmit()
  await vi.waitFor(() => expect(view.querySelector('[data-role=assistant]')?.textContent).toBe('From the model.'))
  // The conversation sits above the box; the suggestions give way to it.
  expect(view.querySelector('[data-testid=suggestions]')).toBeNull()
  expect(view.querySelector('[data-testid=chat]')!.compareDocumentPosition(view.querySelector('[data-testid=composer]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('offers the download only after the person chose the on-device model in Settings', async () => {
  const quick = await mountView({ availability: async () => 'downloadable' })
  expect(quick.querySelector('[aria-labelledby=optin-title]')).toBeNull()
  expect(quick.querySelector('[data-testid=composer]')).toBeNull()
  app?.unmount(); host?.remove(); localStorage.clear()
  const chosen = await mountView({ availability: async () => 'downloadable' }, 'webllm')
  expect(chosen.querySelector('[aria-labelledby=optin-title]')).not.toBeNull()
  // Not downloaded yet: still no box that could not act.
  expect(chosen.querySelector('[data-testid=composer]')).toBeNull()
})
