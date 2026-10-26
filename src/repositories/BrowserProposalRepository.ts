import {
  changeProposalSchema, proposalInputSchema,
  type ChangeProposal, type PlannerDocument, type ProposalCreateOptions, type ProposalDecision, type ProposalHistory, type ProposalInput, type ProposalRepository,
} from '@/core/model'
import type { Hasher } from '@/core/canonical'
import { CONTRACT_RETIRED, isRetiredContract } from '@/core/proposals'
import { currentProposals, legacyProposals, readProposalStore, withProposal, writeProposalStore, type ProposalStore } from '@/core/proposalRecords'
import { buildProposal, commitProposal, validateDocument } from './core'
import type { ChangeChannel } from './changeChannel'
import type { BrowserStore, Snapshot } from './indexedDbStore'
import {
  NO_WEB_LOCKS, currentUnsavedBaseline, purgeEpochOf, storedDocument, unsavedBaselineRecord, type RunExclusive,
} from './storageCommit'

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


// What a proposal is made against: the stored planner or, while nothing is stored, the unsaved one shown to the person
// (the one already stored beside earlier proposals, or else the caller's `basis`, which must never have been written).
type ProposalBase = { document: PlannerDocument; unsaved: boolean }

function unsavedBasis(basis: PlannerDocument | undefined): PlannerDocument {
  if (!basis) throw new ProposalError('no-document')
  let document: PlannerDocument
  try { document = validateDocument(basis) } catch { throw new ProposalError('no-document') }
  if (document.revision !== 0) throw new ProposalError('no-document')
  return document
}

function baseForCreate(snapshot: Snapshot, basis: PlannerDocument | undefined): ProposalBase {
  const stored = storedDocument(snapshot.document)
  if (stored.kind === 'ok') return { document: stored.document, unsaved: false }
  if (stored.kind !== 'absent') throw new ProposalError('no-document')
  const existing = currentUnsavedBaseline(snapshot)
  return { document: existing?.document ?? unsavedBasis(basis), unsaved: true }
}

// At approval: the stored planner, or the unsaved one this proposal was made against while storage still holds nothing.
function baseForApproval(snapshot: Snapshot, proposal: ChangeProposal): ProposalBase | undefined {
  const stored = storedDocument(snapshot.document)
  if (stored.kind === 'ok') return { document: stored.document, unsaved: false }
  if (stored.kind !== 'absent') throw new ProposalError('no-document')
  const existing = currentUnsavedBaseline(snapshot)
  return existing && existing.document.workspaceId === proposal.workspaceId ? { document: existing.document, unsaved: true } : undefined
}

function storedRevision(snapshot: Snapshot): number {
  const stored = storedDocument(snapshot.document)
  return stored.kind === 'ok' ? stored.document.revision : 0
}

const replaced = (store: ProposalStore, updated: ChangeProposal) => writeProposalStore(withProposal(store, updated))

export class BrowserProposalRepository implements ProposalRepository {
  constructor(private readonly deps: ProposalRepositoryDeps) {}

  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const all = currentProposals(readProposalStore((await this.deps.store.read(['proposals'])).proposals))
    return status ? all.filter((proposal) => proposal.status === status) : all
  }

  async history(): Promise<ProposalHistory> {
    const store = readProposalStore((await this.deps.store.read(['proposals'])).proposals)
    return { proposals: currentProposals(store), legacy: legacyProposals(store), quarantine: store.quarantine }
  }

  async create(input: ProposalInput, source: ChangeProposal['source'], { clientName, basis }: ProposalCreateOptions = {}): Promise<ChangeProposal> {
    if (isRetiredContract(input)) throw new ProposalError(CONTRACT_RETIRED)
    const parsed = proposalInputSchema.safeParse(input)
    if (!parsed.success) throw new ProposalError('proposal-invalid')
    return this.exclusive(async () => {
      const snapshot = await this.deps.store.read(['document', 'proposals', 'purgeEpoch', 'unsavedBaseline'])
      const { document, unsaved } = baseForCreate(snapshot, basis)
      if (document.workspaceId !== parsed.data.workspaceId) throw new ProposalError('workspace-mismatch')
      const proposals = readProposalStore(snapshot.proposals)
      const built = await buildProposal(parsed.data, document, source, this.deps, this.deps.newId, this.deps.hash)
      const candidate = changeProposalSchema.safeParse({ ...built, ...(clientName ? { clientName } : {}) })
      if (!candidate.success) throw new ProposalError('proposal-invalid')
      const proposalsJson = writeProposalStore(withProposal(proposals, candidate.data))
      if (!unsaved) {
        await this.deps.store.write({ proposals: proposalsJson })
        return candidate.data
      }
      await this.deps.store.write({ proposals: proposalsJson, unsavedBaseline: unsavedBaselineRecord(document, purgeEpochOf(snapshot)) })
      // Other tabs reload and show this same unsaved planner, so their proposals are made against it too.
      this.notify()
      return candidate.data
    })
  }

  // The document, its backup and the proposal status commit in one transaction: all of it, or none of it.
  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const { store, now } = this.deps
      const snapshot = await store.read(['document', 'proposals', 'purgeEpoch', 'unsavedBaseline'])
      const proposals = readProposalStore(snapshot.proposals)
      const proposal = currentProposals(proposals).find((candidate) => candidate.id === id)
      // Only a contract 1.1 record can execute: a 1.0 one is stale history, a quarantined one is not a proposal at all.
      if (!proposal) return legacyProposals(proposals).some((legacy) => legacy.id === id) ? { kind: 'stale', currentRevision: storedRevision(snapshot) } : { kind: 'not-found' }
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision ?? 0 }
      if (proposal.status === 'rejected') return { kind: 'rejected' }
      if (proposal.contentHash !== contentHash) throw new ProposalError('content-hash-mismatch')

      const base = baseForApproval(snapshot, proposal)
      if (!base) {
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'stale', decidedAt: now().toISOString() }) })
        return { kind: 'stale', currentRevision: 0 }
      }
      const { document, unsaved } = base
      if (!document.appliedProposalIds.includes(id) && (document.revision !== baseRevision || document.revision !== proposal.baseRevision)) {
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'stale', decidedAt: now().toISOString() }) })
        return { kind: 'stale', currentRevision: document.revision }
      }

      const applied = await commitProposal(document, proposal, this.deps.newId, this.deps, this.deps.hash)
      if (applied.kind === 'rejected') throw new ProposalError(applied.reason)
      if (applied.kind === 'already-applied') {
        await store.write({ proposals: replaced(proposals, { ...proposal, status: 'applied', appliedRevision: applied.document.revision, decidedAt: now().toISOString() }) })
        return { kind: 'applied', revision: applied.document.revision }
      }
      // Storage held nothing when this was read inside the lock, so the approval creates the planner (no backup yet).
      const previous = unsaved ? { unsavedBaseline: null } : { backup: snapshot.document! }
      await store.write({ document: JSON.stringify(applied.document), ...previous, proposals: replaced(proposals, applied.proposal) })
      this.notify()
      return { kind: 'applied', revision: applied.document.revision }
    })
  }

  async reject(id: string): Promise<ProposalDecision> {
    return this.exclusive(async () => {
      const { store, now } = this.deps
      const snapshot = await store.read(['document', 'proposals'])
      const proposals = readProposalStore(snapshot.proposals)
      const proposal = currentProposals(proposals).find((candidate) => candidate.id === id)
      if (!proposal) return legacyProposals(proposals).some((legacy) => legacy.id === id) ? { kind: 'rejected' } : { kind: 'not-found' }
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
