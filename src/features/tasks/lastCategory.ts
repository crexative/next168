// The category the person last picked for a task. It is only offered as a one-tap suggestion for the next task, never
// applied by itself: a new task fits any free slot unless the person picks a category.
export const LAST_TASK_CATEGORY_KEY = 'next168-last-task-category'

export function readLastTaskCategory(storage: Pick<Storage, 'getItem'> = window.localStorage): string {
  try {
    return storage.getItem(LAST_TASK_CATEGORY_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberTaskCategory(categoryId: string, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  try {
    storage.setItem(LAST_TASK_CATEGORY_KEY, categoryId)
  } catch {
    // Not remembering is harmless: there is simply no suggestion.
  }
}
