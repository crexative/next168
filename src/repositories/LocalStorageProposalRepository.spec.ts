import { describe, expect, it } from 'vitest'
import type { ProposalInput } from '@/core/model'
import { sha256 } from '@/core/canonical'
import { LocalStorageProposalRepository, ProposalError } from './LocalStorageProposalRepository'
import { LocalStorageRepository } from './LocalStorageRepository'
import { createTestRepositories, fixedNow, KEYS, MemoryStorage, mutexRunner, newTestId, testDocument } from './testSupport'
import type { RunExclusive } from './storageCommit'

const category = { id: 'work', name: 'Work', colorKey: 'blue' as const, goal: { type: 'max' as const, hoursPerWeek: 40 } }

async function setup() {
  const repos = createTestRepositories()
  await repos.planner.save(testDocument({ revision: 1, categories: [category] }), 0)
  const input: ProposalInput = {
    contractVersion: '1.0', workspaceId: 'workspace-1', baseRevision: 1, summary: 'Add focus block',
    ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }],
  }
  return { ...repos, input }
}

const storedDocument = (storage: Map<string, string>) => JSON.parse(storage.get(KEYS.document)!)

describe('proposal repository', () => {
  it('stores a pending proposal bound to the workspace and the ops hash', async () => {
    const { proposals, input } = await setup()
    const proposal = await proposals.create(input, 'mcp', 'client')
    expect(proposal).toMatchObject({ status: 'pending', workspaceId: 'workspace-1', baseRevision: 1, clientName: 'client' })
    expect(proposal.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await proposals.list('pending')).toHaveLength(1)
  })

  it('rejects a proposal for another workspace before storing it', async () => {
    const { proposals, input, storage } = await setup()
    await expect(proposals.create({ ...input, workspaceId: 'other' }, 'mcp')).rejects.toMatchObject({ code: 'workspace-mismatch' })
    await expect(proposals.create(input, 'mcp', 'x'.repeat(81))).rejects.toMatchObject({ code: 'proposal-invalid' })
    expect(await proposals.list()).toHaveLength(0)
    expect(storage.data.has(KEYS.proposals)).toBe(false)
  })

  it('rejects creation against a stale revision without storing a proposal', async () => {
    const { proposals, input, storage } = await setup()
    await expect(proposals.create({ ...input, baseRevision: 0 }, 'mcp')).rejects.toBeDefined()
    expect(storage.data.has(KEYS.proposals)).toBe(false)
  })

  it('approve commits the document and the applied id, then marks the proposal applied', async () => {
    const { proposals, input, storage } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    const document = storedDocument(storage.data)
    expect(document.revision).toBe(2)
    expect(document.blocks).toHaveLength(1)
    expect(document.appliedProposalIds).toEqual([proposal.id])
    expect((await proposals.list('applied'))[0]).toMatchObject({ appliedRevision: 2 })
  })

  it('a second approve returns the recorded result without applying again', async () => {
    const { proposals, input, storage } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    await proposals.approve(proposal.id, proposal.contentHash, 1)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    expect(storedDocument(storage.data).blocks).toHaveLength(1)
  })

  it('concurrent approvals apply exactly once', async () => {
    const { proposals, input, storage } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    const decisions = await Promise.all([
      proposals.approve(proposal.id, proposal.contentHash, 1),
      proposals.approve(proposal.id, proposal.contentHash, 1),
    ])
    expect(decisions).toEqual([{ kind: 'applied', revision: 2 }, { kind: 'applied', revision: 2 }])
    expect(storedDocument(storage.data).blocks).toHaveLength(1)
  })

  it('holds the shared lock through async hash verification and the document commit', async () => {
    const storage = new MemoryStorage()
    const mutex = mutexRunner()
    let locked = false
    const runExclusive: RunExclusive = (task) => mutex(async () => {
      locked = true
      try { return await task() } finally { locked = false }
    })
    const deps = { storage, runExclusive, now: fixedNow, newId: newTestId }
    const planner = new LocalStorageRepository({ ...deps, events: new EventTarget(), locale: () => 'en', timeZone: () => 'UTC' })
    let release!: () => void
    let started!: () => void
    const hashing = new Promise<void>((resolve) => { started = resolve })
    const resume = new Promise<void>((resolve) => { release = resolve })
    let pause = false
    const proposals = new LocalStorageProposalRepository({ ...deps, hash: async (value) => {
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
      contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Focus',
      ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }],
    }, 'mcp')
    pause = true
    const approval = proposals.approve(proposal.id, proposal.contentHash, 1)
    await hashing
    const competingSave = planner.save({ ...document, revision: 2 }, 1)
    expect(storedDocument(storage.data).revision).toBe(1)
    release()
    expect(await approval).toEqual({ kind: 'applied', revision: 2 })
    expect(await competingSave).toEqual({ kind: 'conflict', currentRevision: 2 })
    expect(storedDocument(storage.data).blocks).toHaveLength(1)
  })

  it('repairs only the status when the response was lost after the document commit', async () => {
    const { proposals, input, storage } = await setup()
    const proposal = await proposals.create(input, 'assistant')
    storage.failWritesTo.add(KEYS.proposals)
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toBeDefined()
    expect(storedDocument(storage.data).revision).toBe(2)
    const committed = storage.data.get(KEYS.document)
    const backup = storage.data.get(KEYS.backup)
    storage.failWritesTo.clear()

    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toMatchObject({ kind: 'applied' })
    expect(storedDocument(storage.data).blocks).toHaveLength(1)
    expect((await proposals.list('applied'))).toHaveLength(1)
    expect(storage.data.get(KEYS.document)).toBe(committed)
    expect(storage.data.get(KEYS.backup)).toBe(backup)
  })

  it('rejects tampered ops even when approval supplies the recorded hash', async () => {
    const { proposals, input, storage } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    storage.data.set(KEYS.proposals, JSON.stringify([{ ...proposal, ops: [
      { ...input.ops[0], block: { categoryId: 'work', title: 'Tampered', days: [1], start: 540, end: 600 } },
    ] }]))
    const before = storage.data.get(KEYS.document)
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toBeDefined()
    expect(storage.data.get(KEYS.document)).toBe(before)
    expect(await proposals.list('pending')).toHaveLength(1)
  })

  it('repairs a committed proposal after later edits without rewriting either document slot', async () => {
    const { proposals, planner, input, storage } = await setup()
    const proposal = await proposals.create(input, 'mcp')
    storage.failWritesTo.add(KEYS.proposals)
    await expect(proposals.approve(proposal.id, proposal.contentHash, 1)).rejects.toBeDefined()
    storage.failWritesTo.clear()
    await planner.save({ ...storedDocument(storage.data), revision: 3 }, 2)
    const document = storage.data.get(KEYS.document)
    const backup = storage.data.get(KEYS.backup)
    expect(await proposals.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 3 })
    expect(storage.data.get(KEYS.document)).toBe(document)
    expect(storage.data.get(KEYS.backup)).toBe(backup)
    expect(await proposals.list('applied')).toHaveLength(1)
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
})
