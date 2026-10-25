import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbStore, type BrowserStore } from './indexedDbStore'
import { documentFingerprint } from './storageCommit'
import {
  createTestRepositories, MemoryChannelBus, MemoryStorage, MemoryStore, mutexRunner, testDocument, KEYS,
} from './testSupport'

// The guarded write: storage must still hold exactly what a flow opened on, checked inside the commit lock.
const storeCases: { name: string; create: () => BrowserStore }[] = [
  { name: 'MemoryStore', create: () => new MemoryStore() },
  { name: 'IndexedDbStore', create: () => new IndexedDbStore(new IDBFactory()) },
]

describe.each(storeCases)('guarded commit on $name', ({ create }) => {
  // Two tabs: one store, one lock, one bus, separate repositories.
  function tabs() {
    const store = create()
    const legacy = new MemoryStorage()
    const runExclusive = mutexRunner()
    const bus = new MemoryChannelBus()
    const make = () => createTestRepositories({ store, legacy, runExclusive, bus }).planner
    return { store, legacy, a: make(), b: make() }
  }
  const stored = async (store: BrowserStore) => (await store.read(['document'])).document
  const next = (document: ReturnType<typeof testDocument>) => ({ ...document, revision: document.revision + 1 })

  it('proven-empty storage that a migration filled with revision 0 refuses the save and keeps the migrated document', async () => {
    const { a, b, store, legacy } = tabs()
    expect(await a.load()).toMatchObject({ kind: 'empty', document: { revision: 0 } })
    // Tab B imports an older build's data after A's empty load: revision 0, with content.
    const migrated = testDocument({ categories: [{ id: 'c-old', name: 'Old', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }] })
    legacy.data.set(KEYS.document, JSON.stringify(migrated))
    await b.load()
    const before = await stored(store)
    expect(before).toBeDefined()
    // Revision alone (0 = 0) would let A overwrite it.
    expect(await a.saveGuarded(next(testDocument()), 0, { storedFingerprint: 'absent' })).toEqual({ kind: 'conflict', currentRevision: 0 })
    expect(await stored(store)).toBe(before)
  })

  it('refuses different content stored at the same revision, and keeps it', async () => {
    const { a, b, store } = tabs()
    const opened = testDocument({ revision: 3 })
    await store.write({ document: JSON.stringify(opened) })
    const fingerprint = await documentFingerprint(opened)
    // Tab B replaces the workspace content without moving the revision (an import or restore does).
    const replaced = testDocument({ revision: 3, categories: [{ id: 'c-b', name: 'From B', colorKey: 'red', goal: { type: 'none', hoursPerWeek: 0 } }] })
    await store.write({ document: JSON.stringify(replaced) })
    const before = await stored(store)
    expect(await a.saveGuarded(next(opened), 3, { storedFingerprint: fingerprint })).toEqual({ kind: 'conflict', currentRevision: 3 })
    expect(await stored(store)).toBe(before)
    expect(b).toBeDefined()
  })

  it('refuses when a delete-all ran since the epoch was read, even when the revision matches', async () => {
    const { a, b, store } = tabs()
    await store.write({ document: JSON.stringify(testDocument({ revision: 2 })) })
    await a.load()
    const epoch = a.knownPurgeEpoch()!
    await b.load()
    const fresh = testDocument({ revision: 3 })
    expect(await b.deleteAll(fresh, 2)).toMatchObject({ kind: 'ok' })
    const before = await stored(store)
    expect(await a.saveGuarded(next(fresh), 3, { purgeEpoch: epoch })).toEqual({ kind: 'conflict', currentRevision: 3 })
    expect(await stored(store)).toBe(before)
    // The same call with the current epoch is accepted: the epoch check, not the revision, was what refused it.
    expect(await b.saveGuarded(next(fresh), 3, { purgeEpoch: epoch + 1 })).toMatchObject({ kind: 'ok' })
  })

  it('refuses after a backup restore replaced the document with other content at the same revision', async () => {
    const { a, store } = tabs()
    const opened = testDocument({ revision: 2 })
    const backup = testDocument({ revision: 2, categories: [{ id: 'c-bk', name: 'Backup', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }] })
    await store.write({ document: JSON.stringify(opened), backup: JSON.stringify(backup) })
    const fingerprint = await documentFingerprint(opened)
    await store.write({ document: 'garbage' })
    expect(await a.restoreBackup()).toMatchObject({ kind: 'ok' })
    const before = await stored(store)
    expect(await a.saveGuarded(next(opened), 2, { storedFingerprint: fingerprint })).toEqual({ kind: 'conflict', currentRevision: 2 })
    expect(await stored(store)).toBe(before)
  })

  it('accepts a matching expectation in one transaction that keeps the previous document as the backup', async () => {
    const { a, store } = tabs()
    const opened = testDocument({ revision: 5 })
    await store.write({ document: JSON.stringify(opened) })
    const writes = vi.spyOn(store, 'write')
    const candidate = next(opened)
    expect(await a.saveGuarded(candidate, 5, { storedFingerprint: await documentFingerprint(opened), purgeEpoch: 0 })).toEqual({ kind: 'ok', revision: 6 })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(await store.read(['document', 'backup'])).toEqual({ document: JSON.stringify(candidate), backup: JSON.stringify(opened) })
  })

  it('accepts "absent" while storage is still empty, and writes the first document', async () => {
    const { a, store } = tabs()
    expect(await a.saveGuarded(next(testDocument()), 0, { storedFingerprint: 'absent' })).toMatchObject({ kind: 'ok' })
    expect(await stored(store)).toBeDefined()
  })

  it('saveAtEpoch and save keep their meaning (they share the same commit function)', async () => {
    const { a, store } = tabs()
    await store.write({ document: JSON.stringify(testDocument({ revision: 1 })) })
    await a.load()
    expect(await a.saveAtEpoch(testDocument({ revision: 2 }), 1, a.knownPurgeEpoch()!)).toMatchObject({ kind: 'ok' })
    expect(await a.saveAtEpoch(testDocument({ revision: 3 }), 2, 99)).toMatchObject({ kind: 'conflict' })
    expect(await a.save(testDocument({ revision: 3 }), 2)).toMatchObject({ kind: 'ok' })
  })
})
