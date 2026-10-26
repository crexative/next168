import type { CalendarSourceStore } from '@/core/model'
import { CalendarImportError, MAX_ICS_BYTES } from '@/core/icsImport'
import { CALENDAR_DATABASE, fenceFor, type StorageFence } from '@/repositories/storageVersion'

export class IndexedDbCalendarSourceStore implements CalendarSourceStore {
  private readonly fence: StorageFence

  constructor(factory: IDBFactory | undefined = globalThis.indexedDB, fence?: StorageFence) {
    this.fence = fence ?? fenceFor(factory)
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.fence.open(CALENDAR_DATABASE).catch(() => { throw new CalendarImportError('storage') })
    try {
      return await new Promise<T>((resolve, reject) => {
        // A readwrite transaction asks for a flushed commit, like the planner store: a browser kill after
        // `complete` must not lose the text.
        const transaction = mode === 'readwrite' ? db.transaction('sources', mode, { durability: 'strict' }) : db.transaction('sources', mode)
        const request = operation(transaction.objectStore('sources'))
        transaction.commit?.()
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = () => reject(new CalendarImportError('storage'))
        transaction.onerror = () => reject(new CalendarImportError('storage'))
      })
    } finally { db.close() }
  }

  get(sourceId: string): Promise<string | undefined> { return this.transaction('readonly', store => store.get(sourceId)) }
  async put(sourceId: string, text: string): Promise<void> {
    if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) throw new CalendarImportError('size')
    await this.transaction('readwrite', store => store.put(text, sourceId))
  }
  async delete(sourceId: string): Promise<void> { await this.transaction('readwrite', store => store.delete(sourceId)) }
  async list(): Promise<string[]> { return (await this.transaction('readonly', store => store.getAllKeys())).map(String) }
}
