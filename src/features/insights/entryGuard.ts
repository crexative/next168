import { canonicalJson } from '@/core/canonical'
import type { PlannerDocument } from '@/core/model'

// A form is bound to the stored value of its own entry, a destructive confirmation to the whole document.
// Both are compared by content, never by revision or timestamps: imported content carries its own metadata.
export const CHANGED_ELSEWHERE = 'changed-elsewhere'

// Stable snapshot of one stored entry; `undefined` stands for an entry that does not exist (yet).
export function snapshotOf(entry: unknown): string | undefined {
  return entry === undefined ? undefined : canonicalJson(entry)
}

// Re-checked inside the queued commit: nothing is written when the entry is no longer what the form was loaded from.
export function assertEntry(current: unknown, snapshot: string | undefined): void {
  if (snapshotOf(current) !== snapshot) throw new Error(CHANGED_ELSEWHERE)
}

// Canonical form of the whole document, used as the stable fingerprint a confirmation was opened for.
export function documentHash(document: PlannerDocument | null | undefined): string | undefined {
  return document ? canonicalJson(document) : undefined
}

export function assertDocumentHash(draft: PlannerDocument, hash: string | undefined): void {
  if (hash === undefined || documentHash(draft) !== hash) throw new Error(CHANGED_ELSEWHERE)
}
