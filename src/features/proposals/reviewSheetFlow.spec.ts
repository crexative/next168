import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ChangeProposal, ProposalRepository } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryStore } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import { syntheticWeekProposal } from '@/features/assistant/anyAi/syntheticWeek'
import ProposalReviewSheet from './ProposalReviewSheet.vue'
import { reviewing } from './reviewState'

// The review sheet (#3): a summary of the kinds of change first, groups that open on demand, Approve and Cancel always
// in the footer, and nothing left behind by a cancelled pasted proposal.
let repository: ProposalRepository
vi.mock('./repository', () => ({ getProposalRepository: () => repository }))
vi.mock('./pending', () => ({ refreshPending: async () => undefined }))

let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); reviewing.value = null; window.document.body.innerHTML = '' })

const NOW = new Date('2026-10-24T10:00:00Z')
const $ = <T extends HTMLElement>(selector: string) => window.document.querySelector<T>(selector)
const byTestId = <T extends HTMLElement>(id: string) => $<T>(`[data-testid="${id}"]`)

async function setup(withCategory = true) {
  const store = new MemoryStore()
  const document = createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC' })
  if (withCategory) document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  store.data.set('document', JSON.stringify(document))
  const repositories = createTestRepositories({ store })
  repository = repositories.proposals
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: repositories.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore(pinia)
  await planner.load()
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp(ProposalReviewSheet).use(pinia).use(i18n); app.mount(host)
  return { document, planner }
}

const focusHour = (workspaceId: string) => ({ contractVersion: '1.0' as const, workspaceId, baseRevision: 0, summary: 'A focused hour', ops: [
  { op: 'add_block' as const, block: { categoryId: 'focus', title: 'Focused planning', days: [1], start: 540, end: 600 } },
] })

async function open(proposal: ChangeProposal, pastedReply = false) {
  reviewing.value = { ...proposal, pastedReply }
  await vi.waitFor(() => expect(byTestId<HTMLButtonElement>('review-approve')?.disabled).toBe(false))
  await nextTick()
}

it('a whole week reads as a one-line summary first, with every group closed and Approve and Cancel in the footer', async () => {
  const { document } = await setup(false)
  const proposal = await repository.create(syntheticWeekProposal(document.workspaceId, 0), 'import')
  await open(proposal)
  expect(byTestId('review-overview')!.textContent).toBe('8 new categories\u00a0· 32 routines\u00a0· 3 tasks')
  expect(window.document.querySelectorAll('.change')).toHaveLength(0)
  const footer = byTestId('sheet-actions')!
  expect([...footer.querySelectorAll('button')].map((button) => button.textContent!.trim())).toEqual(['Approve', 'Cancel'])
  expect(footer.closest('.sheet-body')).toBeNull()

  const routines = byTestId('review-group-routines')!.querySelector<HTMLButtonElement>('.group-toggle')!
  expect(routines.getAttribute('aria-expanded')).toBe('false')
  routines.click(); await nextTick()
  expect(routines.getAttribute('aria-expanded')).toBe('true')
  expect(byTestId('review-group-routines')!.querySelectorAll('.change')).toHaveLength(32)
  // A routine in a new category is shown with that category's name, and an overnight one with its real times.
  const sleep = [...byTestId('review-group-routines')!.querySelectorAll('[data-testid="change-after"]')].find((item) => item.textContent!.includes('Dormir'))!
  expect(sleep.textContent).toContain('Sueño')
  expect(sleep.textContent).toContain('10:30\u00a0PM – 6:30\u00a0AM (overnight)')
  expect(window.document.body.textContent).not.toContain('Unknown category')
})

it('a short proposal is shown whole', async () => {
  const { document } = await setup()
  await open(await repository.create(focusHour(document.workspaceId), 'import'))
  expect(byTestId('review-overview')!.textContent).toBe('1 routine')
  expect(window.document.querySelectorAll('.change')).toHaveLength(1)
})

