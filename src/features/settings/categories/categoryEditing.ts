import type { Category, ColorKey, Goal, PlannerDocument } from '@/core/model'

export interface CategoryUsage {
  blocks: number
  tasks: number
}

export interface CategoryForm {
  name: string
  colorKey: ColorKey
  goalType: Goal['type']
  hours: number
}

export type CategoryFormError = 'name-required' | 'hours-range'

export function categoryUsage(document: PlannerDocument, categoryId: string): CategoryUsage {
  return {
    blocks: document.blocks.filter((block) => block.categoryId === categoryId).length,
    tasks: document.tasks.filter((task) => task.categoryId === categoryId).length,
  }
}

// "2 blocks and 1 task": only the kinds that are present, each with its own plural form.
export function usageSummary(
  plural: (key: 'categories.usage.blocks' | 'categories.usage.tasks', count: number) => string,
  join: (key: 'categories.usage.and', params: { first: string; second: string }) => string,
  usage: CategoryUsage,
): string {
  const parts = [
    usage.blocks > 0 ? plural('categories.usage.blocks', usage.blocks) : '',
    usage.tasks > 0 ? plural('categories.usage.tasks', usage.tasks) : '',
  ].filter(Boolean)
  return parts.length === 2 ? join('categories.usage.and', { first: parts[0]!, second: parts[1]! }) : parts[0] ?? ''
}

export function validateCategoryForm(form: CategoryForm): CategoryFormError | null {
  if (form.name.trim() === '') return 'name-required'
  if (form.goalType !== 'none' && !(form.hours >= 0.5 && form.hours <= 168)) return 'hours-range'
  return null
}

export function goalFromForm(form: CategoryForm): Goal {
  return { type: form.goalType, hoursPerWeek: form.goalType === 'none' ? 0 : form.hours }
}

export function formFromCategory(category: Category): CategoryForm {
  return { name: category.name, colorKey: category.colorKey, goalType: category.goal.type, hours: category.goal.hoursPerWeek || 1 }
}

export interface RemovedCategory {
  category: Category
  blockIds: string[]
  taskIds: string[]
}

// Mutates a draft document: references move to `reassignTo` first so the document stays valid.
export function removeCategory(draft: PlannerDocument, categoryId: string, reassignTo?: string): RemovedCategory | null {
  const category = draft.categories.find((candidate) => candidate.id === categoryId)
  if (!category) return null
  const usage = categoryUsage(draft, categoryId)
  if (usage.blocks + usage.tasks > 0 && (!reassignTo || reassignTo === categoryId || !draft.categories.some((candidate) => candidate.id === reassignTo))) return null
  const blocks = draft.blocks.filter((block) => block.categoryId === categoryId)
  const tasks = draft.tasks.filter((task) => task.categoryId === categoryId)
  for (const item of [...blocks, ...tasks]) item.categoryId = reassignTo!
  draft.categories = draft.categories.filter((candidate) => candidate.id !== categoryId)
  return { category, blockIds: blocks.map((block) => block.id), taskIds: tasks.map((task) => task.id) }
}

export function restoreCategory(draft: PlannerDocument, removed: RemovedCategory): void {
  if (draft.categories.some((candidate) => candidate.id === removed.category.id)) return
  draft.categories.push(removed.category)
  for (const block of draft.blocks) if (removed.blockIds.includes(block.id)) block.categoryId = removed.category.id
  for (const task of draft.tasks) if (removed.taskIds.includes(task.id)) task.categoryId = removed.category.id
}
