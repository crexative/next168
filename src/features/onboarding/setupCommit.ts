import type { Category, DayIndex, PlannerDocument, TimeBlock } from '@/core/model'
import { distinctColorKeys } from '@/features/insights/categoryColor'
import { removeCategory } from '@/features/settings/categories/categoryEditing'
import {
  automaticGoal, blockSlot, categoryMinutes, statusOf, validate, type CategoryDraft, type Issue, type SetupState,
} from './setupModel'
import { OWN_COLOR, TOPICS } from './setupTopics'

// What a finished setup writes: categories, blocks and settings.onboardingDone, in one commit. Records the person did not
// touch are not rewritten, tasks are never written, and a plan that changes nothing writes nothing.

export const MAX_CATEGORIES = 100
export const MAX_BLOCKS = 1000
export const SETUP_INVALID = 'setup-invalid'

export interface SetupPlan {
  newCategories: Category[]
  renames: { id: string; name: string; oldName: string }[]
  newBlocks: TimeBlock[]
  blockUpdates: { id: string; days: DayIndex[]; start: number; end: number }[]
  blockDeletes: string[]
  // A category with tasks keeps its record and loses only its blocks.
  categoryDeletes: string[]
  keptForTasks: string[]
  onboardingDone: boolean
}

export type PlanResult = { kind: 'plan'; plan: SetupPlan; empty: boolean } | { kind: 'invalid'; issues: Issue[] } | { kind: 'tooLarge' }

const sortedUnique = (days: readonly DayIndex[]) => [...new Set(days)].sort((a, b) => a - b)
const sameDays = (a: readonly DayIndex[], b: readonly DayIndex[]) => a.length === b.length && sortedUnique(a).join() === sortedUnique(b).join()

export function planSetupCommit(state: SetupState, current: PlannerDocument, newId: () => string): PlanResult {
  const storedNames = new Map(current.categories.map((category) => [category.id, category.name.trim()]))
  const issues = validate(state, storedNames)
  if (issues.length > 0) return { kind: 'invalid', issues }

  const plan: SetupPlan = { newCategories: [], renames: [], newBlocks: [], blockUpdates: [], blockDeletes: [], categoryDeletes: [], keptForTasks: [], onboardingDone: !current.settings.onboardingDone }
  const removedIds = new Set<string>()
  const stored = (category: CategoryDraft) => current.categories.find((candidate) => candidate.id === category.categoryId)
  const blocksOf = (id: string) => current.blocks.filter((block) => block.categoryId === id)
  const hasTasks = (id: string) => current.tasks.some((task) => task.categoryId === id)

  for (const category of state.categories) {
    const status = statusOf(state, category)
    const existing = stored(category)
    if (status === 'removed' && existing) {
      for (const block of blocksOf(existing.id)) plan.blockDeletes.push(block.id)
      if (hasTasks(existing.id)) plan.keptForTasks.push(existing.id)
      else { plan.categoryDeletes.push(existing.id); removedIds.add(existing.id) }
    }
  }

  const keptColors = current.categories.filter((category) => !removedIds.has(category.id)).map((category) => category.colorKey)
  const newDrafts = state.categories.filter((category) => statusOf(state, category) === 'active' && !stored(category))
  const colors = distinctColorKeys(newDrafts.map((category) => (category.topic ? TOPICS[category.topic].colorKey : OWN_COLOR)), keptColors)

  for (const category of state.categories) {
    if (statusOf(state, category) !== 'active') continue
    const existing = stored(category)
    const name = category.name.trim()
    let categoryId: string
    if (existing) {
      categoryId = existing.id
      if (name !== existing.name) {
        plan.renames.push({ id: existing.id, name, oldName: existing.name })
      }
    } else {
      categoryId = newId()
      const topic = category.topic ? TOPICS[category.topic] : undefined
      plan.newCategories.push({
        id: categoryId, name, colorKey: colors[newDrafts.indexOf(category)]!, ...(topic ? { icon: topic.icon } : {}),
        goal: automaticGoal(topic?.goal ?? 'none', categoryMinutes(state, category)),
      })
    }
    const kept = new Set<string>()
    for (const range of category.ranges) {
      const slot = blockSlot(category, range)
      const block = range.blockId === undefined ? undefined : current.blocks.find((candidate) => candidate.id === range.blockId && candidate.categoryId === categoryId)
      if (!block) {
        plan.newBlocks.push({ id: newId(), categoryId, title: name, days: sortedUnique(slot.days), start: slot.start, end: slot.end })
        continue
      }
      kept.add(block.id)
      if (!sameDays(block.days, slot.days) || block.start !== slot.start || block.end !== slot.end) {
        plan.blockUpdates.push({ id: block.id, days: sortedUnique(slot.days), start: slot.start, end: slot.end })
      }
    }
    if (existing) for (const block of blocksOf(existing.id)) if (!kept.has(block.id)) plan.blockDeletes.push(block.id)
  }

  const categoriesAfter = current.categories.length - plan.categoryDeletes.length + plan.newCategories.length
  const blocksAfter = current.blocks.length - plan.blockDeletes.length + plan.newBlocks.length
  if (categoriesAfter > MAX_CATEGORIES || blocksAfter > MAX_BLOCKS) return { kind: 'tooLarge' }

  const changes = plan.newCategories.length + plan.renames.length + plan.newBlocks.length + plan.blockUpdates.length + plan.blockDeletes.length + plan.categoryDeletes.length
  return { kind: 'plan', plan, empty: changes === 0 && !plan.onboardingDone }
}

// Mutates the commit's draft. A category that cannot be removed cleanly aborts the whole commit.
export function applySetupPlan(draft: PlannerDocument, plan: SetupPlan): void {
  for (const rename of plan.renames) {
    const category = draft.categories.find((candidate) => candidate.id === rename.id)
    if (!category) throw new Error(SETUP_INVALID)
    category.name = rename.name
    for (const block of draft.blocks) if (block.categoryId === rename.id && block.title === rename.oldName) block.title = rename.name
  }
  for (const update of plan.blockUpdates) {
    const block = draft.blocks.find((candidate) => candidate.id === update.id)
    if (!block) throw new Error(SETUP_INVALID)
    Object.assign(block, { days: update.days, start: update.start, end: update.end })
  }
  const deleted = new Set(plan.blockDeletes)
  draft.blocks = draft.blocks.filter((block) => !deleted.has(block.id))
  for (const id of plan.categoryDeletes) {
    if (removeCategory(draft, id) === null) throw new Error(SETUP_INVALID)
  }
  draft.categories.push(...plan.newCategories)
  draft.blocks.push(...plan.newBlocks)
  if (plan.onboardingDone) draft.settings.onboardingDone = true
}
