import type { CalendarSourceStore } from '@/core/model'
import { CalendarImportError, MAX_ICS_BYTES } from '@/core/icsImport'

export class IndexedDbCalendarSourceStore implements CalendarSourceStore {
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    if (!this.factory) throw new CalendarImportError('storage')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory!.open('next168-calendars', 1)
      request.onupgradeneeded = () => { request.result.createObjectStore('sources') }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new CalendarImportError('storage'))
      request.onblocked = () => reject(new CalendarImportError('storage'))
    })
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('sources', mode)
        const request = operation(transaction.objectStore('sources'))
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
