import type { PlannerDocument } from '@/core/model'

// What a form or confirmation was opened for. A restored backup keeps its workspaceId, so the id alone
// cannot tell two documents apart; the revision and write time pin the exact state.
export interface DocumentStamp {
  workspaceId: string
  revision: number
  updatedAt: string
}

export function stampOf(document: PlannerDocument | null | undefined): DocumentStamp | undefined {
  return document ? { workspaceId: document.workspaceId, revision: document.revision, updatedAt: document.updatedAt } : undefined
}

export function stampKey(document: PlannerDocument | null | undefined): string {
  return document ? `${document.workspaceId}#${document.revision}#${document.updatedAt}` : ''
}

// Re-checked inside the queued commit: a form or confirmation must never write into content it was not opened for.
export function assertDocument(draft: PlannerDocument, expected: DocumentStamp | undefined): void {
  if (!expected || draft.workspaceId !== expected.workspaceId || draft.revision !== expected.revision || draft.updatedAt !== expected.updatedAt) {
    throw new Error('workspace-changed')
  }
}
