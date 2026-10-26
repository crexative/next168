import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChangeProposal, PlannerDocument, ProposalDecision, ProposalCreateOptions, ProposalHistory, ProposalInput, ProposalRepository, SaveResult } from '../../src/core/model'
import { buildExportBundle } from '../../src/core/exportBundle'
import type { ExportBundle } from '../../src/core/model'
import { createEmptyDocument, documentFingerprint, nextGeneration, parseDocument, validateDocument } from '../../src/core/documents'
import { buildProposal, commitProposal, CONTRACT_RETIRED, isRetiredContract, previewProposal } from '../../src/core/proposals'
import { currentProposals, legacyProposals, readProposalStore, withProposal, writeProposalStore, type ProposalStore } from '../../src/core/proposalRecords'
import { atomicWrite, Mutex, readOptional } from './files'

export class Workspace implements ProposalRepository {
  readonly mutex = new Mutex()
  private readonly documentFile: string
  // Contract 1.1 proposals live in their own file (tasks design rev 2.1 §10): an older companion still running keeps
  // rewriting proposals.json with its own schema and can never touch these records.
  private readonly proposalsFile: string
  private readonly legacyProposalsFile: string
  readonly warnings = new Set<string>()
  constructor(readonly home: string, private readonly now = () => new Date()) {
    this.documentFile = join(home, 'planner.json')
    this.proposalsFile = join(home, 'proposals.v3.json')
    this.legacyProposalsFile = join(home, 'proposals.json')
  }
  async initialize() {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    await this.mutex.run(async () => {
      if (await readOptional(this.documentFile) === undefined) {
        // The server has no browser language. "und" leaves language selection to the paired device until a person
        // saves an explicit preference; proposal approval preserves that choice.
        await this.write(this.documentFile, createEmptyDocument({ now: this.now(), locale: 'und', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
      }
      // First start of this version: the earlier list is imported once, read-only, classified per record.
      if (await readOptional(this.proposalsFile) === undefined) {
        const legacy = await readOptional(this.legacyProposalsFile)
        if (legacy !== undefined) await this.writeRaw(this.proposalsFile, writeProposalStore(readProposalStore(legacy)))
      }
    })
  }
  async load() { return parseDocument(await readOptional(this.documentFile)) }
  async backup() {
    const loaded = parseDocument(await readOptional(`${this.documentFile}.bak`))
    return loaded.kind === 'ok' ? loaded.document : undefined
  }
  async restoreBackup(): Promise<SaveResult> {
    return this.mutex.run(async () => {
      const current = await this.load()
      if (current.kind !== 'corrupt') throw Error('primary-not-corrupt')
      const backup = await this.backup()
      if (!backup) throw Error('no-valid-backup')
      // Preserve the valid backup instead of replacing it with corrupt primary bytes.
      const { writeFile } = await import('node:fs/promises')
      const corrupt = await readOptional(this.documentFile)
      await writeFile(`${this.documentFile}.corrupt-${randomUUID()}`, corrupt ?? '', { mode: 0o600, flag: 'wx' })
      // A replacement: a later generation than the backup, so an Undo bound to the planner before it is refused.
      const restored = validateDocument({ ...backup, generation: nextGeneration(undefined, backup) })
      const result = await atomicWrite(this.documentFile, JSON.stringify(restored), { preserveBackup: true })
      if (result.warning) this.warnings.add(result.warning)
      return { kind: 'ok', revision: restored.revision }
    })
  }
  async document(): Promise<PlannerDocument> {
    const loaded = await this.load()
    if (loaded.kind !== 'ok') throw Error('stored-document-unreadable')
    return loaded.document
  }
  // `guard`: the document the caller opened on (fingerprint) and its workspace, compared inside the mutex. A revision alone
  // can repeat after a backup restore, so a stale preview would otherwise overwrite different content.
  async save(candidate: PlannerDocument, expectedRevision: number, guard: { storedFingerprint?: string; workspaceId?: string } = {}): Promise<SaveResult> {
    return this.mutex.run(async () => {
      const current = await this.document()
      if (current.revision !== expectedRevision) return { kind: 'conflict', currentRevision: current.revision }
      if (guard.workspaceId !== undefined && guard.workspaceId !== current.workspaceId) return { kind: 'conflict', currentRevision: current.revision }
      if (guard.storedFingerprint !== undefined && guard.storedFingerprint !== await documentFingerprint(current)) return { kind: 'conflict', currentRevision: current.revision }
      const checked = validateDocument(candidate)
      if (checked.revision !== expectedRevision + 1) throw Error('invalid-revision')
      if (checked.workspaceId === current.workspaceId && JSON.stringify(checked.appliedProposalIds) !== JSON.stringify(current.appliedProposalIds)) throw Error('immutable-approval-record')
      await this.write(this.documentFile, checked)
      return { kind: 'ok', revision: checked.revision }
    })
  }
  async importBundle(bundle: ExportBundle, expectedRevision: number): Promise<SaveResult> {
    const checked = buildExportBundle(bundle.document, bundle.calendarSourceTexts, { now: this.now })
    return this.mutex.run(async () => {
      const current = await this.document()
      if (current.revision !== expectedRevision) return { kind: 'conflict', currentRevision: current.revision }
      if (['categories', 'blocks', 'tasks', 'events', 'calendarSources', 'checkIns', 'actuals'].some(key => (current[key as keyof PlannerDocument] as unknown[]).length)) throw Error('workspace-not-empty')
      const imported = { ...checked.document, revision: current.revision + 1, generation: nextGeneration(current, checked.document) }
      const directory = join(this.home, 'calendars')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      for (const [id, text] of Object.entries(checked.calendarSourceTexts)) {
        const file = join(directory, `${encodeURIComponent(id).replace(/\./g, '%2E')}.ics`)
        await atomicWrite(file, text)
      }
      await this.write(this.documentFile, imported)
      return { kind: 'ok', revision: imported.revision }
    })
  }
  private async store(): Promise<ProposalStore> {
    return readProposalStore(await readOptional(this.proposalsFile))
  }
  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const proposals = currentProposals(await this.store())
    return status ? proposals.filter(item => item.status === status) : proposals
  }
  async history(): Promise<ProposalHistory> {
    const store = await this.store()
    return { proposals: currentProposals(store), legacy: legacyProposals(store), quarantine: store.quarantine }
  }
  async create(input: ProposalInput, source: ChangeProposal['source'], { clientName }: ProposalCreateOptions = {}) {
    if (isRetiredContract(input)) throw Error(CONTRACT_RETIRED)
    return this.mutex.run(async () => {
      const document = await this.document()
      const proposal = await buildProposal(input, document, source, { now: this.now }, randomUUID)
      const preview = await previewProposal(document, proposal)
      if (!preview.valid) throw Error(preview.reason)
      if (clientName) proposal.clientName = clientName.slice(0, 80)
      const store = await this.store()
      if (store.records.length + store.quarantine.length >= 2000) throw Error('proposal-history-full')
      await this.writeRaw(this.proposalsFile, writeProposalStore(withProposal(store, proposal)))
      return proposal
    })
  }
  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return this.mutex.run(async () => {
      const store = await this.store()
      const found = currentProposals(store).find(item => item.id === id)
      // Only a contract 1.1 record can execute: a 1.0 one is stale history, a quarantined one is not a proposal.
      if (!found) return legacyProposals(store).some(item => item.id === id) ? { kind: 'stale', currentRevision: (await this.document()).revision } : { kind: 'not-found' }
      const proposal = structuredClone(found)
      if (proposal.contentHash !== contentHash) throw Error('content-hash-mismatch')
      if (proposal.baseRevision !== baseRevision) throw Error('base-revision-mismatch')
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision! }
      if (proposal.status === 'rejected') return { kind: 'rejected' }
      const document = await this.document()
      if (document.workspaceId !== proposal.workspaceId) throw Error('proposal.wrongWorkspace')
      if (!document.appliedProposalIds.includes(id) && document.revision !== baseRevision) {
        Object.assign(proposal, { status: 'stale', decidedAt: this.now().toISOString() })
        await this.writeRaw(this.proposalsFile, writeProposalStore(withProposal(store, proposal)))
        return { kind: 'stale', currentRevision: document.revision }
      }
      const result = await commitProposal(document, proposal, randomUUID, { now: this.now })
      if (result.kind === 'rejected') throw Error(result.reason)
      if (result.kind === 'applied') {
        await this.write(this.documentFile, result.document)
        Object.assign(proposal, result.proposal)
      } else {
        Object.assign(proposal, { status: 'applied', appliedRevision: proposal.baseRevision + 1, decidedAt: this.now().toISOString() })
      }
      try { await this.writeRaw(this.proposalsFile, writeProposalStore(withProposal(store, proposal))) }
      catch { this.warnings.add('proposal-status-repair-pending') }
      return { kind: 'applied', revision: proposal.appliedRevision! }
    })
  }
  async reject(id: string): Promise<ProposalDecision> {
    return this.mutex.run(async () => {
      const store = await this.store()
      const found = currentProposals(store).find(item => item.id === id)
      if (!found) return legacyProposals(store).some(item => item.id === id) ? { kind: 'rejected' } : { kind: 'not-found' }
      const proposal = structuredClone(found)
      const document = await this.document()
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision! }
      if (document.workspaceId === proposal.workspaceId && document.appliedProposalIds.includes(id)) {
        Object.assign(proposal, { status: 'applied', appliedRevision: proposal.baseRevision + 1, decidedAt: this.now().toISOString() })
        try { await this.writeRaw(this.proposalsFile, writeProposalStore(withProposal(store, proposal))) }
        catch { this.warnings.add('proposal-status-repair-pending') }
        return { kind: 'applied', revision: proposal.appliedRevision! }
      }
      if (proposal.status !== 'rejected') {
        Object.assign(proposal, { status: 'rejected', decidedAt: this.now().toISOString() })
        await this.writeRaw(this.proposalsFile, writeProposalStore(withProposal(store, proposal)))
      }
      return { kind: 'rejected' }
    })
  }
  private async write(file: string, value: unknown) {
    await this.writeRaw(file, JSON.stringify(value))
  }
  private async writeRaw(file: string, text: string) {
    const result = await atomicWrite(file, text)
    if (result.warning) this.warnings.add(result.warning)
  }
}
