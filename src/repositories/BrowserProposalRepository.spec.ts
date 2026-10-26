import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { ProposalInput } from '@/core/model'
import { sha256 } from '@/core/canonical'
import { BrowserProposalRepository, ProposalError } from './BrowserProposalRepository'
import { IndexedDbStore, type BrowserStore } from './indexedDbStore'
import type { RunExclusive } from './storageCommit'
import { createTestRepositories, fixedNow, MemoryStore, mutexRunner, newTestId, testDocument } from './testSupport'

const category = { id: 'work', name: 'Work', colorKey: 'blue' as const, goal: { type: 'max' as const, hoursPerWeek: 40 } }

async function setup() {
  const repos = createTestRepositories()
  await repos.planner.save(testDocument({ revision: 1, categories: [category] }), 0)
  const input: ProposalInput = {
    contractVersion: '1.1', workspaceId: 'workspace-1', baseRevision: 1, summary: 'Add focus block',
    ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }],
  }
  return { ...repos, store: repos.store as MemoryStore, input }
}

const storedDocument = (store: MemoryStore) => JSON.parse(store.data.get('document') as string)
const storedProposals = (store: MemoryStore) => JSON.parse(store.data.get('proposals') as string).records

describe('proposal repository', () => {
  it('stores a pending proposal bound to the workspace and the ops hash', async () => {
    const { proposals, input } = await setup()
    const proposal = await proposals.create(input, 'mcp', { clientName: 'client' })
    expect(proposal).toMatchObject({ status: 'pending', workspaceId: 'workspace-1', baseRevision: 1, clientName: 'client' })
    expect(proposal.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await proposals.list('pending')).toHaveLength(1)
  })

  it('rejects a proposal for another workspace before storing it', async () => {
    const { proposals, input, store } = await setup()
    await expect(proposals.create({ ...input, workspaceId: 'other' }, 'mcp')).rejects.toMatchObject({ code: 'workspace-mismatch' })
    await expect(proposals.create(input, 'mcp', { clientName: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'proposal-invalid' })
    expect(await proposals.list()).toHaveLength(0)
    expect(store.data.has('proposals')).toBe(false)
  })

  it('rejects creation against a stale revision without storing a proposal', async () => {
    const { proposals, input, store } = await setup()
    await expect(proposals.create({ ...input, baseRevision: 0 }, 'mcp')).rejects.toBeDefined()
    expect(store.data.has('proposals')).toBe(false)
  })

  it('approve commits the document, its backup and the applied status in one transaction', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    const previous = store.data.get('document')
    const transactions = store.writeTransactions
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    expect(store.writeTransactions).toBe(transactions + 1)
    const document = storedDocument(store)
    expect(document.revision).toBe(2)
    expect(document.blocks).toHaveLength(1)
    expect(document.appliedProposalIds).toEqual([proposal.id])
    expect(store.data.get('backup')).toBe(previous)
    expect((await proposals.list('applied'))[0]).toMatchObject({ appliedRevision: 2 })
  })

  it('a second approve returns the recorded result without applying again', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    await proposals.approve(proposal.id, proposal.contentHash, 1)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    expect(storedDocument(store).blocks).toHaveLength(1)
  })

  it('concurrent approvals apply exactly once', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    const decisions = await Promise.all([
      proposals.approve(proposal.id, proposal.contentHash, 1),
      proposals.approve(proposal.id, proposal.contentHash, 1),
    ])
    expect(decisions).toEqual([{ kind: 'applied', revision: 2 }, { kind: 'applied', revision: 2 }])
    expect(storedDocument(store).blocks).toHaveLength(1)
  })

  it('holds the shared lock through async hash verification and the document commit', async () => {
    const store = new MemoryStore()
    const mutex = mutexRunner()
    let locked = false
    const runExclusive: RunExclusive = (task) => mutex(async () => {
      locked = true
      try { return await task() } finally { locked = false }
    })
    const { planner } = createTestRepositories({ store, runExclusive })
    let release!: () => void
    let started!: () => void
    const hashing = new Promise<void>((resolve) => { started = resolve })
    const resume = new Promise<void>((resolve) => { release = resolve })
    let pause = false
    const proposals = new BrowserProposalRepository({ store, runExclusive, now: fixedNow, newId: newTestId, hash: async (value: string) => {
      expect(locked).toBe(true)
      if (pause) {
        started()
        await resume
        expect(locked).toBe(true)
      }
      return sha256(value)
    } })
    const document = testDocument({ revision: 1, categories: [category] })
    await planner.save(document, 0)
    const proposal = await proposals.create({
      contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Focus',
      ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }],
    }, 'mcp')
    pause = true
    const approval = proposals.approve(proposal.id, proposal.contentHash, 1)
    await hashing
    const competingSave = planner.save({ ...document, revision: 2 }, 1)
    expect(storedDocument(store).revision).toBe(1)
    release()
    expect(await approval).toEqual({ kind: 'applied', revision: 2 })
    expect(await competingSave).toEqual({ kind: 'conflict', currentRevision: 2 })
    expect(storedDocument(store).blocks).toHaveLength(1)
  })

  it('(A6a) a failed approval changes nothing; approving again after the failure applies once', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    const before = { document: store.data.get('document'), backup: store.data.get('backup'), proposals: store.data.get('proposals') }
    store.failWritesTo.add('proposals')
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect({ document: store.data.get('document'), backup: store.data.get('backup'), proposals: store.data.get('proposals') }).toEqual(before)
    expect(storedDocument(store).revision).toBe(1)
    expect((await proposals.list())[0]!.status).toBe('pending')

    store.failWritesTo.clear()
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    expect(storedDocument(store).blocks).toHaveLength(1)
    expect(await proposals.list('applied')).toHaveLength(1)
  })

  it('(A6c) rejecting a proposal the document already applied records it as applied', async () => {
    const { proposals, planner, input, store } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    // Imported tester state: the document carries the id while the proposal is still pending.
    await planner.save(testDocument({ revision: 2, categories: [category], appliedProposalIds: [proposal.id] }), 1)
    expect(await proposals.reject(proposal.id)).toEqual({ kind: 'applied', revision: 2 })
    expect(storedProposals(store)[0]).toMatchObject({ status: 'applied', appliedRevision: 2 })
  })

  it('rejects tampered ops even when approval supplies the recorded hash', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    store.data.set('proposals', JSON.stringify([{ ...proposal, ops: [
      { ...input.ops[0], block: { categoryId: 'work', title: 'Tampered', days: [1], start: 540, end: 600 } },
    ] }]))
    const before = store.data.get('document')
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toBeDefined()
    expect(store.data.get('document')).toBe(before)
    expect(await proposals.list('pending')).toHaveLength(1)
  })

  it('keeps unreadable stored proposals in quarantine instead of failing the list', async () => {
    const { proposals, store } = await setup()
    store.data.set('proposals', '{not json')
    // Unreadable text is quarantined (kept byte for byte), never thrown at the whole list.
    expect(await proposals.list()).toEqual([])
    expect((await proposals.history()).quarantine).toEqual(['{not json'])
  })

  it('marks a proposal stale when the document moved on', async () => {
    const { proposals, planner, input } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    await planner.save(testDocument({ revision: 2, categories: [category] }), 1)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'stale', currentRevision: 2 })
    expect((await proposals.list('stale'))).toHaveLength(1)
    expect(await proposals.reject(proposal.id)).toEqual({ kind: 'rejected' })
    expect((await proposals.list()).map((stored) => stored.status)).toEqual(['rejected'])
  })

  it('refuses an approval bound to different content', async () => {
    const { proposals, input } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    await expect(proposals.approve(proposal.id, 'f'.repeat(64), 1)).rejects.toBeInstanceOf(ProposalError)
  })

  it('reject is final and unknown ids are not found', async () => {
    const { proposals, input } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    expect(await proposals.reject(proposal.id)).toEqual({ kind: 'rejected' })
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'rejected' })
    expect(await proposals.reject('missing')).toEqual({ kind: 'not-found' })
  })

  it('refuses every write without Web Locks', async () => {
    const store: BrowserStore = new MemoryStore()
    const proposals = new BrowserProposalRepository({ store, runExclusive: undefined, now: fixedNow, newId: newTestId })
    await expect(proposals.reject('x')).rejects.toMatchObject({ code: 'no-web-locks' })
  })
})

