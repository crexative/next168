// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { applyProposal, buildProposal, canonicalContentHash, previewProposal } from '../proposals'
import type { ProposalInput, ProposalOp } from '../model'
import { clock, document } from './fixtures'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const input = (ops: ProposalOp[]): ProposalInput => ({ contractVersion: '1.0', workspaceId: 'workspace', baseRevision: 0, summary: 'Adjust plan', ops })
const add: ProposalOp = { op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }
const idGen = () => { let i = 0; return () => `id-${++i}` }

describe('proposal hashes and binding', () => {
  it('hashes canonical keys independently of insertion order using SHA-256', async () => {
    const ops = [{ op: 'delete_block', id: 'x' }] as ProposalOp[]
    const reversed = [{ id: 'x', op: 'delete_block' }] as ProposalOp[]
    expect(await canonicalContentHash(ops, hash)).toBe(hash('[{"id":"x","op":"delete_block"}]'))
    expect(await canonicalContentHash(ops)).toBe(await canonicalContentHash(reversed, hash))
    expect(await canonicalContentHash([{ op: 'delete_block', id: 'y' }])).not.toBe(await canonicalContentHash(ops))
  })
  it('validates model input, workspace and revision before building', async () => {
    const doc = document()
    const request = input([add])
    const proposal = await buildProposal(request, doc, 'mcp', clock, () => 'proposal', hash)
    expect(proposal).toMatchObject({ id: 'proposal', workspaceId: doc.workspaceId, baseRevision: 0, source: 'mcp', createdAt: clock.now().toISOString(), contentHash: await canonicalContentHash(request.ops, hash), status: 'pending' })
    request.ops[0] = { op: 'delete_block', id: 'bad' }
    expect(proposal.ops).toEqual([add])
    await expect(buildProposal({ ...request, workspaceId: 'other' }, doc, 'mcp', clock, () => 'p', hash)).rejects.toThrow('Workspace')
    await expect(buildProposal({ ...request, baseRevision: 1 }, doc, 'mcp', clock, () => 'p', hash)).rejects.toThrow('Revision')
    await expect(buildProposal({ ...request, contractVersion: '2' }, doc, 'mcp', clock, () => 'p', hash)).rejects.toThrow()
  })
})
describe('atomic proposal application', () => {
  it('previews before/after, applies once, increments revision and bounds replay history', async () => {
    const doc = document(); doc.appliedProposalIds = Array.from({ length: 200 }, (_, i) => `old-${i}`)
    const proposal = await buildProposal(input([add]), doc, 'assistant', clock, () => 'proposal', hash)
    expect(await previewProposal(doc, proposal, hash)).toMatchObject({ valid: true, changes: [{ before: null, after: { title: 'Focus' } }] })
    const result = await applyProposal(doc, proposal, idGen(), clock, hash)
    expect(result.kind).toBe('applied')
    if (result.kind !== 'applied') throw Error('apply')
    expect(result.document).toMatchObject({ revision: 1, blocks: [{ id: 'id-1', title: 'Focus' }] })
    expect(result.document.appliedProposalIds).toHaveLength(200)
    expect(result.document.appliedProposalIds[0]).toBe('old-1')
    expect(result.document.appliedProposalIds.at(-1)).toBe('proposal')
    expect(doc.blocks).toEqual([])
    expect(await applyProposal(result.document, proposal, idGen(), clock, hash)).toEqual({ kind: 'already-applied', document: result.document })
  })
  it('supports every op with exact before/after and snapshot-safe deletion', async () => {
    const doc = document()
    doc.blocks = [{ id: 'existing', ...add.block }]
    doc.tasks = [{ id: 'task', title: 'Old', categoryId: 'work', durationMin: 30, priority: 2, createdAt: clock.now().toISOString() }]
    const ops: ProposalOp[] = [
      { op: 'update_block', id: 'existing', patch: { title: 'New' } },
      { op: 'update_task', id: 'task', patch: { title: 'Updated' } },
      { op: 'complete_task', id: 'task' },
      { op: 'add_task', task: { title: 'Added', categoryId: 'work', durationMin: 15, priority: 1 } },
      { op: 'add_event', event: { title: 'Meeting', start: '2026-10-24T15:00:00Z', end: '2026-10-24T16:00:00Z', allDay: false, attendees: [] } },
      { op: 'update_category_goal', id: 'work', goal: { type: 'min', hoursPerWeek: 45 } },
      { op: 'delete_block', id: 'existing' },
    ]
    const proposal = await buildProposal(input(ops), doc, 'import', clock, () => 'p')
    const preview = await previewProposal(doc, proposal)
    expect(preview.changes[0]).toMatchObject({ before: { title: 'Focus' }, after: { title: 'New' } })
    expect(preview.changes.at(-1)?.after).toBeNull()
    const result = await applyProposal(doc, proposal, idGen(), clock)
    if (result.kind !== 'applied') throw Error(JSON.stringify(result))
    expect(result.document.blocks).toEqual([])
    expect(result.document.tasks[0]).toMatchObject({ title: 'Updated', doneAt: clock.now().toISOString() })
    expect(result.document.tasks[1]).toMatchObject({ title: 'Added', createdAt: clock.now().toISOString() })
    expect(result.document.events[0]?.title).toBe('Meeting')
    expect(result.document.categories[0]?.goal).toEqual({ type: 'min', hoursPerWeek: 45 })
  })
  it.each([
    ['wrongWorkspace', { workspaceId: 'other' }],
    ['staleRevision', { baseRevision: 1 }],
    ['invalidHash', { contentHash: '0'.repeat(64) }],
    ['notPending', { status: 'rejected' as const }],
  ])('rejects %s with no changes', async (reason, patch) => {
    const doc = document(); const before = JSON.stringify(doc)
    const proposal = await buildProposal(input([add]), doc, 'mcp', clock, () => 'p', hash)
    expect(await applyProposal(doc, { ...proposal, ...patch }, idGen(), clock, hash)).toEqual({ kind: 'rejected', reason: `proposal.${reason}` })
    expect(JSON.stringify(doc)).toBe(before)
  })
  it.each<ProposalOp>([
    { op: 'update_block', id: 'missing', patch: {} },
    { op: 'delete_block', id: 'missing' },
    { op: 'update_task', id: 'missing', patch: {} },
    { op: 'complete_task', id: 'missing' },
    { op: 'update_category_goal', id: 'missing', goal: { type: 'none', hoursPerWeek: 0 } },
    { op: 'add_block', block: { ...add.block, categoryId: 'missing' } },
    { op: 'add_block', block: { ...add.block, end: 540 } },
  ])('rejects the whole proposal when an op is invalid: $op', async (bad) => {
    const doc = document(); const proposal = await buildProposal(input([add, bad]), doc, 'mcp', clock, () => 'p', hash)
    expect(await applyProposal(doc, proposal, idGen(), clock, hash)).toMatchObject({ kind: 'rejected' })
    expect(await previewProposal(doc, proposal, hash)).toMatchObject({ valid: false, changes: [] })
    expect(doc.blocks).toEqual([])
  })
  it('warns on overlaps and exceeded max goals without blocking', async () => {
    const doc = document(); doc.categories[0]!.goal.hoursPerWeek = 0
    const proposal = await buildProposal(input([add, add]), doc, 'mcp', clock, () => 'p', hash)
    const result = await previewProposal(doc, proposal, hash)
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('block.overlap')
    expect(result.warnings).toContain('goal.over:work')
  })
})
