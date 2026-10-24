import { z } from 'zod'
import {
  STORAGE_KEYS, changeProposalSchema, proposalInputSchema,
  type ChangeProposal, type PlannerDocument, type ProposalDecision, type ProposalInput, type ProposalRepository,
} from '@/core/model'
import { applyProposal } from './core'
import { NO_WEB_LOCKS } from './LocalStorageRepository'
import { readStoredDocument, writeWithBackup, type RunExclusive, type StorageLike } from './storageCommit'

export const PROPOSALS_KEY = STORAGE_KEYS.proposals
const MAX_APPLIED_IDS = 200

export interface ProposalRepositoryDeps {
  storage: StorageLike
  runExclusive: RunExclusive | undefined
  now: () => Date
  newId: () => string
}

export class ProposalError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function hashOps(ops: ProposalInput['ops']): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(ops))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
    const contentHash = await hashOps(parsed.data.ops)
    return this.exclusive(async () => {
      const stored = readStoredDocument(this.deps.storage)
      if (stored.kind !== 'ok') throw new ProposalError('no-document')
      if (stored.document.workspaceId !== parsed.data.workspaceId) throw new ProposalError('workspace-mismatch')
      const proposal: ChangeProposal = {
        id: this.deps.newId(),
        workspaceId: parsed.data.workspaceId,
        source,
        ...(clientName ? { clientName } : {}),
        baseRevision: parsed.data.baseRevision,
        contentHash,
        summary: parsed.data.summary,
        ops: parsed.data.ops,
        status: 'pending',
        createdAt: this.deps.now().toISOString(),
      }
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

      if (document.appliedProposalIds.includes(id)) {
        this.updateProposal(proposals, { ...proposal, status: 'applied', appliedRevision: document.revision, decidedAt: this.deps.now().toISOString() })
        return { kind: 'applied', revision: document.revision }
      }
      if (document.revision !== baseRevision || document.revision !== proposal.baseRevision) {
        this.updateProposal(proposals, { ...proposal, status: 'stale', decidedAt: this.deps.now().toISOString() })
        return { kind: 'stale', currentRevision: document.revision }
      }

      const applied = applyProposal(document, proposal, this.deps.newId, this.deps.now())
      if (!applied.ok) throw new ProposalError(applied.reason)
      const next: PlannerDocument = {
        ...applied.document,
        revision: document.revision + 1,
        updatedAt: this.deps.now().toISOString(),
        appliedProposalIds: [...document.appliedProposalIds, id].slice(-MAX_APPLIED_IDS),
      }
      writeWithBackup(this.deps.storage, next)
      this.updateProposal(proposals, { ...proposal, status: 'applied', appliedRevision: next.revision, decidedAt: this.deps.now().toISOString() })
      return { kind: 'applied', revision: next.revision }
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

