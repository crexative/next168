import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ProposalInput, ProposalRepository } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryStore } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import AnyAiPanel from '@/features/assistant/anyAi/AnyAiPanel.vue'
import ConnectSettings from '@/features/settings/connect/ConnectSettings.vue'
import ProposalsView from './ProposalsView.vue'
import { openProposalReview } from './openProposalReview'
import { reviewing } from './reviewState'

let repository: ProposalRepository
vi.mock('./repository', () => ({ getProposalRepository: () => repository }))

let app: App
let host: HTMLElement
let planner: ReturnType<typeof usePlannerStore>
let pinia: ReturnType<typeof createPinia>
const NOW = new Date('2026-10-24T10:00:00Z')
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const byTestId = <T extends HTMLElement>(id: string) => $<T>(`[data-testid="${id}"]`)

// Exercise the real opener and its page-lifetime sheet across successive reviews.
beforeAll(async () => {
  const store = new MemoryStore()
  const document = createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC' })
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  store.data.set('document', JSON.stringify(document))
  const repositories = createTestRepositories({ store })
  repository = repositories.proposals
  pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: repositories.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  planner = usePlannerStore(pinia)
  await planner.load()
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp({ render: () => [h(ConnectSettings), h(AnyAiPanel)] }).use(pinia).use(i18n)
  app.mount(host)
})

afterAll(() => {
  const reviewHost = $<HTMLElement & { __vue_app__?: App }>('[data-next168-proposal-review]')
  reviewHost?.__vue_app__?.unmount()
  reviewHost?.remove()
  app.unmount(); host.remove(); reviewing.value = null
  location.hash = ''
})

afterEach(async () => {
  if ($('[role="dialog"]')) await close()
})

const input = (summary: string): ProposalInput => ({
  contractVersion: '1.1', workspaceId: planner.document!.workspaceId, baseRevision: planner.document!.revision, summary,
  ops: [{ op: 'add_block', block: { categoryId: 'focus', title: 'Focus', days: [1], start: 540, end: 600 } }],
})

async function type(selector: string, text: string) {
  const box = $<HTMLTextAreaElement>(selector)
  box.value = text; box.dispatchEvent(new Event('input')); await nextTick()
}

async function ready(summary: string) {
  await vi.waitFor(() => expect(reviewing.value?.summary).toBe(summary))
  await nextTick()
  await vi.waitFor(() => expect(byTestId<HTMLButtonElement>('review-approve')?.disabled).toBe(false))
}

async function close() {
  byTestId<HTMLButtonElement>('review-cancel').click()
  // Wait for dismissal and its asynchronous repository write before asserting retention.
  await vi.waitFor(() => expect($('[role="dialog"]')).toBeNull())
}

async function status(id: string) {
  return (await repository.list()).find((proposal) => proposal.id === id)?.status
}

it('Settings import clears its input, then opening and closing the saved proposal keeps it pending', async () => {
  await type('#proposal-json', JSON.stringify(input('Imported from Settings')))
  ;[...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Import proposal JSON')!.click()
  await vi.waitFor(() => expect($<HTMLTextAreaElement>('#proposal-json').value).toBe(''))
  expect(location.hash).toBe('#/proposals')
  const proposal = (await repository.list('pending')).find((item) => item.summary === 'Imported from Settings')!
  expect(proposal.source).toBe('import')
  const listHost = document.createElement('div'); host.append(listHost)
  const list = createApp(ProposalsView).use(pinia).use(i18n)
  try {
    list.mount(listHost)
    await vi.waitFor(() => expect(listHost.textContent).toContain(proposal.summary))
    ;[...listHost.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes(proposal.summary))!.click()
    await ready(proposal.summary)
    const cancelNote = byTestId('review-cancel-note').textContent
    await close()
    expect(await status(proposal.id)).toBe('pending')
    expect(cancelNote).toContain('stays pending')
  } finally { list.unmount(); listHost.remove() }
})

it.each([false, true])('AnyAi paste is disposable; provenance does not leak when the next review replaces it while open: %s', async (replaceWhileOpen) => {
  const summary = `Pasted reply ${replaceWhileOpen}`
  const reply = `Here are the changes:\n\`\`\`next168\n${JSON.stringify(input(summary))}\n\`\`\``
  await type('[data-testid="any-ai-paste"]', reply)
  byTestId<HTMLButtonElement>('any-ai-review').click()
  await ready(summary)
  const pastedId = reviewing.value!.id
  expect(byTestId('review-cancel-note').textContent).toContain('discarded')
  if (!replaceWhileOpen) {
    await close()
    expect(await status(pastedId)).toBe('rejected')
  }
  const saved = await repository.create(input('Next saved import'), 'import')
  openProposalReview(saved)
  await ready(saved.summary)
  await vi.waitFor(async () => expect(await status(pastedId)).toBe('rejected'))
  expect(byTestId('review-cancel-note').textContent).toContain('stays pending')
  await close()
  expect(await status(saved.id)).toBe('pending')
  expect(byTestId<HTMLTextAreaElement>('any-ai-paste').value).toBe(reply)
  expect(planner.document!.blocks).toEqual([])
})

it.each(['mcp', 'assistant'] as const)('%s proposals remain pending on close in the reused sheet', async (source) => {
  const proposal = await repository.create(input(`From ${source}`), source)
  openProposalReview(proposal)
  await ready(proposal.summary)
  expect(byTestId('review-cancel-note').textContent).toContain('stays pending')
  await close()
  expect(await status(proposal.id)).toBe('pending')
})
