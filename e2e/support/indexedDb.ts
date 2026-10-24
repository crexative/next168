import type { Page } from '@playwright/test'

export type PlannerRecord = 'document' | 'backup' | 'proposals'
const KEYS: Record<PlannerRecord, string> = { document: 'current', backup: 'current', proposals: 'all' }

// Reads one record of the app's `next168` IndexedDB database, or null. It never creates the database:
// opening a missing one without a version would create it empty and break the app's own upgrade.
export async function storedRecord(page: Page, store: PlannerRecord): Promise<string | null> {
  return page.evaluate(async ([name, key]) => {
    const databases = await indexedDB.databases()
    if (!databases.some((database) => database.name === 'next168')) return null
    return new Promise<string | null>((resolve, reject) => {
      const request = indexedDB.open('next168')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const read = db.transaction(name!, 'readonly').objectStore(name!).get(key!)
        read.onsuccess = () => { db.close(); resolve((read.result as string | undefined) ?? null) }
        read.onerror = () => { db.close(); reject(read.error) }
      }
    })
  }, [store, KEYS[store]] as const)
}

// The default type is JSON.parse's own, so specs can read any field of the stored document.
export async function storedPlanner<T = ReturnType<typeof JSON.parse>>(page: Page): Promise<T> {
  const raw = await storedRecord(page, 'document')
  if (raw === null) throw new Error('no planner document stored in IndexedDB')
  return JSON.parse(raw) as T
}

export async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name ?? ''))
}
