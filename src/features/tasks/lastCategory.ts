// The "when" the last task was filed under (a category id, or '' for any free slot), so adding the next one is typing and Enter.
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
    // Not remembering is harmless: the form falls back to any free slot.
  }
}
