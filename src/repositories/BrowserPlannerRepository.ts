import { z } from 'zod'
import {
  STORAGE_KEYS, type CalendarSourceStore, type LoadResult, type PlannerDocument, type PlannerRepository, type SaveResult,
} from '@/core/model'
import { parseDocument, validateDocument } from './core'
import type { ChangeChannel } from './changeChannel'
import type { BrowserStore, Snapshot } from './indexedDbStore'
import { LEGACY_KEYS, planLegacyImport } from './legacyImport'
import {
  NO_WEB_LOCKS, currentUnsavedBaseline, failureReason, isValidDocumentText, purgeEpochOf, storedDocument, storedFingerprintOf,
  type RunExclusive, type StorageLike, type StoredDocument, type StoredFingerprint,
} from './storageCommit'

export { NO_WEB_LOCKS, purgeEpochOf } from './storageCommit'

// What a write must still find in storage, checked inside the commit lock before the write.
export interface CommitGuard {
  // Refuse when a delete-all happened since this epoch was read.
  purgeEpoch?: number
  // Refuse unless the stored document is exactly this ('absent' = nothing stored).
  storedFingerprint?: StoredFingerprint
}

export interface BrowserPlannerRepositoryDeps {
  store: BrowserStore
  // localStorage of older builds: import input, and the keys delete-all removes. Never written.
  legacy: StorageLike
  runExclusive: RunExclusive | undefined
  channel: ChangeChannel
  // `window`: `storage` events from older tabs and `focus`.
  events: EventTarget
  // `document`: `visibilitychange`, with the current state.
  visibility?: { target: EventTarget; visible(): boolean }
  // Browser calendar texts, so delete-all can remove the texts of the deleted planner.
  calendarTexts?: CalendarSourceStore
  now: () => Date
  newId: () => string
  locale: () => string
  timeZone: () => string
}

const purgeSchema = z.object({ legacyKeys: z.literal(true), calendarSourceIds: z.array(z.string()) })
type PurgeRecord = z.infer<typeof purgeSchema>

export const STORED_DOCUMENT_MISSING = 'stored-document-missing'

function purgeRecord(value: unknown): PurgeRecord | undefined {
  if (value === undefined) return undefined
  const parsed = purgeSchema.safeParse(value)
  if (!parsed.success) console.warn('next168: ignoring an unreadable purge record')
  return parsed.success ? parsed.data : undefined
}

function identityOf(raw: string | undefined): string {
  if (raw === undefined) return 'absent'
  const parsed = parseDocument(raw)
  return parsed.kind === 'ok' ? `${parsed.document.workspaceId}:${parsed.document.revision}` : `unreadable:${raw.length}`
}

export class BrowserPlannerRepository implements PlannerRepository {
  // Identity of the document this tab last loaded or committed; a focus re-check reloads only when it changed.
  private identity: string | undefined
  // Purge epoch of the planner this tab last loaded or reset. Calendar actions bind to it when the user starts them.
  private loadedPurgeEpoch: number | undefined

  constructor(private readonly deps: BrowserPlannerRepositoryDeps) {}

  get writable(): boolean {
    return this.deps.runExclusive !== undefined
  }

  async load(): Promise<LoadResult> {
    const { store, runExclusive } = this.deps
    const snapshot = await store.read(['document', 'migration', 'purge', 'purgeEpoch', 'unsavedBaseline'])
    this.loadedPurgeEpoch = purgeEpochOf(snapshot)
    if (this.purgePending(snapshot)) await this.finishPurge().catch((error) => console.warn('next168: purge resumes on the next load', error))
    if (snapshot.document !== undefined) {
      this.identity = identityOf(snapshot.document)
      return parseDocument(snapshot.document)
    }
    // An import already ran, so the planner was lost afterwards: recover, never resurrect the old localStorage bytes.
    if (snapshot.migration !== undefined) return { kind: 'corrupt', raw: '', reason: STORED_DOCUMENT_MISSING }
    const plan = planLegacyImport(this.deps.legacy, this.importEnvironment())
    if (plan.kind === 'none') return this.emptyResult(snapshot)
    if (!runExclusive) return plan.result
    return runExclusive(() => this.importOnce())
  }

