import { STORAGE_KEYS, type LoadResult, type PlannerDocument } from '@/core/model'
import { parseDocument } from './core'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type RunExclusive = <T>(task: () => Promise<T>) => Promise<T>

export type StoredDocument = LoadResult | { kind: 'absent' }

export function webLockRunner(locks: LockManager | undefined): RunExclusive | undefined {
  if (!locks) return undefined
  return <T>(task: () => Promise<T>) => locks.request(STORAGE_KEYS.lockName, { mode: 'exclusive' }, task) as Promise<T>
}

export function readStoredDocument(storage: StorageLike): StoredDocument {
  const raw = storage.getItem(STORAGE_KEYS.document)
  if (raw === null) return { kind: 'absent' }
  return parseDocument(raw)
}

export function isValidDocumentText(text: string | null): boolean {
  return parseDocument(text).kind === 'ok'
}

// Backup of the previous bytes first, then the new document. Each setItem is atomic, so a failure in
// either step leaves the primary key holding the previous document.
export function writeWithBackup(storage: StorageLike, document: PlannerDocument): void {
  const previous = storage.getItem(STORAGE_KEYS.document)
  if (previous !== null) storage.setItem(STORAGE_KEYS.backup, previous)
  storage.setItem(STORAGE_KEYS.document, JSON.stringify(document))
}

export function failureReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'quota-exceeded'
  return error instanceof Error && error.message ? error.message : 'storage-failure'
}
