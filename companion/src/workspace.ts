import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { changeProposalSchema, type ChangeProposal, type PlannerDocument, type ProposalDecision, type ProposalInput, type ProposalRepository, type SaveResult } from '../../src/core/model'
import { buildExportBundle } from '../../src/core/exportBundle'
import type { ExportBundle } from '../../src/core/model'
import { createEmptyDocument, parseDocument, validateDocument } from '../../src/core/documents'
import { applyProposal, buildProposal, previewProposal } from '../../src/core/proposals'
import { atomicWrite, Mutex, readOptional } from './files'

export class Workspace implements ProposalRepository {
  readonly mutex = new Mutex()
  private readonly documentFile: string
  private readonly proposalsFile: string
  readonly warnings = new Set<string>()
  constructor(readonly home: string, private readonly now = () => new Date()) {
    this.documentFile = join(home, 'planner.json')
    this.proposalsFile = join(home, 'proposals.json')
  }
  async initialize() {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    await this.mutex.run(async () => {
      if (await readOptional(this.documentFile) === undefined) {
        await this.write(this.documentFile, createEmptyDocument({ now: this.now(), locale: 'en', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
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
      const result = await atomicWrite(this.documentFile, JSON.stringify(backup), { preserveBackup: true })
      if (result.warning) this.warnings.add(result.warning)
      return { kind: 'ok', revision: backup.revision }
    })
  }
  async document(): Promise<PlannerDocument> {
    const loaded = await this.load()
    if (loaded.kind !== 'ok') throw Error('stored-document-unreadable')
    return loaded.document
  }
  async save(candidate: PlannerDocument, expectedRevision: number): Promise<SaveResult> {
    return this.mutex.run(async () => {
      const current = await this.document()
      if (current.revision !== expectedRevision) return { kind: 'conflict', currentRevision: current.revision }
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
      const imported = { ...checked.document, revision: current.revision + 1 }
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
  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const raw = await readOptional(this.proposalsFile)
    const proposals = raw === undefined ? [] : z.array(changeProposalSchema).max(2000).parse(JSON.parse(raw))
    return status ? proposals.filter(item => item.status === status) : proposals
  }
  async create(input: ProposalInput, source: ChangeProposal['source'], clientName?: string) {
    return this.mutex.run(async () => {
      const document = await this.document()
      const proposal = await buildProposal(input, document, source, { now: this.now }, randomUUID)
      const preview = await previewProposal(document, proposal)
      if (!preview.valid) throw Error(preview.reason)
      if (clientName) proposal.clientName = clientName.slice(0, 80)
      const all = await this.list()
      if (all.length >= 2000) throw Error('proposal-history-full')
      await this.write(this.proposalsFile, [...all, proposal])
      return proposal
    })
  }
  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return this.mutex.run(async () => {
      const all = await this.list()
      const proposal = all.find(item => item.id === id)
      if (!proposal) return { kind: 'not-found' }
      if (proposal.contentHash !== contentHash) throw Error('content-hash-mismatch')
      if (proposal.baseRevision !== baseRevision) throw Error('base-revision-mismatch')
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision! }
      if (proposal.status === 'rejected') return { kind: 'rejected' }
      const document = await this.document()
      if (document.workspaceId !== proposal.workspaceId) throw Error('proposal.wrongWorkspace')
      if (!document.appliedProposalIds.includes(id) && document.revision !== baseRevision) {
        Object.assign(proposal, { status: 'stale', decidedAt: this.now().toISOString() })
        await this.write(this.proposalsFile, all)
        return { kind: 'stale', currentRevision: document.revision }
      }
      const result = await applyProposal(document, proposal, randomUUID, { now: this.now })
      if (result.kind === 'rejected') throw Error(result.reason)
      if (result.kind === 'applied') {
        await this.write(this.documentFile, result.document)
        Object.assign(proposal, result.proposal)
      } else {
        Object.assign(proposal, { status: 'applied', appliedRevision: proposal.baseRevision + 1, decidedAt: this.now().toISOString() })
      }
      try { await this.write(this.proposalsFile, all) }
      catch { this.warnings.add('proposal-status-repair-pending') }
      return { kind: 'applied', revision: proposal.appliedRevision! }
    })
  }
  async reject(id: string): Promise<ProposalDecision> {
    return this.mutex.run(async () => {
      const all = await this.list()
      const proposal = all.find(item => item.id === id)
      if (!proposal) return { kind: 'not-found' }
      const document = await this.document()
      if (proposal.status === 'applied') return { kind: 'applied', revision: proposal.appliedRevision! }
      if (document.workspaceId === proposal.workspaceId && document.appliedProposalIds.includes(id)) {
        Object.assign(proposal, { status: 'applied', appliedRevision: proposal.baseRevision + 1, decidedAt: this.now().toISOString() })
        try { await this.write(this.proposalsFile, all) }
        catch { this.warnings.add('proposal-status-repair-pending') }
        return { kind: 'applied', revision: proposal.appliedRevision! }
      }
      if (proposal.status !== 'rejected') {
        Object.assign(proposal, { status: 'rejected', decidedAt: this.now().toISOString() })
        await this.write(this.proposalsFile, all)
      }
      return { kind: 'rejected' }
    })
  }
  private async write(file: string, value: unknown) {
    const result = await atomicWrite(file, JSON.stringify(value))
    if (result.warning) this.warnings.add(result.warning)
  }
}
