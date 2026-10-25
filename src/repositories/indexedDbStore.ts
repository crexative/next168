// The browser planner store: one IndexedDB database, `next168`, with one object store per kind of record.
// Every call opens the database, runs exactly one transaction and closes the connection, so a connection the
// browser drops in the background is never reused. Writes are one `strict` transaction: all of a change
// commits, or none of it does.

export type StoredPart = 'document' | 'backup' | 'proposals' | 'migration' | 'purge' | 'purgeEpoch' | 'unsavedBaseline'

export interface Snapshot {
  document?: string
  backup?: string
  proposals?: string
  migration?: unknown
  purge?: unknown
  purgeEpoch?: unknown
  unsavedBaseline?: unknown
}

// `null` deletes the record; an absent member leaves it as it is.
export interface Change {
  document?: string | null
  backup?: string | null
  proposals?: string | null
  migration?: object | null
  purge?: object | null
  purgeEpoch?: number
  unsavedBaseline?: object | null
}

export interface BrowserStore {
  read(parts: readonly StoredPart[]): Promise<Snapshot>
  write(change: Change): Promise<void>
}

export const DATABASE_NAME = 'next168'
const OBJECT_STORES = ['document', 'backup', 'proposals', 'meta'] as const
const LOCATION: Record<StoredPart, readonly [store: (typeof OBJECT_STORES)[number], key: string]> = {
  document: ['document', 'current'],
  backup: ['backup', 'current'],
  proposals: ['proposals', 'all'],
  migration: ['meta', 'migration'],
  purge: ['meta', 'purge'],
  purgeEpoch: ['meta', 'purgeEpoch'],
  unsavedBaseline: ['meta', 'unsavedBaseline'],
}

function storesOf(parts: readonly StoredPart[]): string[] {
  return [...new Set(parts.map((part) => LOCATION[part][0]))]
}

export function changedParts(change: Change): StoredPart[] {
  return (Object.keys(change) as StoredPart[]).filter((part) => change[part] !== undefined)
}

export class IndexedDbStore implements BrowserStore {
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

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
    if (parts.length === 0) return
    const db = await this.open()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storesOf(parts), 'readwrite', { durability: 'strict' })
        // The first request error is the cause; `transaction.error` can still be null when an asynchronous
        // request failure aborts the transaction, so the promise rejects only from `onabort`.
        let cause: unknown
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(cause ?? transaction.error ?? new DOMException('write aborted', 'AbortError'))
        try {
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
    const factory = this.factory
    if (!factory) return Promise.reject(new DOMException('indexedDB missing', 'UnknownError'))
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        for (const name of OBJECT_STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new DOMException('open failed', 'UnknownError'))
      request.onblocked = () => reject(new DOMException('open blocked', 'UnknownError'))
    })
  }
}
