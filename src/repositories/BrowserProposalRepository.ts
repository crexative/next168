import { z } from 'zod'
import {
  changeProposalSchema, proposalInputSchema,
  type ChangeProposal, type PlannerDocument, type ProposalDecision, type ProposalInput, type ProposalRepository,
} from '@/core/model'
import type { Hasher } from '@/core/canonical'
import { applyProposal, buildProposal } from './core'
import type { ChangeChannel } from './changeChannel'
import type { BrowserStore } from './indexedDbStore'
import { NO_WEB_LOCKS, storedDocument, type RunExclusive } from './storageCommit'

export interface ProposalRepositoryDeps {
  store: BrowserStore
  runExclusive: RunExclusive | undefined
  channel?: ChangeChannel
  now: () => Date
  newId: () => string
  hash?: Hasher
}

export class ProposalError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function parseProposals(raw: string | undefined): ChangeProposal[] {
  if (raw === undefined) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ProposalError('proposals-unreadable')
  }
  const parsed = z.array(changeProposalSchema).safeParse(value)
  if (!parsed.success) throw new ProposalError('proposals-unreadable')
  return parsed.data
}

function readableDocument(raw: string | undefined): PlannerDocument {
  const stored = storedDocument(raw)
  if (stored.kind !== 'ok') throw new ProposalError('no-document')
  return stored.document
}

const replaced = (all: ChangeProposal[], updated: ChangeProposal) => JSON.stringify(all.map((proposal) => (proposal.id === updated.id ? updated : proposal)))

export class BrowserProposalRepository implements ProposalRepository {
  constructor(private readonly deps: ProposalRepositoryDeps) {}

  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const all = parseProposals((await this.deps.store.read(['proposals'])).proposals)
    return status ? all.filter((proposal) => proposal.status === status) : all
  }

  async create(input: ProposalInput, source: ChangeProposal['source'], clientName?: string): Promise<ChangeProposal> {
    const parsed = proposalInputSchema.safeParse(input)
    if (!parsed.success) throw new ProposalError('proposal-invalid')
    return this.exclusive(async () => {
      const snapshot = await this.deps.store.read(['document', 'proposals'])
      const document = readableDocument(snapshot.document)
      if (document.workspaceId !== parsed.data.workspaceId) throw new ProposalError('workspace-mismatch')
      const proposals = parseProposals(snapshot.proposals)
      const built = await buildProposal(parsed.data, document, source, this.deps, this.deps.newId, this.deps.hash)
      const candidate = changeProposalSchema.safeParse({ ...built, ...(clientName ? { clientName } : {}) })
      if (!candidate.success) throw new ProposalError('proposal-invalid')
      await this.deps.store.write({ proposals: JSON.stringify([...proposals, candidate.data]) })
      return candidate.data
    })
  }

  // The document, its backup and the proposal status commit in one transaction: all of it, or none of it.
  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const { store, now } = this.deps
      const snapshot = await store.read(['document', 'proposals'])
      const proposals = parseProposals(snapshot.proposals)
      const proposal = proposals.find((candidate) => candidate.id === id)
      if (!proposal) return { kind: 'not-found' }
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision ?? 0 }
      if (proposal.status === 'rejected') return { kind: 'rejected' }
      if (proposal.contentHash !== contentHash) throw new ProposalError('content-hash-mismatch')

      const document = readableDocument(snapshot.document)
      if (!document.appliedProposalIds.includes(id) && (document.revision !== baseRevision || document.revision !== proposal.baseRevision)) {
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'stale', decidedAt: now().toISOString() }) })
        return { kind: 'stale', currentRevision: document.revision }
      }

      const applied = await applyProposal(document, proposal, this.deps.newId, this.deps, this.deps.hash)
      if (applied.kind === 'rejected') throw new ProposalError(applied.reason)
      if (applied.kind === 'already-applied') {
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'applied', appliedRevision: applied.document.revision, decidedAt: now().toISOString() }) })
        return { kind: 'applied', revision: applied.document.revision }
      }
      await store.write({ document: JSON.stringify(applied.document), backup: snapshot.document!, proposals: replaced(proposals, applied.proposal) })
      this.notify()
      return { kind: 'applied', revision: applied.document.revision }
    })
  }

  async reject(id: string): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const { store, now } = this.deps
      const snapshot = await store.read(['document', 'proposals'])
      const proposals = parseProposals(snapshot.proposals)
      const proposal = proposals.find((candidate) => candidate.id === id)
      if (!proposal) return { kind: 'not-found' }
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision ?? 0 }
      if (proposal.status === 'pending' || proposal.status === 'stale') {
        // A proposal the document already applied (inconsistent imported tester data) is recorded as applied.
        const stored = storedDocument(snapshot.document)
        if (stored.kind === 'ok' && stored.document.appliedProposalIds.includes(id)) {
          const revision = stored.document.revision
          await store.write({ proposals: replaced(proposals, { ...proposal, status: 'applied', appliedRevision: revision, decidedAt: now().toISOString() }) })
          return { kind: 'applied', revision }
        }
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'rejected', decidedAt: now().toISOString() }) })
      }
      return { kind: 'rejected' }
    })
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const { runExclusive } = this.deps
    if (!runExclusive) throw new ProposalError(NO_WEB_LOCKS)
    return runExclusive(task)
  }

  private notify(): void {
    try { this.deps.channel?.notify() } catch { /* Other tabs re-check on focus; the CAS protects their commits. */ }
  }
}
