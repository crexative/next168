import type { ProposalOp } from '@/core/model'
import type { ProposalChange } from '@/core/proposals'

// The review sheet reads a proposal as a few kinds of change ("7 goals · 36 routines · 3 tasks") before any detail.
export type ChangeGroupKey = 'categories' | 'goals' | 'routines' | 'tasks' | 'events'
export interface IndexedChange { index: number; change: ProposalChange }
export interface ChangeGroup { key: ChangeGroupKey; changes: IndexedChange[] }

const GROUP_OF: Record<ProposalOp['op'], ChangeGroupKey> = {
  add_category: 'categories',
  update_category_goal: 'goals',
  add_block: 'routines', update_block: 'routines', delete_block: 'routines',
  add_task: 'tasks', update_task: 'tasks', complete_task: 'tasks',
  add_event: 'events',
}
const ORDER: ChangeGroupKey[] = ['categories', 'goals', 'routines', 'tasks', 'events']

// A short proposal is shown whole; a longer one starts with every group closed, so Approve is never far away.
export const EXPANDED_UP_TO = 6

export function groupChanges(changes: readonly ProposalChange[]): ChangeGroup[] {
  const groups = new Map<ChangeGroupKey, IndexedChange[]>()
  changes.forEach((change, index) => {
    const key = GROUP_OF[change.op]
    groups.set(key, [...(groups.get(key) ?? []), { index, change }])
  })
  return ORDER.flatMap((key) => (groups.has(key) ? [{ key, changes: groups.get(key)! }] : []))
}
