// Tasks P1-4 and P1-6 (design rev 4 §2.2, rev 5 §2.4, rev 6 §2.3): contract 1.1 is the only contract. Stored records
// are read one by one: 1.1 executes, 1.0 is history that never executes (a pending one is stale), and anything else is
// quarantined byte for byte. Every 1.1 op is strict, every op × state cell is decided by core rules, and the content
// hash binds the version, the effective date and the ops.
import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256 } from '@/core/canonical'
import { canonicalContentHash, commitProposal, CONTRACT_RETIRED } from '@/core/proposals'
import { proposalInputSchema, type ChangeProposal, type ProposalInput, type ProposalOp } from '@/core/model'
import { extractProposal } from '@/features/assistant/anyAi/extractProposal'
import { createTestRepositories, fixedNow, MemoryStore, testDocument } from './testSupport'

const SENTINEL = 'SYNTHETIC_PRIVATE_NOTE'
const category = { id: 'work', name: 'Work', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
const openTask = { id: 't-open', title: 'Open task', priority: 2 as const, createdAt: '2026-10-20T08:00:00.000Z' }
const doneTask = { id: 't-done', title: 'Done task', priority: 2 as const, doneAt: '2026-10-21T08:00:00.000Z', createdAt: '2026-10-20T08:00:00.000Z' }

async function setup() {
  const repos = createTestRepositories()
  await repos.planner.save(testDocument({ revision: 1, categories: [category], tasks: [openTask, doneTask] }), 0)
  return { ...repos, store: repos.store as MemoryStore }
}
const input = (ops: unknown[], extra: Record<string, unknown> = {}) => ({ contractVersion: '1.1', workspaceId: 'workspace-1', baseRevision: 1, summary: 'Change', ops, ...extra }) as ProposalInput

// A record as d325df4 stored it (contract 1.0: no version, the hash of the ops alone).
const legacyRecord = (id: string, status: string) => ({
  id, workspaceId: 'workspace-1', source: 'mcp', baseRevision: 1, contentHash: 'a'.repeat(64), summary: `Legacy ${status}`,
  ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Old', days: [1], start: 540, end: 600 } }], status, createdAt: '2026-10-20T08:00:00.000Z',
  ...(status === 'pending' ? {} : { decidedAt: '2026-10-21T08:00:00.000Z' }),
})

describe('P1-4: the stored proposal list is read per record', () => {
  async function seeded() {
    const repos = await setup()
    const control = await repos.proposals.create(input([{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }]), 'mcp')
    // A record labelled 1.1 with 1.0 content (no effective date), carrying a note an AI must never see.
    const relabelled = { ...legacyRecord('relabelled', 'pending'), contractVersion: '1.1', ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Hidden', notes: SENTINEL, days: [2], start: 540, end: 600 } }] }
    const corrupt = { id: 'corrupt', status: 'pending', ops: 'not ops', summary: '<img src=x onerror=alert(1)>' }
    const elements = [legacyRecord('legacy-pending', 'pending'), legacyRecord('legacy-applied', 'applied'), legacyRecord('legacy-rejected', 'rejected'), control, relabelled, corrupt]
    // The array format every earlier build wrote, spaced so a re-serialization would not give the same bytes.
    const texts = elements.map((element) => JSON.stringify(element, null, 1))
    repos.store.data.set('proposals', `[\n${texts.join(' ,\n')}\n]`)
    return { ...repos, control, texts }
  }

  it('lists the 1.1 control, keeps 1.0 history readable with the pending one stale, and quarantines the rest byte for byte', async () => {
    const { proposals, control, texts } = await seeded()
    expect((await proposals.list()).map((proposal) => proposal.id)).toEqual([control.id])
    const history = await proposals.history()
    expect(history.legacy.map((proposal) => [proposal.id, proposal.status])).toEqual([['legacy-pending', 'stale'], ['legacy-applied', 'applied'], ['legacy-rejected', 'rejected']])
    expect(history.quarantine).toEqual([texts[4], texts[5]])
  })

  it('the 1.1 control executes; 1.0 and quarantined records never do, at the repository and in commitProposal', async () => {
    const { proposals, store, control } = await seeded()
    const before = store.data.get('document')
    expect(await proposals.approve('legacy-pending', 'a'.repeat(64), 1)).toEqual({ kind: 'stale', currentRevision: 1 })
    expect(await proposals.approve('relabelled', 'a'.repeat(64), 1)).toEqual({ kind: 'not-found' })
    expect(await proposals.approve('corrupt', 'a'.repeat(64), 1)).toEqual({ kind: 'not-found' })
    expect(store.data.get('document')).toBe(before)
    const document = JSON.parse(before as string)
    for (const record of [legacyRecord('legacy-pending', 'pending'), { ...legacyRecord('x', 'pending'), contractVersion: '1.0' }]) {
      expect(await commitProposal(document, record as unknown as ChangeProposal, () => 'id', { now: fixedNow })).toEqual({ kind: 'rejected', reason: CONTRACT_RETIRED })
    }
    expect(await proposals.approve(control.id, control.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
  })

  it('the next proposals write persists the stale status and keeps the quarantined bytes', async () => {
    const { proposals, store, control, texts } = await seeded()
    await proposals.approve(control.id, control.contentHash, 1)
    const written = JSON.parse(store.data.get('proposals') as string)
    expect(written.records.find((record: { id: string }) => record.id === 'legacy-pending').status).toBe('stale')
    expect(written.quarantine).toEqual([texts[4], texts[5]])
    expect((await proposals.history()).quarantine).toEqual([texts[4], texts[5]])
  })

  it('a pasted 1.0 reply and a stored 1.0 input are refused as retired', async () => {
    const reply = '```weeklid\n' + JSON.stringify({ ...input([{ op: 'delete_block', id: 'b' }]), contractVersion: '1.0' }) + '\n```'
    expect(extractProposal(reply)).toEqual({ ok: false, reason: 'retired' })
    const { proposals, store } = await setup()
    await expect(proposals.create({ ...input([{ op: 'delete_block', id: 'b' }]), contractVersion: '1.0' } as unknown as ProposalInput, 'import')).rejects.toMatchObject({ code: CONTRACT_RETIRED })
    expect(store.data.has('proposals')).toBe(false)
  })
})

describe('P1-6: strict 1.1 ops', () => {
  const valid: ProposalOp[] = [
    { op: 'add_category', ref: 'new-x', category: { name: 'X', goal: { type: 'none', hoursPerWeek: 0 } } },
    { op: 'add_block', block: { categoryId: 'work', title: 'B', days: [1], start: 540, end: 600 } },
    { op: 'update_block', id: 'b', patch: { title: 'B2' } },
    { op: 'delete_block', id: 'b' },
    { op: 'add_task', task: { title: 'T', priority: 2 } },
    { op: 'update_task', id: 't-open', patch: { title: 'T2' } },
    { op: 'complete_task', id: 't-open' },
    { op: 'add_event', event: { title: 'E', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z', allDay: false, attendees: [] } },
    { op: 'update_category_goal', id: 'work', goal: { type: 'min', hoursPerWeek: 1 } },
  ]
  // Where an unknown key can hide in each op: the op itself and every nested object.
  function injections(op: ProposalOp): [string, unknown][] {
    const out: [string, unknown][] = []
    for (const key of ['authority', 'human', 'extra']) {
      out.push([`${op.op}.${key}`, { ...op, [key]: true }])
      for (const [field, value] of Object.entries(op)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) out.push([`${op.op}.${field}.${key}`, { ...op, [field]: { ...value, [key]: true } }])
        if (field === 'category' && value && typeof value === 'object' && 'goal' in value) out.push([`${op.op}.category.goal.${key}`, { ...op, category: { ...value, goal: { ...(value as { goal: object }).goal, [key]: true } } }])
      }
    }
    return out
  }

  it('every op accepts its valid form', () => {
    for (const op of valid) expect([op.op, proposalInputSchema.safeParse(input([op])).success]).toEqual([op.op, true])
  })

  it('rejects an unknown or forbidden key anywhere in any op, and at the top level', () => {
    for (const op of valid) {
      for (const [where, injected] of injections(op)) expect([where, proposalInputSchema.safeParse(input([injected])).success]).toEqual([where, false])
    }
    expect(proposalInputSchema.safeParse(input([valid[1]], { authority: 'person' })).success).toBe(false)
    expect(proposalInputSchema.safeParse(input([valid[1]], { human: true })).success).toBe(false)
  })

  it('rejects the fields an AI may never write on an update, and contradictory updates', () => {
    for (const patch of [{ notes: 'x' }, { doneAt: '2026-10-26T10:00:00Z' }, { createdAt: '2026-10-26T10:00:00Z' }, { id: 'other' }]) {
      expect([patch, proposalInputSchema.safeParse(input([{ op: 'update_task', id: 't-open', patch }])).success]).toEqual([patch, false])
    }
    expect(proposalInputSchema.safeParse(input([{ op: 'update_task', id: 't-open', patch: { dueDate: '2026-10-30' }, unset: ['dueDate'] }])).success).toBe(false)
    expect(proposalInputSchema.safeParse(input([{ op: 'add_task', task: { title: 'Fixed', priority: 2, at: 540 } }])).success).toBe(false)
    expect(proposalInputSchema.safeParse(input([{ op: 'add_task', task: { title: 'Long', priority: 2, at: 540, dueDate: '2026-10-30', durationMin: 721 } }])).success).toBe(false)
  })

  it('a forbidden key smuggled into a stored record is refused at approval and changes no byte', async () => {
    const { proposals, store } = await setup()
    const proposal = await proposals.create(input([{ op: 'add_block', block: { categoryId: 'work', title: 'B', days: [1], start: 540, end: 600 } }]), 'mcp')
    const tampered = { ...proposal, ops: [{ ...proposal.ops[0], authority: 'person' }] }
    store.data.set('proposals', JSON.stringify({ records: [tampered], quarantine: [] }))
    const before = { document: store.data.get('document'), proposals: store.data.get('proposals') }
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'not-found' })
    expect({ document: store.data.get('document'), proposals: store.data.get('proposals') }).toEqual(before)
  })
})

describe('P1-6: the state matrix, through commitProposal', () => {
  const cases: [string, ProposalOp[], string][] = [
    ['update an open task', [{ op: 'update_task', id: 't-open', patch: { title: 'Renamed' } }], 'applied'],
    ['update a done task', [{ op: 'update_task', id: 't-done', patch: { title: 'Renamed' } }], 'proposal.targetDone:t-done'],
    ['complete an open task', [{ op: 'complete_task', id: 't-open' }], 'applied'],
    ['complete a done task', [{ op: 'complete_task', id: 't-done' }], 'proposal.targetDone:t-done'],
    ['update a missing task', [{ op: 'update_task', id: 'missing', patch: { title: 'X' } }], 'proposal.missingTarget'],
    ['complete a missing task', [{ op: 'complete_task', id: 'missing' }], 'proposal.missingTarget'],
    ['touch one task twice', [{ op: 'update_task', id: 't-open', patch: { title: 'X' } }, { op: 'complete_task', id: 't-open' }], 'proposal.taskTouchedTwice:t-open'],
    ['clear the date of a fixed task', [{ op: 'update_task', id: 't-open', patch: { at: 540 } }], 'task.atNeedsDueDate'],
    ['give a task a fixed time and a date', [{ op: 'update_task', id: 't-open', patch: { at: 540, dueDate: '2026-10-30' } }], 'applied'],
    ['clear a field', [{ op: 'update_task', id: 't-open', patch: {}, unset: ['durationMin'] }], 'applied'],
  ]
  for (const [name, ops, expected] of cases) {
    it(name, async () => {
      const { proposals, store } = await setup()
      const proposal = await proposals.create(input(ops), 'mcp').catch((error: Error) => error)
      if (proposal instanceof Error) {
        expect(proposal.message).toBe(expected)
        return
      }
      const before = store.data.get('document')
      const result = await proposals.approve(proposal.id, proposal.contentHash, 1).catch((error: Error) => error)
      if (expected === 'applied') expect(result).toEqual({ kind: 'applied', revision: 2 })
      else {
        expect((result as Error).message).toBe(expected)
        expect(store.data.get('document')).toBe(before)
      }
    })
  }
})

describe('P1-6: frozen 1.1 content hash vectors', () => {
  const ops: ProposalOp[] = [
    { op: 'add_task', task: { title: 'Pagar luz', dueDate: '2026-11-05', priority: 2 } },
    { op: 'complete_task', id: 't-1' },
  ]
  it('is sha256 of the canonical {contractVersion, effectiveDate, ops}', async () => {
    expect(await canonicalContentHash({ effectiveDate: '2026-10-26', ops })).toBe(await sha256(canonicalJson({ contractVersion: '1.1', effectiveDate: '2026-10-26', ops })))
    expect(await canonicalContentHash({ effectiveDate: '2026-10-26', ops })).toBe('8d936fe918218264f352c165bfad0557a346b5eed5a8ee815e811403db85c486')
  })
  it('changes with the effective date, any op field and the op order', async () => {
    const base = await canonicalContentHash({ effectiveDate: '2026-10-26', ops })
    const variants = [
      await canonicalContentHash({ effectiveDate: '2026-10-27', ops }),
      await canonicalContentHash({ effectiveDate: '2026-10-26', ops: [{ ...ops[0]!, task: { title: 'Pagar luz', dueDate: '2026-11-06', priority: 2 } } as ProposalOp, ops[1]!] }),
      await canonicalContentHash({ effectiveDate: '2026-10-26', ops: [ops[1]!, ops[0]!] }),
      await sha256(canonicalJson({ contractVersion: '1.0', effectiveDate: '2026-10-26', ops })),
    ]
    expect(new Set([base, ...variants]).size).toBe(5)
  })
  it('a record whose effective date was edited no longer verifies', async () => {
    const { proposals, store } = await setup()
    const proposal = await proposals.create(input([{ op: 'complete_task', id: 't-open' }]), 'mcp')
    store.data.set('proposals', JSON.stringify({ records: [{ ...proposal, effectiveDate: '2026-01-01' }], quarantine: [] }))
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toMatchObject({ code: 'proposal.invalidHash' })
  })
})
