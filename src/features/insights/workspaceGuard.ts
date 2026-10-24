import type { PlannerDocument } from '@/core/model'

// A form prepared against one workspace must never write into another one (import, delete-all, other tab).
export function assertWorkspace(draft: PlannerDocument, expected: string | undefined): void {
  if (expected === undefined || draft.workspaceId !== expected) throw new Error('workspace-changed')
}
