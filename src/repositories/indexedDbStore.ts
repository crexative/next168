// The browser planner store: one IndexedDB database, `next168`, with one object store per kind of record.
// Every call opens the database through the storage fence, runs exactly one transaction and closes the connection, so a
// connection the browser drops in the background is never reused. Writes are one `strict` transaction: all of a change
// commits, or none of it does.
import { fenceFor, PLANNER_DATABASE, PRE_UPGRADE_COPY_KEY, SNAPSHOTS_STORE, type StorageFence } from './storageVersion'

export type StoredPart = 'document' | 'backup' | 'proposals' | 'migration' | 'purge' | 'purgeEpoch' | 'unsavedBaseline' | 'preUpgradeCopy'

export interface Snapshot {
  document?: string
  backup?: string
  proposals?: string
  migration?: unknown
  purge?: unknown
  purgeEpoch?: unknown
  unsavedBaseline?: unknown
  preUpgradeCopy?: unknown
}

// Stores a change may empty entirely, in the same transaction (delete-all clears the snapshots).
export type ClearableStore = typeof SNAPSHOTS_STORE

// `null` deletes the record; an absent member leaves it as it is.
export interface Change {
  document?: string | null
  backup?: string | null
  proposals?: string | null
  migration?: object | null
  purge?: object | null
  purgeEpoch?: number
  unsavedBaseline?: object | null
  // Written only by the fence's first upgrade; erased with `clearStores`.
  preUpgradeCopy?: never
  clearStores?: readonly ClearableStore[]
}

export interface BrowserStore {
  read(parts: readonly StoredPart[]): Promise<Snapshot>
  write(change: Change): Promise<void>
}

export const DATABASE_NAME = PLANNER_DATABASE
type ObjectStore = 'document' | 'backup' | 'proposals' | 'meta' | ClearableStore
export const LOCATION: Record<StoredPart, readonly [store: ObjectStore, key: string]> = {
  document: ['document', 'current'],
  backup: ['backup', 'current'],
  proposals: ['proposals', 'all'],
  migration: ['meta', 'migration'],
  purge: ['meta', 'purge'],
  purgeEpoch: ['meta', 'purgeEpoch'],
  unsavedBaseline: ['meta', 'unsavedBaseline'],
  preUpgradeCopy: [SNAPSHOTS_STORE, PRE_UPGRADE_COPY_KEY],
}

function storesOf(parts: readonly StoredPart[]): string[] {
  return [...new Set(parts.map((part) => LOCATION[part][0]))]
}

export function changedParts(change: Change): StoredPart[] {
  return (Object.keys(change) as StoredPart[]).filter((part) => part in LOCATION && change[part] !== undefined)
}

export class IndexedDbStore implements BrowserStore {
  private readonly fence: StorageFence

  constructor(factory: IDBFactory | undefined = globalThis.indexedDB, fence?: StorageFence) {
    this.fence = fence ?? fenceFor(factory)
  }

  async read(parts: readonly StoredPart[]): Promise<Snapshot> {
    const db = await this.open()
    try {
      return await new Promise<Snapshot>((resolve, reject) => {
        const transaction = db.transaction(storesOf(parts), 'readonly')
        const snapshot: Record<string, unknown> = {}
        for (const part of parts) {
          const [store, key] = LOCATION[part]
          const request = transaction.objectStore(store).get(key)
          request.onsuccess = () => { if (request.result !== undefined) snapshot[part] = request.result }
        }
        transaction.oncomplete = () => resolve(snapshot as Snapshot)
        transaction.onabort = () => reject(transaction.error ?? new DOMException('read aborted', 'AbortError'))
      })
    } finally {
      db.close()
    }
  }

  async write(change: Change): Promise<void> {
    const parts = changedParts(change)
    const cleared = change.clearStores ?? []
    if (parts.length === 0 && cleared.length === 0) return
    const db = await this.open()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([...new Set([...storesOf(parts), ...cleared])], 'readwrite', { durability: 'strict' })
        // The first request error is the cause; `transaction.error` can still be null when an asynchronous
        // request failure aborts the transaction, so the promise rejects only from `onabort`.
        let cause: unknown
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(cause ?? transaction.error ?? new DOMException('write aborted', 'AbortError'))
        try {
          for (const store of cleared) {
            const request = transaction.objectStore(store).clear()
            request.onerror = () => { cause ??= request.error }
          }
          for (const part of parts) {
            const [store, key] = LOCATION[part]
            const value = change[part]
            const request = value === null ? transaction.objectStore(store).delete(key) : transaction.objectStore(store).put(value, key)
            request.onerror = () => { cause ??= request.error }
          }
          transaction.commit?.()
        } catch (error) {
          cause ??= error
          try { transaction.abort() } catch { /* Already finished: onabort has fired or will. */ }
        }
      })
    } finally {
      db.close()
    }
  }

  private open(): Promise<IDBDatabase> {
    return this.fence.open(PLANNER_DATABASE)
  }
}
