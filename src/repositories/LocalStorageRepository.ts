import {
  STORAGE_KEYS, type LoadResult, type PlannerDocument, type PlannerRepository, type SaveResult,
} from '@/core/model'
import { migrateToCurrent, parseDocument, validateDocument } from './core'
import {
  failureReason, isValidDocumentText, readStoredDocument, writeWithBackup,
  type RunExclusive, type StorageLike,
} from './storageCommit'

export interface LocalStorageRepositoryDeps {
  storage: StorageLike
  runExclusive: RunExclusive | undefined
  events: EventTarget
  now: () => Date
  newId: () => string
  locale: () => string
  timeZone: () => string
}

export const NO_WEB_LOCKS = 'no-web-locks'

export class LocalStorageRepository implements PlannerRepository {
  constructor(private readonly deps: LocalStorageRepositoryDeps) {}

  get writable(): boolean {
    return this.deps.runExclusive !== undefined
  }

  async load(): Promise<LoadResult> {
    const stored = readStoredDocument(this.deps.storage)
    if (stored.kind !== 'absent') return stored
    if (this.deps.storage.getItem(STORAGE_KEYS.legacyV1) === null) return { kind: 'empty' }
    const { runExclusive } = this.deps
    return runExclusive ? runExclusive(async () => this.migrateLegacy()) : this.migrateLegacy()
  }

  async save(document: PlannerDocument, expectedRevision: number): Promise<SaveResult> {
    const { runExclusive, storage } = this.deps
    if (!runExclusive) return { kind: 'error', reason: NO_WEB_LOCKS }
    let checked: PlannerDocument
    try {
      checked = validateDocument(document)
    } catch {
      return { kind: 'error', reason: 'invalid-document' }
    }
    try {
      return await runExclusive(async () => {
        const stored = readStoredDocument(storage)
        if (stored.kind === 'corrupt' || stored.kind === 'unsupported') return { kind: 'error', reason: 'stored-document-unreadable' }
        const currentRevision = stored.kind === 'ok' ? stored.document.revision : 0
        if (currentRevision !== expectedRevision) return { kind: 'conflict', currentRevision }
        writeWithBackup(storage, checked)
        return { kind: 'ok', revision: checked.revision }
      })
    } catch (error) {
      return { kind: 'error', reason: failureReason(error) }
    }
  }

  subscribe(onExternalChange: () => void): () => void {
    return this.listenToKey(STORAGE_KEYS.document, onExternalChange)
  }

  onLegacyChange(onChange: () => void): () => void {
    return this.listenToKey(STORAGE_KEYS.legacyV1, onChange)
  }

  // Replaces unreadable data with a new document. The unreadable bytes go to the backup key
  // unless the backup still holds a valid document.
  async replaceCorrupt(document: PlannerDocument): Promise<SaveResult> {
    const { runExclusive, storage } = this.deps
    if (!runExclusive) return { kind: 'error', reason: NO_WEB_LOCKS }
    try {
      return await runExclusive(async () => {
        const stored = readStoredDocument(storage)
        if (stored.kind === 'ok' || stored.kind === 'unsupported') return { kind: 'error', reason: 'data-is-not-corrupt' }
        const raw = storage.getItem(STORAGE_KEYS.document)
        if (raw !== null && !isValidDocumentText(storage.getItem(STORAGE_KEYS.backup))) storage.setItem(STORAGE_KEYS.backup, raw)
        storage.setItem(STORAGE_KEYS.document, JSON.stringify(document))
        return { kind: 'ok', revision: document.revision }
      })
    } catch (error) {
      return { kind: 'error', reason: failureReason(error) }
    }
  }

  async peekBackup(): Promise<PlannerDocument | undefined> {
    const raw = this.deps.storage.getItem(STORAGE_KEYS.backup)
    if (raw === null) return undefined
    const parsed = parseDocument(raw)
    return parsed.kind === 'ok' ? parsed.document : undefined
  }

  async restoreBackup(): Promise<SaveResult> {
    const { runExclusive, storage } = this.deps
    if (!runExclusive) return { kind: 'error', reason: NO_WEB_LOCKS }
    try {
      return await runExclusive(async () => {
        const stored = readStoredDocument(storage)
        if (stored.kind === 'ok' || stored.kind === 'unsupported') return { kind: 'error', reason: 'data-is-not-corrupt' }
        const backup = storage.getItem(STORAGE_KEYS.backup)
        const parsed = parseDocument(backup)
        if (backup === null || parsed.kind !== 'ok') return { kind: 'error', reason: 'no-valid-backup' }
        storage.setItem(STORAGE_KEYS.document, backup)
        return { kind: 'ok', revision: parsed.document.revision }
      })
    } catch (error) {
      return { kind: 'error', reason: failureReason(error) }
    }
  }

  private migrateLegacy(): LoadResult {
    const { storage } = this.deps
    const concurrent = readStoredDocument(storage)
    if (concurrent.kind !== 'absent') return concurrent
    const legacyRaw = storage.getItem(STORAGE_KEYS.legacyV1)
    if (legacyRaw === null) return { kind: 'empty' }

    const result = migrateToCurrent(legacyRaw, {
      now: this.deps.now(),
      locale: this.deps.locale(),
      timeZone: this.deps.timeZone(),
      tutorialCompleted: storage.getItem('next168-tutorial-completed') !== null,
      idGen: this.deps.newId,
    })
    if (result.kind === 'ok' && this.writable) storage.setItem(STORAGE_KEYS.document, JSON.stringify(result.document))
    return result
  }

  private listenToKey(key: string, callback: () => void): () => void {
    const listener = (event: Event) => {
      const changedKey = (event as StorageEvent).key
      if (changedKey === key || changedKey === null) callback()
    }
    this.deps.events.addEventListener('storage', listener)
    return () => this.deps.events.removeEventListener('storage', listener)
  }
}