  save(document: PlannerDocument, expectedRevision: number): Promise<SaveResult> {
    return this.commitDocument(document, expectedRevision)
  }

  // A save that also fails when a delete-all ran since `purgeEpoch` was read, even if the revision matches.
  saveAtEpoch(document: PlannerDocument, expectedRevision: number, purgeEpoch: number): Promise<SaveResult> {
    return this.commitDocument(document, expectedRevision, { purgeEpoch })
  }

  // A save that also fails unless storage still holds exactly the document the caller opened on, and (optionally)
  // the same purge epoch: a flow that cannot be refreshed mid-way uses it so it never overwrites another tab.
  saveGuarded(document: PlannerDocument, expectedRevision: number, guard: CommitGuard): Promise<SaveResult> {
    return this.commitDocument(document, expectedRevision, guard)
  }

  async purgeEpoch(): Promise<number> {
    return purgeEpochOf(await this.deps.store.read(['purgeEpoch']))
  }

  // Synchronous, so a user action captures it at the moment it is initiated, before any queue or await.
  knownPurgeEpoch(): number | undefined {
    return this.loadedPurgeEpoch
  }

  // Runs `write` under the commit lock only while no delete-all happened since `epoch`. Calendar text writes
  // go through here, so a refresh that started before a delete-all can never write after it.
  async ifPurgeEpoch(epoch: number, write: () => Promise<void>): Promise<boolean> {
    const { runExclusive, store } = this.deps
    if (!runExclusive) return false
    return runExclusive(async () => {
      if (purgeEpochOf(await store.read(['purgeEpoch'])) !== epoch) return false
      await write()
      return true
    })
  }

