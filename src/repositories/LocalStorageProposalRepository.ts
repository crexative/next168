import { z } from 'zod'
import {
  STORAGE_KEYS, changeProposalSchema, proposalInputSchema,
  type ChangeProposal, type ProposalDecision, type ProposalInput, type ProposalRepository,
} from '@/core/model'
import type { Hasher } from '@/core/canonical'
import { applyProposal, buildProposal } from './core'
import { NO_WEB_LOCKS } from './LocalStorageRepository'
import { readStoredDocument, writeWithBackup, type RunExclusive, type StorageLike } from './storageCommit'

export const PROPOSALS_KEY = STORAGE_KEYS.proposals

export interface ProposalRepositoryDeps {
  storage: StorageLike
  runExclusive: RunExclusive | undefined
  now: () => Date
  newId: () => string
  hash?: Hasher
}

export class ProposalError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export class LocalStorageProposalRepository implements ProposalRepository {
  constructor(private readonly deps: ProposalRepositoryDeps) {}

  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const all = this.readAll()
    return status ? all.filter((proposal) => proposal.status === status) : all
  }

  async create(input: ProposalInput, source: ChangeProposal['source'], clientName?: string): Promise<ChangeProposal> {
    const parsed = proposalInputSchema.safeParse(input)
    if (!parsed.success) throw new ProposalError('proposal-invalid')
    return this.exclusive(async () => {
      const stored = readStoredDocument(this.deps.storage)
      if (stored.kind !== 'ok') throw new ProposalError('no-document')
      if (stored.document.workspaceId !== parsed.data.workspaceId) throw new ProposalError('workspace-mismatch')
      const built = await buildProposal(parsed.data, stored.document, source, this.deps, this.deps.newId, this.deps.hash)
      const candidate = changeProposalSchema.safeParse({ ...built, ...(clientName ? { clientName } : {}) })
      if (!candidate.success) throw new ProposalError('proposal-invalid')
      const proposal: ChangeProposal = candidate.data
      this.writeAll([...this.readAll(), proposal])
      return proposal
    })
  }

  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const proposals = this.readAll()
      const proposal = proposals.find((candidate) => candidate.id === id)
      if (!proposal) return { kind: 'not-found' }
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision ?? 0 }
      if (proposal.status === 'rejected') return { kind: 'rejected' }
      if (proposal.contentHash !== contentHash) throw new ProposalError('content-hash-mismatch')

      const stored = readStoredDocument(this.deps.storage)
      if (stored.kind !== 'ok') throw new ProposalError('no-document')
      const document = stored.document

      if (!document.appliedProposalIds.includes(id) && (document.revision !== baseRevision || document.revision !== proposal.baseRevision)) {
        this.updateProposal(proposals, { ...proposal, status: 'stale', decidedAt: this.deps.now().toISOString() })
        return { kind: 'stale', currentRevision: document.revision }
      }

      const applied = await applyProposal(document, proposal, this.deps.newId, this.deps, this.deps.hash)
      if (applied.kind === 'rejected') throw new ProposalError(applied.reason)
      if (applied.kind === 'already-applied') {
        this.updateProposal(proposals, { ...proposal, status: 'applied', appliedRevision: applied.document.revision, decidedAt: this.deps.now().toISOString() })
        return { kind: 'applied', revision: applied.document.revision }
      }
      writeWithBackup(this.deps.storage, applied.document)
      this.updateProposal(proposals, applied.proposal)
      return { kind: 'applied', revision: applied.document.revision }
    })
  }

  async reject(id: string): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const proposals = this.readAll()
      const proposal = proposals.find((candidate) => candidate.id === id)
      if (!proposal) return { kind: 'not-found' }
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision ?? 0 }
      if (proposal.status === 'pending') {
        this.updateProposal(proposals, { ...proposal, status: 'rejected', decidedAt: this.deps.now().toISOString() })
      }
      return { kind: 'rejected' }
    })
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const { runExclusive } = this.deps
    if (!runExclusive) throw new ProposalError(NO_WEB_LOCKS)
    return runExclusive(task)
  }

  private readAll(): ChangeProposal[] {
    const raw = this.deps.storage.getItem(PROPOSALS_KEY)
    if (raw === null) return []
    const parsed = z.array(changeProposalSchema).safeParse(JSON.parse(raw))
    if (!parsed.success) throw new ProposalError('proposals-unreadable')
    return parsed.data
  }

  private writeAll(proposals: ChangeProposal[]): void {
    this.deps.storage.setItem(PROPOSALS_KEY, JSON.stringify(proposals))
  }

  // A failed status write after a committed document is repaired by the next approve (appliedProposalIds).
  private updateProposal(all: ChangeProposal[], updated: ChangeProposal): void {
    this.writeAll(all.map((proposal) => (proposal.id === updated.id ? updated : proposal)))
  }
}

