import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProposal } from '@/core/proposals'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { plannerWithBlocks } from './testSupport'

const document = plannerWithBlocks()
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../i18n/en/assistant.json', { eager: true })
const input: ProposalInput = {
  contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision, source: 'assistant', summary: 'Move Review',
  ops: [{ op: 'update_block', id: 'work-fri', patch: { start: 570, end: 1005, days: [4, 5] } }],
} as unknown as ProposalInput

const state = vi.hoisted(() => ({ stored: null as unknown, shared: undefined as unknown }))

vi.mock('@/stores/plannerStore', () => ({ usePlannerStore: () => ({ document, load: async () => undefined }) }))
vi.mock('@/repositories/browserRepositories', () => ({
  createBrowserRepositories: () => ({ proposals: { create: async () => state.stored, approve: vi.fn(), reject: vi.fn() } }),
}))
vi.mock('./proposalReview', () => ({ sharedProposalReview: () => state.shared }))

afterEach(() => { state.shared = undefined })

async function mountCard() {
  const { default: ProposalCard } = await import('./ProposalCard.vue')
  const i18n = createI18n<false>({ legacy: false, locale: 'en', messages: { en: { assistant: Object.values(files)[0]!.default } } as never })
  const root = globalThis.document.createElement('div')
  globalThis.document.body.append(root)
  const app = createApp({ render: () => h(ProposalCard, { input }) })
  app.use(i18n).mount(root)
  return { root }
}

describe('ProposalCard fallback review', () => {
  it('shows the exact field changes before offering Apply', async () => {
    let seq = 0
    state.stored = await buildProposal(input, document, 'assistant', { now: () => new Date('2026-10-24T12:00:00Z') }, () => `id-${++seq}`) satisfies ChangeProposal
    const { root } = await mountCard()
    root.querySelector('button')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="proposal-change"]')).not.toBeNull())
    await nextTick()
    const text = root.textContent ?? ''
    expect(text).toContain('Change block: Review')
    expect(text).toContain('Days: Fri → Thu, Fri')
    expect(text).toContain('Start: 15:00 → 09:30')
    expect(text).toContain('End: 16:00 → 16:45')
  })
})
