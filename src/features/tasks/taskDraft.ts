import { MAX_FIXED_MIN, MAX_TASK_MIN, MIN_TASK_MIN, type Category, type Task } from '@/core/model'
import { localDateOf } from '@/core/time'
import { isSleepCategory } from '@/features/onboarding/templates'

// "" is the stored-nothing choice: the task has no category and fits any free time.
export const ANY_FREE_TIME = ''

export type TaskPriority = '1' | '2' | '3'

export interface TaskDraft {
  title: string
  // No duration is a to-do ("Sin tiempo", the default): it is never placed in the week.
  durationMin: number | undefined
  categoryId: string
  dueDate: string
  // "Today" was chosen: the task is due on the planner's date when it is saved, whatever date the form showed.
  dueToday: boolean
  // A one-off fixed start, "HH:MM" on the due date (today when no date is set), or ''.
  at: string
  notes: string
  priority: TaskPriority
}

export const DURATION_CHIPS = [15, 30, 60, 120] as const
// The duration control's value for a to-do.
export const UNTIMED = 'none'
export { MIN_TASK_MIN, MAX_TASK_MIN, MAX_FIXED_MIN }
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
export function durationChoices(current: number | undefined): number[] {
  return [...new Set<number>([...DURATION_CHIPS, ...(current === undefined ? [] : [current])])].sort((a, b) => a - b)
}

export function newDraft(categoryId = ANY_FREE_TIME): TaskDraft {
  return { title: '', durationMin: undefined, categoryId, dueDate: '', dueToday: false, at: '', notes: '', priority: DEFAULT_PRIORITY }
}

export function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function minuteOf(clock: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(clock)
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    durationMin: task.durationMin,
    categoryId: task.categoryId ?? ANY_FREE_TIME,
    dueDate: task.dueDate ?? '',
    dueToday: false,
    at: task.at === undefined ? '' : clockText(task.at),
    notes: task.notes ?? '',
    priority: String(task.priority) as TaskPriority,
  }
}

export type DraftFields = Pick<Task, 'title' | 'priority'> & Partial<Pick<Task, 'categoryId' | 'dueDate' | 'durationMin' | 'at' | 'notes'>>

// The fields a draft decides; the id, creation time and completion stay with the stored task. `today` is the planner's
// date at the moment of saving: a draft set to "Today" before midnight and saved after it is due the new day. A fixed
// start without a date is today's.
export function taskFields(draft: TaskDraft, today: string): DraftFields {
  const at = minuteOf(draft.at)
  const dueDate = draft.dueToday ? today : draft.dueDate || (at !== undefined ? today : '')
  return {
    title: draft.title.trim(),
    priority: Number(draft.priority) as Task['priority'],
    ...(draft.durationMin !== undefined ? { durationMin: draft.durationMin } : {}),
    ...(draft.categoryId !== ANY_FREE_TIME ? { categoryId: draft.categoryId } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(at !== undefined ? { at } : {}),
    ...(draft.notes.trim() !== '' ? { notes: draft.notes } : {}),
  }
}

// Why a draft cannot be saved, if it cannot: a fixed start holds at most MAX_FIXED_MIN.
export function draftProblem(draft: TaskDraft): 'fixedTooLong' | undefined {
  return draft.at !== '' && draft.durationMin !== undefined && draft.durationMin > MAX_FIXED_MIN ? 'fixedTooLong' : undefined
}

// Optional details a person already set: the "More options" start open so nothing chosen earlier is hidden.
export function hasExtraOptions(draft: TaskDraft): boolean {
  return draft.categoryId !== ANY_FREE_TIME || draft.dueDate !== '' || draft.priority !== DEFAULT_PRIORITY || draft.at !== '' || draft.notes !== ''
    || (draft.durationMin !== undefined && !(DURATION_CHIPS as readonly number[]).includes(draft.durationMin))
}
