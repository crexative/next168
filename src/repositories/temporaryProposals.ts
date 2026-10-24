// TODO(#3): replace with core proposals (src/core/proposals.ts `applyProposal`)
import type { ChangeProposal, PlannerDocument } from '@/core/model'

export type ApplyResult = { ok: true; document: PlannerDocument } | { ok: false; reason: string }

// Applies all operations to a copy; content only. The caller owns revision, updatedAt and appliedProposalIds.
export function applyProposal(document: PlannerDocument, proposal: ChangeProposal, newId: () => string, now: Date): ApplyResult {
  const next = structuredClone(document)
  for (const operation of proposal.ops) {
    switch (operation.op) {
      case 'add_block':
        next.blocks.push({ id: newId(), ...operation.block })
        break
      case 'update_block': {
        const block = next.blocks.find((candidate) => candidate.id === operation.id)
        if (!block) return { ok: false, reason: 'block-not-found' }
        Object.assign(block, operation.patch)
        break
      }
      case 'delete_block':
        next.blocks = next.blocks.filter((block) => block.id !== operation.id)
        break
      case 'add_task':
        next.tasks.push({ id: newId(), createdAt: now.toISOString(), ...operation.task })
        break
      case 'update_task': {
        const task = next.tasks.find((candidate) => candidate.id === operation.id)
        if (!task) return { ok: false, reason: 'task-not-found' }
        Object.assign(task, operation.patch)
        break
      }
      case 'complete_task': {
        const task = next.tasks.find((candidate) => candidate.id === operation.id)
        if (!task) return { ok: false, reason: 'task-not-found' }
        task.doneAt = now.toISOString()
        break
      }
      case 'add_event':
        next.events.push({ id: newId(), ...operation.event })
        break
      case 'update_category_goal': {
        const category = next.categories.find((candidate) => candidate.id === operation.id)
        if (!category) return { ok: false, reason: 'category-not-found' }
        category.goal = operation.goal
        break
      }
    }
  }
  return { ok: true, document: next }
}
