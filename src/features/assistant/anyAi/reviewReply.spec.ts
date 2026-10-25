import { describe, expect, it, vi } from 'vitest'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { ProposalError } from '@/repositories/BrowserProposalRepository'
import { realisticWeek } from './fixtures'
import { reviewReply } from './reviewReply'

const proposal = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: '1.0', workspaceId: 'ws-realistic', baseRevision: 7, summary: 'Move the gym to Thursday',
  ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides,
})
const reply = (value: unknown) => `Here you go.\n\n\`\`\`next168\n${JSON.stringify(value)}\n\`\`\`\n`
const repository = () => ({ create: vi.fn(async (input: ProposalInput, source: ChangeProposal['source']) => ({ id: 'p1', source, summary: input.summary, status: 'pending' }) as ChangeProposal) })

describe('reviewReply', () => {
  it('stores a pending proposal from the "import" source and returns it for review', async () => {
    const proposals = repository()
    const outcome = await reviewReply(reply(proposal()), realisticWeek(), proposals)
    expect(outcome).toMatchObject({ ok: true, proposal: { id: 'p1', source: 'import' } })
    expect(proposals.create).toHaveBeenCalledTimes(1)
    expect(proposals.create.mock.calls[0]![0]).toMatchObject({ baseRevision: 7, summary: 'Move the gym to Thursday' })
  })

  it('accepts a task without a category: it fits any free time (verify4 defect 2)', async () => {
    const proposals = repository()
    const ops = [{ op: 'add_task', task: { title: 'Renew passport', durationMin: 60, priority: 2 } }]
    expect(await reviewReply(reply(proposal({ ops })), realisticWeek(), proposals)).toMatchObject({ ok: true })
    expect(proposals.create.mock.calls[0]![0].ops[0]).toEqual(ops[0])
  })

  it('stores nothing for a reply without changes, or with damaged or invalid ones', async () => {
    const proposals = repository()
    expect(await reviewReply('Just chatting.', realisticWeek(), proposals)).toEqual({ ok: false, reason: 'none' })
    expect(await reviewReply('```next168\n{"ops":[\n```', realisticWeek(), proposals)).toEqual({ ok: false, reason: 'malformed' })
    expect(await reviewReply(reply(proposal({ ops: [] })), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'invalid' })
    expect(proposals.create).not.toHaveBeenCalled()
  })

  it('refuses another workspace and a stale revision without storing them', async () => {
    const proposals = repository()
    expect(await reviewReply(reply(proposal({ workspaceId: 'ws-other' })), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'wrongWorkspace' })
    expect(await reviewReply(reply(proposal({ baseRevision: 6 })), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'stale' })
    // The plan moved on after the copy: the same reply is now stale.
    expect(await reviewReply(reply(proposal()), realisticWeek({ revision: 8 }), proposals)).toEqual({ ok: false, reason: 'stale' })
    expect(proposals.create).not.toHaveBeenCalled()
  })

  it('refuses changes aimed at things that do not exist in the plan', async () => {
    const proposals = repository()
    const missing = proposal({ ops: [{ op: 'update_block', id: 'b-ghost', patch: { days: [4] } }] })
    expect(await reviewReply(reply(missing), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'unusable' })
    expect(proposals.create).not.toHaveBeenCalled()
  })

  it('names the category a new one would duplicate, and how many changes a too-long reply had', async () => {
    const proposals = repository()
    const duplicate = proposal({ ops: [{ op: 'add_category', ref: 'new-work', category: { name: 'WORK' } }] })
    expect(await reviewReply(reply(duplicate), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'duplicateCategory', detail: 'Work' })
    const many = proposal({ ops: Array.from({ length: 230 }, () => ({ op: 'update_block', id: 'b-gym', patch: { days: [4] } })) })
    expect(await reviewReply(reply(many), realisticWeek(), proposals)).toEqual({ ok: false, reason: 'tooManyOps', detail: '230' })
    expect(proposals.create).not.toHaveBeenCalled()
  })

  it('stores a proposal that creates categories and uses their refs in the same proposal', async () => {
    const proposals = repository()
    const created = proposal({ ops: [
      { op: 'add_category', ref: 'new-music', category: { name: 'Music', goal: { type: 'min', hoursPerWeek: 2 } } },
      { op: 'add_block', block: { categoryId: 'new-music', title: 'Piano', days: [2, 4], start: 1260, end: 1320 } },
    ] })
    expect(await reviewReply(reply(created), realisticWeek(), proposals)).toMatchObject({ ok: true })
  })

  it('maps what the repository says when the plan moved between the check and the save', async () => {
    const failing = (error: unknown) => ({ create: vi.fn(async () => { throw error }) })
    expect(await reviewReply(reply(proposal()), realisticWeek(), failing(new Error('proposal.staleRevision')))).toEqual({ ok: false, reason: 'stale' })
    expect(await reviewReply(reply(proposal()), realisticWeek(), failing(new ProposalError('workspace-mismatch')))).toEqual({ ok: false, reason: 'wrongWorkspace' })
    expect(await reviewReply(reply(proposal()), realisticWeek(), failing(new Error('disk')))).toEqual({ ok: false, reason: 'saveFailed' })
  })

  it('has no way to change the plan: the repository it is given can only create pending proposals', async () => {
    const proposals = repository()
    const document = realisticWeek()
    const before = JSON.stringify(document)
    await reviewReply(reply(proposal()), document, proposals)
    expect(JSON.stringify(document)).toBe(before)
    expect(Object.keys(proposals)).toEqual(['create'])
  })
})