it('closing a saved import keeps it pending', async () => {
  const { document } = await setup()
  const proposal = await repository.create(focusHour(document.workspaceId), 'import')
  await open(proposal)
  byTestId<HTMLButtonElement>('review-cancel')!.click()
  await vi.waitFor(() => expect($('[role="dialog"]')).toBeNull())
  expect((await repository.list('pending')).map((item) => item.id)).toEqual([proposal.id])
})

it('cancelling a pasted proposal discards it: nothing is applied and nothing stays pending', async () => {
  const { document, planner } = await setup()
  const proposal = await repository.create(focusHour(document.workspaceId), 'import')
  await open(proposal, true)
  expect(byTestId('review-cancel-note')!.textContent).toBe('If you cancel, these changes are discarded and your plan stays as it is.')
  expect(byTestId('proposal-review')!.textContent).not.toContain('Reject')
  byTestId<HTMLButtonElement>('review-cancel')!.click()
  await vi.waitFor(async () => expect(await repository.list('pending')).toEqual([]))
  expect((await repository.list())[0]!.status).toBe('rejected')
  expect(planner.document!.blocks).toEqual([])
})

it.each(['close button', 'Escape', 'scrim'] as const)('closing a pasted proposal via %s discards it as well', async (method) => {
  const { document } = await setup()
  await open(await repository.create(focusHour(document.workspaceId), 'import'), true)
  if (method === 'Escape') $('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  else $(method === 'scrim' ? '.sheet-scrim' : '.sheet-close')!.click()
  await vi.waitFor(async () => expect(await repository.list('pending')).toEqual([]))
})

it.each(['mcp', 'assistant'] as const)('a proposal from %s stays pending in Proposals when cancelled, and can still be rejected', async (source) => {
  const { document } = await setup()
  const proposal = await repository.create(focusHour(document.workspaceId), source)
  await open(proposal)
  expect(byTestId('review-cancel-note')!.textContent).toBe('If you cancel, the proposal stays pending in Proposals.')
  byTestId<HTMLButtonElement>('review-cancel')!.click()
  await vi.waitFor(() => expect($('[role="dialog"]')).toBeNull())
  expect((await repository.list('pending')).map((item) => item.id)).toEqual([proposal.id])
  await open(proposal)
  ;[...window.document.querySelectorAll<HTMLButtonElement>('[data-testid="proposal-review"] button')].find((button) => button.textContent!.trim() === 'Reject')!.click()
  await vi.waitFor(async () => expect(await repository.list('pending')).toEqual([]))
})

it('an approved pasted proposal is applied once, and closing afterwards does not touch it', async () => {
  const { document, planner } = await setup()
  const proposal = await repository.create(focusHour(document.workspaceId), 'import')
  await open(proposal, true)
  byTestId<HTMLButtonElement>('review-approve')!.click()
  byTestId<HTMLButtonElement>('review-approve')!.click()
  await vi.waitFor(() => expect(planner.document!.blocks).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect((await repository.list())[0]!.status).toBe('applied')
  expect(planner.document!.revision).toBe(1)
})

it('names an existing category when the proposal would duplicate it', async () => {
  const { document, planner } = await setup()
  const proposal = await repository.create({ ...focusHour(document.workspaceId), ops: [{ op: 'add_category', ref: 'new-f', category: { name: 'Music' } }] }, 'mcp')
  // The plan gets a "music" category from elsewhere; the copy under review is rebased only to reach the name check.
  await planner.commit((draft) => { draft.categories.push({ id: 'music', name: 'music', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } }) })
  const stored = (await repository.list()).find((item) => item.id === proposal.id)!
  reviewing.value = { ...stored, baseRevision: planner.document!.revision }
  await vi.waitFor(() => expect(byTestId('review-invalid')).not.toBeNull())
  expect(byTestId('review-invalid')!.textContent!.trim()).toBe('You already have a category called “music”. Ask for a proposal that uses it.')
  expect(byTestId<HTMLButtonElement>('review-approve')!.disabled).toBe(true)
})
