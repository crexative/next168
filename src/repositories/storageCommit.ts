import { STORAGE_KEYS, type LoadResult } from '@/core/model'
import { parseDocument } from './core'

// The legacy localStorage surface: read for the one-time import, cleared by delete-all, never written.
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type RunExclusive = <T>(task: () => Promise<T>) => Promise<T>

export type StoredDocument = LoadResult | { kind: 'absent' }

export const NO_WEB_LOCKS = 'no-web-locks'

export function webLockRunner(locks: LockManager | undefined): RunExclusive | undefined {
  if (!locks) return undefined
  return <T>(task: () => Promise<T>) => locks.request(STORAGE_KEYS.lockName, { mode: 'exclusive' }, task) as Promise<T>
}

export function storedDocument(raw: string | undefined): StoredDocument {
  return raw === undefined ? { kind: 'absent' } : parseDocument(raw)
}

export function isValidDocumentText(text: string | null | undefined): boolean {
  return parseDocument(text ?? null).kind === 'ok'
}

function domExceptionName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  // Test doubles and other realms subclass their own DOMException, so the prototype chain is checked by name.
  for (let prototype = Object.getPrototypeOf(error); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (prototype.constructor?.name === 'DOMException') return (error as DOMException).name
  }
  return undefined
}

export function failureReason(error: unknown): string {
  const name = domExceptionName(error)
  if (name === 'QuotaExceededError') return 'quota-exceeded'
  if (name !== undefined) return `storage-failed:${name}`
  return error instanceof Error && error.message ? error.message : 'storage-failure'
}

// Failures of the storage itself, as opposed to conflicts or refused documents: the app cannot keep editing.
export function isStorageFailure(reason: string | null | undefined): boolean {
  return reason === 'quota-exceeded' || (reason ?? '').startsWith('storage-failed')
}