describe('a proposal that creates categories (#3)', () => {
  const createsSleep: ProposalInput['ops'] = [
    { op: 'add_category', ref: 'new-sleep', category: { name: 'Sleep', goal: { type: 'min', hoursPerWeek: 56 } } },
    { op: 'add_block', block: { categoryId: 'new-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4], start: 1350, end: 390 } },
  ]

  it('approving it twice, even concurrently (double tap or two tabs), creates the category once', async () => {
    const { proposals, input, store } = await setup()
    const proposal = await proposals.create({ ...input, ops: createsSleep }, 'import')
    const [first, second] = await Promise.all([
      proposals.approve(proposal.id, proposal.contentHash, proposal.baseRevision),
      proposals.approve(proposal.id, proposal.contentHash, proposal.baseRevision),
    ])
    expect(first).toEqual({ kind: 'applied', revision: 2 })
    expect(second).toEqual({ kind: 'applied', revision: 2 })
    const document = storedDocument(store)
    expect(document.revision).toBe(2)
    expect(document.categories.map((item: { name: string }) => item.name)).toEqual(['Work', 'Sleep'])
    expect(document.blocks).toEqual([expect.objectContaining({ start: 1350, end: 390, categoryId: document.categories[1].id })])
  })

  it('is stale, and writes nothing to the plan, when another tab changed the plan after it was made', async () => {
    const { proposals, planner, input, store } = await setup()
    const proposal = await proposals.create({ ...input, ops: createsSleep }, 'import')
    // Another tab adds a category with the same name and commits first.
    await planner.save(testDocument({ revision: 2, categories: [category, { ...category, id: 'other-tab', name: 'Sleep' }] }), 1)
    const before = store.data.get('document')
    expect(await proposals.approve(proposal.id, proposal.contentHash, proposal.baseRevision)).toEqual({ kind: 'stale', currentRevision: 2 })
    expect(store.data.get('document')).toBe(before)
    expect(storedProposals(store)[0].status).toBe('stale')
  })
})

// verify4 defect 1: on a new profile nothing is stored until the first write, so "Use with your AI" could never save.
describe('a proposal on a planner that was never stored', () => {
  const unsaved = () => testDocument({ workspaceId: 'unsaved-1', revision: 0 })
  const createsWork: ProposalInput['ops'] = [
    { op: 'add_category', ref: 'new-work', category: { name: 'Work', goal: { type: 'max', hoursPerWeek: 40 } } },
    { op: 'add_block', block: { categoryId: 'new-work', title: 'Work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 } },
    { op: 'add_task', task: { title: 'Renew passport', durationMin: 60, priority: 2 } },
  ]
  const inputFor = (workspaceId = 'unsaved-1'): ProposalInput => ({ contractVersion: '1.1', workspaceId, baseRevision: 0, summary: 'My week', ops: createsWork })

  function empty(store: BrowserStore = new MemoryStore()) {
    return createTestRepositories({ store })
  }

  // Each source the browser stores proposals from: a pasted reply or an imported proposal file ('import'), the
  // on-device assistant ('assistant') and a connected assistant client ('mcp').
  for (const source of ['import', 'assistant', 'mcp'] as const) {
    it(`stores a "${source}" proposal and approving it creates the planner in one transaction`, async () => {
      const { proposals, planner, store } = empty()
      const memory = store as MemoryStore
      const proposal = await proposals.create(inputFor(), source, { basis: unsaved() })
      expect(proposal).toMatchObject({ status: 'pending', workspaceId: 'unsaved-1', baseRevision: 0, source })
      expect(memory.data.has('document')).toBe(false)
      const transactions = memory.writeTransactions
      expect(await proposals.approve(proposal.id, proposal.contentHash, 0)).toEqual({ kind: 'applied', revision: 1 })
      expect(memory.writeTransactions).toBe(transactions + 1)
      const document = storedDocument(memory)
      expect(document).toMatchObject({ workspaceId: 'unsaved-1', revision: 1, appliedProposalIds: [proposal.id] })
      expect(document.categories.map((item: { name: string }) => item.name)).toEqual(['Work'])
      expect(document.tasks[0].categoryId).toBeUndefined()
      expect(memory.data.has('backup')).toBe(false)
      expect(memory.data.has('unsavedBaseline')).toBe(false)
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { workspaceId: 'unsaved-1', revision: 1 } })
    })
  }

  it('works on the real IndexedDB store, and a reload shows the same unsaved planner until it is approved', async () => {
    const { proposals, planner } = empty(new IndexedDbStore(new IDBFactory()))
    const proposal = await proposals.create(inputFor(), 'import', { basis: unsaved() })
    expect(await planner.load()).toEqual({ kind: 'empty', document: unsaved() })
    expect(await proposals.approve(proposal.id, proposal.contentHash, 0)).toEqual({ kind: 'applied', revision: 1 })
    expect(await planner.load()).toMatchObject({ kind: 'ok', document: { workspaceId: 'unsaved-1', revision: 1 } })
  })

  it('without the unsaved planner nothing can be proposed, and nothing is stored', async () => {
    const { proposals, store } = empty()
    await expect(proposals.create(inputFor(), 'import')).rejects.toMatchObject({ code: 'no-document' })
    await expect(proposals.create(inputFor(), 'import', { basis: testDocument({ workspaceId: 'unsaved-1', revision: 3 }) })).rejects.toMatchObject({ code: 'no-document' })
    expect((store as MemoryStore).data.size).toBe(0)
  })

  it('a second tab with another unsaved planner proposes against the one already stored, never replacing it', async () => {
    const { proposals, store } = empty()
    await proposals.create(inputFor(), 'import', { basis: unsaved() })
    await expect(proposals.create(inputFor('unsaved-2'), 'import', { basis: testDocument({ workspaceId: 'unsaved-2' }) })).rejects.toMatchObject({ code: 'workspace-mismatch' })
    expect(((store as MemoryStore).data.get('unsavedBaseline') as { document: string }).document).toContain('unsaved-1')
  })

  it('tells the other tabs, so they show the same unsaved planner', async () => {
    const { proposals, bus } = empty()
    let heard = 0
    const stop = bus.channel().listen(() => { heard++ })
    await proposals.create(inputFor(), 'import', { basis: unsaved() })
    stop()
    expect(heard).toBe(1)
  })

  it('is stale when a first write stored a planner after the proposal was made', async () => {
    const { proposals, planner, store } = empty()
    const proposal = await proposals.create(inputFor(), 'import', { basis: unsaved() })
    expect(await planner.save({ ...unsaved(), revision: 1, settings: { ...unsaved().settings, weekStartsOn: 0 } }, 0)).toEqual({ kind: 'ok', revision: 1 })
    expect((store as MemoryStore).data.has('unsavedBaseline')).toBe(false)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 0)).toEqual({ kind: 'stale', currentRevision: 1 })
    expect(storedDocument(store as MemoryStore)).toMatchObject({ revision: 1, categories: [] })
  })

  it('is gone after a delete-all, which also drops the unsaved planner', async () => {
    const { proposals, planner, store } = empty()
    const proposal = await proposals.create(inputFor(), 'import', { basis: unsaved() })
    expect(await planner.deleteAll(testDocument({ workspaceId: 'fresh', revision: 1 }), 0)).toEqual({ kind: 'ok', revision: 1 })
    expect((store as MemoryStore).data.has('unsavedBaseline')).toBe(false)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 0)).toEqual({ kind: 'not-found' })
    expect(storedDocument(store as MemoryStore).workspaceId).toBe('fresh')
  })

  it('is stale when the unsaved planner it was made against belongs to an older purge epoch', async () => {
    const { proposals, store } = empty()
    const memory = store as MemoryStore
    const proposal = await proposals.create(inputFor(), 'import', { basis: unsaved() })
    memory.data.set('purgeEpoch', 1)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 0)).toEqual({ kind: 'stale', currentRevision: 0 })
    expect(memory.data.has('document')).toBe(false)
    expect(storedProposals(memory)[0].status).toBe('stale')
  })
})