  subscribe(onExternalChange: () => void): () => void {
    const recheck = async () => {
      try {
        const { document } = await this.deps.store.read(['document'])
        if (identityOf(document) !== this.identity) onExternalChange()
      } catch {
        // A failing read is reported through a reload, which shows the storage error screen.
        onExternalChange()
      }
    }
    const onFocus = () => { void recheck() }
    const { visibility, events } = this.deps
    const onVisibility = () => { if (visibility?.visible()) void recheck() }
    const stopChannel = this.deps.channel.listen(onExternalChange)
    events.addEventListener('focus', onFocus)
    visibility?.target.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopChannel()
      events.removeEventListener('focus', onFocus)
      visibility?.target.removeEventListener('visibilitychange', onVisibility)
    }
  }

  // New code never writes these keys, so a non-null write comes from an older build open in another tab.
  onLegacyChange(onChange: () => void): () => void {
    const listener = (event: Event) => {
      const { key, newValue } = event as StorageEvent
      if ((key === STORAGE_KEYS.legacyV1 || key === STORAGE_KEYS.document) && newValue !== null && newValue !== undefined) onChange()
    }
    this.deps.events.addEventListener('storage', listener)
    return () => this.deps.events.removeEventListener('storage', listener)
  }

  // Replaces unreadable data with a new document. The unreadable bytes go to the backup unless it holds a valid document.
  replaceCorrupt(document: PlannerDocument): Promise<SaveResult> {
    return this.exclusiveWrite(async () => {
      const { document: raw, backup } = await this.deps.store.read(['document', 'backup'])
      const stored = storedDocument(raw)
      if (stored.kind === 'ok' || stored.kind === 'unsupported') return { kind: 'error', reason: 'data-is-not-corrupt' }
      const json = JSON.stringify(document)
      await this.deps.store.write({ document: json, ...(raw !== undefined && !isValidDocumentText(backup) ? { backup: raw } : {}) })
      this.identity = identityOf(json)
      return { kind: 'ok', revision: document.revision }
    })
  }

  async peekBackup(): Promise<PlannerDocument | undefined> {
    const { backup } = await this.deps.store.read(['backup'])
    if (backup === undefined) return undefined
    const parsed = parseDocument(backup)
    return parsed.kind === 'ok' ? parsed.document : undefined
  }

  restoreBackup(): Promise<SaveResult> {
    return this.exclusiveWrite(async () => {
      const { document: raw, backup } = await this.deps.store.read(['document', 'backup'])
      const stored = storedDocument(raw)
      if (stored.kind === 'ok' || stored.kind === 'unsupported') return { kind: 'error', reason: 'data-is-not-corrupt' }
      const parsed = parseDocument(backup ?? null)
      if (backup === undefined || parsed.kind !== 'ok') return { kind: 'error', reason: 'no-valid-backup' }
      await this.deps.store.write({ document: backup })
      this.identity = identityOf(backup)
      return { kind: 'ok', revision: parsed.document.revision }
    })
  }

  // Delete-all, in ONE hold of the commit lock: compare-and-swap, one transaction that replaces the document,
  // drops backup and proposals, records the purge and moves the purge epoch; then the cleanup outside IndexedDB.
  async deleteAll(fresh: PlannerDocument, expectedRevision: number): Promise<SaveResult> {
    let checked: PlannerDocument
    try {
      checked = validateDocument(fresh)
    } catch {
      return { kind: 'error', reason: 'invalid-document' }
    }
    return this.exclusiveWrite(async () => {
      const { store, calendarTexts } = this.deps
      const snapshot = await store.read(['document', 'purgeEpoch'])
      const refused = this.refuseStale(storedDocument(snapshot.document), expectedRevision)
      if (refused) return refused
      const calendarSourceIds = calendarTexts ? await calendarTexts.list() : []
      const json = JSON.stringify(checked)
      const purgeEpoch = purgeEpochOf(snapshot) + 1
      await store.write({
        document: json, backup: null, proposals: null, unsavedBaseline: null,
        purge: { legacyKeys: true, calendarSourceIds }, purgeEpoch,
      })
      this.identity = identityOf(json)
      this.loadedPurgeEpoch = purgeEpoch
      // Still inside the same lock hold: requesting the lock again here would wait for itself forever.
      await this.purgeWhileLocked().catch((error) => console.warn('next168: purge resumes on the next load', error))
      return { kind: 'ok', revision: checked.revision }
    })
  }

  // Finishes a recorded purge. Without Web Locks it stays pending: nothing is written without the lock.
  async finishPurge(): Promise<void> {
    const { runExclusive } = this.deps
    if (!runExclusive) return
    await runExclusive(() => this.purgeWhileLocked())
  }

  // Idempotent, so an interruption at any step is finished by the next load. Callers hold the commit lock.
  private async purgeWhileLocked(): Promise<void> {
    const { store, legacy, calendarTexts } = this.deps
    const snapshot = await store.read(['document', 'purge'])
    const purge = purgeRecord(snapshot.purge)
    if (!purge) return
    for (const key of LEGACY_KEYS) if (legacy.getItem(key) !== null) legacy.removeItem(key)
    if (purge.calendarSourceIds.length === 0) return
    const current = storedDocument(snapshot.document)
    const referenced = new Set(current.kind === 'ok' ? current.document.calendarSources.map((source) => source.id) : [])
    for (const id of purge.calendarSourceIds) if (!referenced.has(id)) await calendarTexts?.delete(id)
    await store.write({ purge: { legacyKeys: true, calendarSourceIds: [] } })
  }

  private purgePending(snapshot: Snapshot): boolean {
    const purge = purgeRecord(snapshot.purge)
    if (!purge) return false
    return purge.calendarSourceIds.length > 0 || LEGACY_KEYS.some((key) => this.deps.legacy.getItem(key) !== null)
  }

  private async importOnce(): Promise<LoadResult> {
    const { store } = this.deps
    const snapshot = await store.read(['document', 'migration', 'purgeEpoch', 'unsavedBaseline'])
    if (snapshot.document !== undefined) {
      this.identity = identityOf(snapshot.document)
      return parseDocument(snapshot.document)
    }
    if (snapshot.migration !== undefined) return { kind: 'corrupt', raw: '', reason: STORED_DOCUMENT_MISSING }
    const plan = planLegacyImport(this.deps.legacy, this.importEnvironment())
    if (plan.kind === 'none') return this.emptyResult(snapshot)
    if (plan.records) {
      await store.write({ ...plan.records, migration: { source: plan.source, at: this.deps.now().toISOString() } })
      this.identity = identityOf(plan.records.document)
    }
    return plan.result
  }

  // Nothing stored: the unsaved planner proposals were made against, if any, so every tab and reload shows that one.
  private emptyResult(snapshot: Snapshot): LoadResult {
    this.identity = identityOf(undefined)
    const unsaved = currentUnsavedBaseline(snapshot)
    return unsaved ? { kind: 'empty', document: unsaved.document } : { kind: 'empty' }
  }

  private async commitDocument(document: PlannerDocument, expectedRevision: number, guard: CommitGuard = {}): Promise<SaveResult> {
    let checked: PlannerDocument
    try {
      checked = validateDocument(document)
    } catch {
      return { kind: 'error', reason: 'invalid-document' }
    }
    return this.exclusiveWrite(async () => {
      const { store } = this.deps
      const snapshot = await store.read(['document', 'purgeEpoch'])
      const stored = storedDocument(snapshot.document)
      const refused = this.refuseStale(stored, expectedRevision)
      if (refused) return refused
      const currentRevision = stored.kind === 'ok' ? stored.document.revision : 0
      if (guard.purgeEpoch !== undefined && purgeEpochOf(snapshot) !== guard.purgeEpoch) return { kind: 'conflict', currentRevision }
      if (guard.storedFingerprint !== undefined && (await storedFingerprintOf(snapshot.document)) !== guard.storedFingerprint) {
        return { kind: 'conflict', currentRevision }
      }
      const json = JSON.stringify(checked)
      // The first stored planner replaces the unsaved one proposals were made against: those proposals are stale now.
      await store.write(snapshot.document === undefined ? { document: json, unsavedBaseline: null } : { document: json, backup: snapshot.document })
      this.identity = identityOf(json)
      return { kind: 'ok', revision: checked.revision }
    })
  }

  private refuseStale(stored: StoredDocument, expectedRevision: number): SaveResult | undefined {
    if (stored.kind === 'corrupt' || stored.kind === 'unsupported') return { kind: 'error', reason: 'stored-document-unreadable' }
    const currentRevision = stored.kind === 'ok' ? stored.document.revision : 0
    return currentRevision === expectedRevision ? undefined : { kind: 'conflict', currentRevision }
  }

  // Runs a read-modify-write under the commit lock. A committed write notifies other tabs; a failed
  // notification never turns a committed change into an error.
  private async exclusiveWrite(task: () => Promise<SaveResult>): Promise<SaveResult> {
    const { runExclusive } = this.deps
    if (!runExclusive) return { kind: 'error', reason: NO_WEB_LOCKS }
    let result: SaveResult
    try {
      result = await runExclusive(task)
    } catch (error) {
      return { kind: 'error', reason: failureReason(error) }
    }
    if (result.kind === 'ok') {
      try { this.deps.channel.notify() } catch { /* The focus re-check and the CAS cover a lost notification. */ }
    }
    return result
  }

  private importEnvironment() {
    return { now: this.deps.now(), locale: this.deps.locale(), timeZone: this.deps.timeZone(), idGen: this.deps.newId }
  }
}
