import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { configurePlannerStore, usePlannerStore } from './plannerStore'
import { createTestRepositories, fixedNow, KEYS, MemoryStorage, newTestId, testDocument } from '@/repositories/testSupport'

function setup(storage = new MemoryStorage(), withLocks = true) {
  const repos = createTestRepositories(storage, withLocks)
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  setActivePinia(createPinia())
  return { ...repos, store: usePlannerStore() }
}

beforeEach(() => setActivePinia(createPinia()))

describe('loading', () => {
  it('starts with an empty in-memory document and does not write until the first commit', async () => {
    const { store, storage } = setup()
    await store.load()
    expect(store.status).toBe('ready')
    expect(store.document?.revision).toBe(0)
    expect(storage.data.size).toBe(0)
  })

  it('exposes corrupt data with its raw text and never changes storage', async () => {
    const storage = new MemoryStorage()
    storage.data.set(KEYS.document, 'garbage')
    const { store } = setup(storage)
    await store.load()
    expect(store.status).toBe('corrupt')
    expect(store.corruptRaw).toBe('garbage')
    expect(store.document).toBeNull()
    expect(storage.data.get(KEYS.document)).toBe('garbage')
  })

  it('opens newer schema versions as unsupported', async () => {
    const storage = new MemoryStorage()
    storage.data.set(KEYS.document, JSON.stringify({ schemaVersion: 3 }))
    const { store } = setup(storage)
    await store.load()
    expect(store.status).toBe('unsupported')
    expect(await store.commit(() => undefined)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('is read-only with an explanation when Web Locks are missing', async () => {
    const { store } = setup(new MemoryStorage(), false)
    await store.load()
    expect(store.status).toBe('readonly')
    expect(store.error).toBe('no-web-locks')
    expect(await store.commit(() => undefined)).toEqual({ ok: false, reason: 'readonly' })
  })
})

describe('commit', () => {
  it('saves, then publishes the new revision', async () => {
    const { store, storage } = setup()
    await store.load()
    expect(await store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' })).toEqual({ ok: true })
    expect(store.document?.revision).toBe(1)
    expect(store.document?.settings.timeZone).toBe('Europe/Berlin')
    expect(JSON.parse(storage.data.get(KEYS.document)!).settings.timeZone).toBe('Europe/Berlin')
  })

  it('keeps the state unchanged and exposes the error when saving fails', async () => {
    const { store, storage } = setup()
    await store.load()
    storage.failAllWrites = true
    const result = await store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' })
    expect(result).toEqual({ ok: false, reason: 'quota-exceeded' })
    expect(store.error).toBe('quota-exceeded')
    expect(store.document?.revision).toBe(0)
    expect(store.document?.settings.timeZone).toBe('UTC')
  })

  it('does not mutate the published document while the mutator runs', async () => {
    const { store } = setup()
    await store.load()
    const before = store.document
    await store.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' })
    expect(before?.settings.timeZone).toBe('UTC')
  })

  it('rejects mutations that break the schema without calling the repository', async () => {
    const { store, storage } = setup()
    await store.load()
    const result = await store.commit((draft) => { draft.settings.locale = '' })
    expect(result).toEqual({ ok: false, reason: 'invalid-document' })
    expect(storage.data.size).toBe(0)
  })

  it('rejects semantic violations without publishing or persisting the draft', async () => {
    const { store, storage } = setup()
    await store.load()
    const before = store.document
    expect(await store.commit((draft) => { draft.appliedProposalIds = ['duplicate', 'duplicate'] }))
      .toEqual({ ok: false, reason: 'invalid-document' })
    expect(store.document).toBe(before)
    expect(storage.data.size).toBe(0)
  })

  it('reports a conflict and reloads the winner after a stale commit', async () => {
    const { store, planner } = setup()
    await store.load()
    await planner.save(testDocument({ revision: 1, settings: { ...testDocument().settings, timeZone: 'Asia/Tokyo' } }), 0)
    const result = await store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' })
    expect(result).toEqual({ ok: false, reason: 'conflict' })
    expect(store.error).toBe('conflict')
    expect(store.document?.revision).toBe(1)
    expect(store.document?.settings.timeZone).toBe('Asia/Tokyo')
  })

  it('runs queued commits one after another so none builds on a stale revision', async () => {
    const { store } = setup()
    await store.load()
    const results = await Promise.all([
      store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' }),
      store.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' }),
    ])
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(store.document?.revision).toBe(2)
    await store.settled()
  })
})

describe('recovery', () => {
  it('starts fresh only on request and keeps the raw bytes in the backup', async () => {
    const storage = new MemoryStorage()
    storage.data.set(KEYS.document, 'garbage')
    const { store } = setup(storage)
    await store.load()
    expect(await store.startFresh()).toEqual({ ok: true })
    expect(store.status).toBe('ready')
    expect(storage.data.get(KEYS.backup)).toBe('garbage')
  })

  it('restores the last valid backup', async () => {
    const { store, planner, storage } = setup()
    await planner.save(testDocument({ revision: 1 }), 0)
    await planner.save(testDocument({ revision: 2 }), 1)
    storage.data.set(KEYS.document, 'garbage')
    await store.load()
    expect(store.backupAvailable).toBe(true)
    await store.restoreBackup()
    expect(store.status).toBe('ready')
    expect(store.document?.revision).toBe(1)
  })
})

describe('external changes', () => {
  it('reloads when another tab writes the document key and flags legacy writes', async () => {
    const { store, planner, events } = setup()
    await store.start()
    await planner.save(testDocument({ revision: 1 }), 0)
    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.document }))
    await store.settled()
    expect(store.document?.revision).toBe(1)

    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.legacyV1 }))
    expect(store.legacyChanged).toBe(true)
  })
})
