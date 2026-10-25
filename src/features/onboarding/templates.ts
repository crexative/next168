import type { Category } from '@/core/model'

export const SLEEP_ICON = '😴'

// The one rule behind every "default category for a task": the first category that is not Sleep.
export function firstNonSleep<T>(items: T[], isSleep: (item: T) => boolean): T | undefined {
  return items.find((item) => !isSleep(item))
}

// A stored category is Sleep when it keeps the Sleep icon or is named Sleep (names are editable, icons rarely).
export function isSleepCategory(category: Pick<Category, 'name' | 'icon'>): boolean {
  return category.icon === SLEEP_ICON || category.name.trim().toLowerCase() === 'sleep'
}

// The task form's category: an existing choice is kept; otherwise the first non-Sleep category, and Sleep only when it is all there is.
export function defaultTaskCategoryId(categories: Category[], current: string): string {
  if (categories.some((category) => category.id === current)) return current
  return (firstNonSleep(categories, isSleepCategory) ?? categories[0])?.id ?? ''
}
