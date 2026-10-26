import { afterEach, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ProposalRepository } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryStore } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import ProposalReviewSheet from './ProposalReviewSheet.vue'
import { reviewing } from './reviewState'

let repository: ProposalRepository
vi.mock('./repository', () => ({ getProposalRepository: () => repository }))
vi.mock('./pending', () => ({ refreshPending: async () => undefined }))

let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); reviewing.value = null })

const dialog = () => window.document.querySelector('[role="dialog"]')
const approveButton = () => [...window.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === 'Approve')

// A6(b): the UI route after a failed approval. Nothing was written, so reopening still previews a valid proposal.
it('after a failed approval the sheet closes, the planner blocks editing, and reopening approves successfully', async () => {
  const store = new MemoryStore()
  const document = createEmptyDocument({ now: new Date('2026-10-24T10:00:00Z'), locale: 'en', timeZone: 'UTC' })
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  store.data.set('document', JSON.stringify(document))
  const repositories = createTestRepositories({ store })
  repository = repositories.proposals
  const proposal = await repository.create({ contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 0, summary: 'A focused hour', ops: [
    { op: 'add_block', block: { categoryId: 'focus', title: 'Focused planning', days: [1], start: 540, end: 600 } },
  ] }, 'assistant')
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: repositories.planner, now: () => new Date('2026-10-24T10:00:00Z'), newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore(pinia)
  await planner.load()
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp(ProposalReviewSheet).use(pinia).use(i18n); app.mount(host)

  reviewing.value = { ...proposal }
  await vi.waitFor(() => expect(approveButton()?.disabled).toBe(false))
  store.failWritesTo.add('proposals')
  approveButton()!.click()
  await vi.waitFor(() => expect(planner.status).toBe('error'))
  expect(planner.error).toBe('quota-exceeded')
  await vi.waitFor(() => expect(dialog()).toBeNull())
  expect(JSON.parse(store.data.get('document') as string).revision).toBe(0)
  expect((await repository.list())[0]!.status).toBe('pending')

  store.failWritesTo.clear()
  reviewing.value = { ...proposal }
  await vi.waitFor(() => expect(approveButton()?.disabled).toBe(false))
  expect(dialog()?.textContent).not.toContain('Your planner changed')
  approveButton()!.click()
  await vi.waitFor(() => expect(planner.document?.blocks).toHaveLength(1))
  expect(planner.status).toBe('ready')
  expect((await repository.list())[0]!.status).toBe('applied')
})
