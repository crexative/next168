import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildProposal } from '@/core/proposals'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { lastDecision } from '@/features/proposals/reviewState'
import { plannerWithBlocks } from './testSupport'

const document = plannerWithBlocks()
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../i18n/en/assistant.json', { eager: true })
const input: ProposalInput = {
  contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision, source: 'assistant', summary: 'Move Review',
  ops: [{ op: 'update_block', id: 'work-fri', patch: { start: 570, end: 1005, days: [4, 5] } }],
} as unknown as ProposalInput

const state = vi.hoisted(() => ({ create: vi.fn(), open: vi.fn() }))

vi.mock('@/repositories/browserRepositories', () => ({
  createBrowserRepositories: () => ({ proposals: { create: state.create } }),
}))
vi.mock('@/features/proposals', () => ({ openProposalReview: state.open }))

afterEach(() => { state.create.mockReset(); state.open.mockReset(); lastDecision.value = null })

async function mountCard() {
  const { default: ProposalCard } = await import('./ProposalCard.vue')
  const i18n = createI18n<false>({ legacy: false, locale: 'en', messages: { en: { assistant: Object.values(files)[0]!.default } } as never })
  const root = globalThis.document.createElement('div')
  globalThis.document.body.append(root)
  createApp({ render: () => h(ProposalCard, { input }) }).use(i18n).mount(root)
  return root
}

describe('ProposalCard', () => {
  it('stores the proposal once and opens the proposals slice review sheet with it', async () => {
    const stored: ChangeProposal = await buildProposal(input, document, 'assistant', { now: () => new Date('2026-10-24T12:00:00Z') }, () => 'id-1')
    state.create.mockResolvedValue(stored)
    const root = await mountCard()
    root.querySelector('button')!.click()
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledWith(stored))
    expect(state.create).toHaveBeenCalledWith(input, 'assistant')
    root.querySelector('button')!.click()
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(2))
    expect(state.create).toHaveBeenCalledTimes(1)
  })

  it('shows the decision made in the review sheet, and a failure when storing fails', async () => {
    const stored: ChangeProposal = await buildProposal(input, document, 'assistant', { now: () => new Date('2026-10-24T12:00:00Z') }, () => 'id-1')
    state.create.mockResolvedValue(stored)
    const root = await mountCard()
    root.querySelector('button')!.click()
    await vi.waitFor(() => expect(state.open).toHaveBeenCalled())
    lastDecision.value = { kind: 'applied', id: stored.id, tick: 1 }
    await nextTick()
    expect(root.textContent).toContain('The changes were applied.')

    state.create.mockRejectedValue(new Error('storage'))
    const failing = await mountCard()
    failing.querySelector('button')!.click()
    await vi.waitFor(() => expect(failing.textContent).toContain('Nothing was changed'))
  })
})
