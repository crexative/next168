import type { Category, Task } from '@/core/model'
import { localDateOf } from '@/core/time'
import { isSleepCategory } from '@/features/onboarding/templates'

// "" is the stored-nothing choice: the task has no category and fits any free time.
export const ANY_FREE_TIME = ''

export type TaskPriority = '1' | '2' | '3'

export interface TaskDraft {
  title: string
  durationMin: number
  categoryId: string
  dueDate: string
  // "Today" was chosen: the task is due on the planner's date when it is saved, whatever date the form showed.
  dueToday: boolean
  priority: TaskPriority
}

export const DURATION_CHIPS = [15, 30, 60, 120] as const
export const DEFAULT_DURATION_MIN = 60
const DEFAULT_PRIORITY: TaskPriority = '2'
const COMMUTE_ICON = '🚌'

// A task inside the sleep block or the commute is never useful, so neither is offered under "When?".
export function isPlaceable(category: Pick<Category, 'name' | 'icon'>): boolean {
  return !isSleepCategory(category) && category.icon !== COMMUTE_ICON && category.name.trim().toLowerCase() !== 'commute'
}

// The categories a task can be filed "during"; the one a task already has stays offered so an old choice still shows.
export function whenCategories(categories: readonly Category[], current = ANY_FREE_TIME): Category[] {
  return categories.filter((category) => isPlaceable(category) || category.id === current)
}

// The remembered choice applies while it still names a category that is offered; anything else is "any free time".
export function resolveWhen(categories: readonly Category[], remembered: string): string {
  return whenCategories(categories).some((category) => category.id === remembered) ? remembered : ANY_FREE_TIME
}

// "Today" is read from the clock at the moment it is asked, in the planner's zone: a screen left open across midnight
// must not hand out the date it was opened on.
export function plannerToday(timeZone: string): string {
  return localDateOf(new Date(), timeZone)
}

// The duration chips, plus the task's own length when it is not one of them (a task of 45 min keeps showing 45 min).
export function durationChoices(current: number): number[] {
  return [...new Set<number>([...DURATION_CHIPS, current])].sort((a, b) => a - b)
}

export function newDraft(categoryId = ANY_FREE_TIME): TaskDraft {
  return { title: '', durationMin: DEFAULT_DURATION_MIN, categoryId, dueDate: '', dueToday: false, priority: DEFAULT_PRIORITY }
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    durationMin: task.durationMin,
    categoryId: task.categoryId ?? ANY_FREE_TIME,
    dueDate: task.dueDate ?? '',
    dueToday: false,
    priority: String(task.priority) as TaskPriority,
  }
}

// The fields a draft decides; the id, creation time and completion stay with the stored task. `today` is the planner's
// date at the moment of saving: a draft set to "Today" before midnight and saved after it is due the new day.
export function taskFields(draft: TaskDraft, today: string): Pick<Task, 'title' | 'durationMin' | 'priority'> & Partial<Pick<Task, 'categoryId' | 'dueDate'>> {
  const dueDate = draft.dueToday ? today : draft.dueDate
  return {
    title: draft.title.trim(),
    durationMin: draft.durationMin,
    priority: Number(draft.priority) as Task['priority'],
    ...(draft.categoryId !== ANY_FREE_TIME ? { categoryId: draft.categoryId } : {}),
    ...(dueDate ? { dueDate } : {}),
  }
}

// Optional details a person already set: the "More options" start open so nothing chosen earlier is hidden.
export function hasExtraOptions(draft: TaskDraft): boolean {
  return draft.categoryId !== ANY_FREE_TIME || draft.dueDate !== '' || draft.priority !== DEFAULT_PRIORITY
}
