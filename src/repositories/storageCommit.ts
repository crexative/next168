import { z } from 'zod'
import { STORAGE_KEYS, type LoadResult, type PlannerDocument } from '@/core/model'
import { canonicalJson, sha256 } from '@/core/canonical'
import { parseDocument, validateDocument } from './core'
import type { Snapshot } from './indexedDbStore'

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

// What a guarded write compares: "absent" for nothing stored, otherwise the hash of the canonical document, so one
// comparison covers presence, workspace, content and a replacement that kept the same revision.
export type StoredFingerprint = 'absent' | string

export async function documentFingerprint(document: PlannerDocument): Promise<string> {
  return sha256(canonicalJson(validateDocument(document)))
}

export async function storedFingerprintOf(raw: string | undefined): Promise<StoredFingerprint | undefined> {
  if (raw === undefined) return 'absent'
  const stored = parseDocument(raw)
  return stored.kind === 'ok' ? documentFingerprint(stored.document) : undefined
}

export function purgeEpochOf(snapshot: Snapshot): number {
  return typeof snapshot.purgeEpoch === 'number' ? snapshot.purgeEpoch : 0
}

// Before the first planner write, its baseline is device state: copying a prompt, reloading and pasting the reply
// all refer to the same identity. Approving creates the planner from that baseline. It belongs to the purge epoch
// it was made in; delete-all makes it void, and the first stored write removes it.
export interface UnsavedBaseline {
  document: PlannerDocument
  purgeEpoch: number
}

const unsavedBaselineSchema = z.object({ document: z.string(), purgeEpoch: z.number().int().min(0) })

export function unsavedBaselineRecord(document: PlannerDocument, purgeEpoch: number): object {
  return { document: JSON.stringify(document), purgeEpoch }
}

// The stored unsaved document, if it is readable, never written as a planner (revision 0) and of the current epoch.
export function currentUnsavedBaseline(snapshot: Snapshot): UnsavedBaseline | undefined {
  const parsed = unsavedBaselineSchema.safeParse(snapshot.unsavedBaseline)
  if (!parsed.success || parsed.data.purgeEpoch !== purgeEpochOf(snapshot)) return undefined
  const stored = parseDocument(parsed.data.document)
  if (stored.kind !== 'ok' || stored.document.revision !== 0) return undefined
  return { document: stored.document, purgeEpoch: parsed.data.purgeEpoch }
}
