import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBDatabase, IDBFactory, IDBObjectStore, IDBTransaction } from 'fake-indexeddb'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { IndexedDbStore, type BrowserStore, type StoredPart } from './indexedDbStore'
import { failureReason } from './storageCommit'
import { MemoryStore } from './testSupport'

afterEach(() => { vi.restoreAllMocks() })

const ALL: StoredPart[] = ['document', 'backup', 'proposals', 'migration', 'purge', 'purgeEpoch']

function readwriteSpies() {
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
  const commit = vi.spyOn(IDBTransaction.prototype, 'commit')
  const readwrite = () => transaction.mock.calls.filter(([, mode]) => mode === 'readwrite')
  return { transaction, commit, readwrite }
}

describe('IndexedDbStore: strict, committed transactions (A3)', () => {
  it('writes in one readwrite transaction with strict durability and an explicit commit', async () => {
    const { commit, readwrite } = readwriteSpies()
    const store = new IndexedDbStore(new IDBFactory())
    await store.write({ document: 'doc', backup: 'old', proposals: '[]', migration: { source: 'v2' } })
    expect(readwrite()).toHaveLength(1)
    expect(readwrite()[0]![2]).toEqual({ durability: 'strict' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await store.read(['document', 'backup', 'proposals', 'migration'])).toEqual({ document: 'doc', backup: 'old', proposals: '[]', migration: { source: 'v2' } })
  })

  it('resolves a write only after the transaction completed, not when its requests succeeded', async () => {
    const events: string[] = []
    const transaction = IDBDatabase.prototype.transaction
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const created = transaction.apply(this, args)
      if (args[1] === 'readwrite') created.addEventListener('complete', () => events.push('complete'))
      return created
    })
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args)
      request.addEventListener('success', () => events.push('request-success'))
      return request
    })
    const store = new IndexedDbStore(new IDBFactory())
    await store.write({ document: 'doc' }).then(() => events.push('resolved'))
    expect(events).toEqual(['request-success', 'complete', 'resolved'])
  })

  it('calendar text writes are strict and committed too', async () => {
    const { commit, readwrite } = readwriteSpies()
    const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
    await texts.put('source', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
    await texts.delete('source')
    expect(readwrite()).toHaveLength(2)
    for (const call of readwrite()) expect(call[2]).toEqual({ durability: 'strict' })
    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('null deletes a record and a missing database reads empty', async () => {
    const store = new IndexedDbStore(new IDBFactory())
    expect(await store.read(ALL)).toEqual({})
    await store.write({ document: 'doc', backup: 'b' })
    await store.write({ backup: null })
    expect(await store.read(['document', 'backup'])).toEqual({ document: 'doc' })
  })

  it('rejects with UnknownError when IndexedDB is missing', async () => {
    await expect(new IndexedDbStore(undefined).read(['document'])).rejects.toMatchObject({ name: 'UnknownError' })
  })
})

type Case = { name: string; create: () => BrowserStore; failSecondPut: (store: BrowserStore) => void }
const cases: Case[] = [
  {
    name: 'IndexedDbStore',
    create: () => new IndexedDbStore(new IDBFactory()),
    failSecondPut: () => {
      const put = IDBObjectStore.prototype.put
      let calls = 0
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (++calls === 2) throw new DOMException('q', 'QuotaExceededError')
        return put.apply(this, args)
      })
    },
  },
  {
    name: 'MemoryStore',
    create: () => new MemoryStore(),
    failSecondPut: (store) => { (store as MemoryStore).failWritesTo.add('backup') },
  },
]

describe.each(cases)('$name: atomic writes and error propagation (A4)', ({ create, failSecondPut }) => {
  it('a synchronous failure on the second store rejects with its cause and changes nothing', async () => {
    const store = create()
    await store.write({ document: 'v1', backup: 'v0', proposals: '[1]' })
    const before = await store.read(ALL)
    failSecondPut(store)
    const failure = await store.write({ document: 'v2', backup: 'v1', proposals: '[2]' }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'QuotaExceededError' })
    expect(failureReason(failure)).toBe('quota-exceeded')
    vi.restoreAllMocks()
    expect(await store.read(ALL)).toEqual(before)
  })
})

describe('IndexedDbStore: asynchronous abort keeps the cause (A4b)', () => {
  it('rejects with ConstraintError, not null or a generic error, and nothing changed', async () => {
    const store = new IndexedDbStore(new IDBFactory())
    await store.write({ document: 'v1', backup: 'v0' })
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      return this.add(value, key)
    })
    const failure = await store.write({ document: 'v2', backup: 'v1' }).catch((error: unknown) => error)
    expect(failure).not.toBeNull()
    expect((failure as DOMException).name).toBe('ConstraintError')
    expect(failureReason(failure)).toBe('storage-failed:ConstraintError')
    vi.restoreAllMocks()
    expect(await store.read(['document', 'backup'])).toEqual({ document: 'v1', backup: 'v0' })
  })
})
