import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { configurePlannerStore, usePlannerStore } from './plannerStore'
import { createTestRepositories, fixedNow, KEYS, MemoryChannelBus, MemoryStore, mutexRunner, newTestId, testDocument } from '@/repositories/testSupport'

function setup(storage = new MemoryStore(), withLocks = true) {
  const repos = createTestRepositories({ store: storage, withLocks })
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  setActivePinia(createPinia())
  return { ...repos, storage, store: usePlannerStore() }
}

beforeEach(() => setActivePinia(createPinia()))

describe('loading', () => {
  it('starts with an empty in-memory document and does not write until the first commit', async () => {
    const { store, storage } = setup()
    await store.load()
    expect(store.status).toBe('ready')
    expect(store.document?.revision).toBe(0)
    expect(storage.writeTransactions).toBe(0)
  })

  it('exposes corrupt data with its raw text and never changes storage', async () => {
    const storage = new MemoryStore()
    storage.data.set('document', 'garbage')
    const { store } = setup(storage)
    await store.load()
    expect(store.status).toBe('corrupt')
    expect(store.corruptRaw).toBe('garbage')
    expect(store.document).toBeNull()
    expect(storage.data.get('document')).toBe('garbage')
  })

  it('opens newer schema versions as unsupported', async () => {
    const storage = new MemoryStore()
    storage.data.set('document', JSON.stringify({ schemaVersion: 3 }))
    const { store } = setup(storage)
    await store.load()
    expect(store.status).toBe('unsupported')
    expect(await store.commit(() => undefined)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('is read-only with an explanation when Web Locks are missing', async () => {
    const { store } = setup(new MemoryStore(), false)
    await store.load()
    expect(store.status).toBe('readonly')
    expect(store.error).toBe('no-web-locks')
    expect(await store.commit(() => undefined)).toEqual({ ok: false, reason: 'readonly' })
  })
})

// verify4 defect 1: the review sheet reloads before it previews; a new empty planner each time made every
// proposal on an unsaved planner "for another workspace".
describe('a planner that was never stored', () => {
  it('keeps the same unsaved planner (and workspace) across reloads until something is stored', async () => {
    const { store, events } = setup()
    await store.load()
    const first = store.document
    await store.load()
    events.dispatchEvent(new Event('focus'))
    await store.settled()
    expect(store.document?.workspaceId).toBe(first?.workspaceId)
    expect(store.stored).toBe(false)
  })

  it('shows the unsaved planner a proposal was made against, in any tab', async () => {
    const storage = new MemoryStore()
    const { store, proposals } = setup(storage)
    await store.load()
    const basis = testDocument({ workspaceId: 'from-other-tab' })
    await proposals.create({ contractVersion: '1.0', workspaceId: 'from-other-tab', baseRevision: 0, summary: 'S', ops: [{ op: 'add_category', ref: 'new-a', category: { name: 'A' } }] }, 'import', { basis })
    await store.load()
    expect(store.document?.workspaceId).toBe('from-other-tab')
    expect(store.stored).toBe(false)
    expect(storage.data.has('document')).toBe(false)
  })
})

describe('commit', () => {
  it('saves, then publishes the new revision', async () => {
    const { store, storage } = setup()
    await store.load()
    expect(await store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' })).toEqual({ ok: true })
    expect(store.document?.revision).toBe(1)
    expect(store.document?.settings.timeZone).toBe('Europe/Berlin')
    expect(JSON.parse(storage.data.get('document') as string).settings.timeZone).toBe('Europe/Berlin')
  })

  it('a storage failure keeps the last committed document and blocks editing with the error status (A8)', async () => {
    const { store, storage } = setup()
    await store.load()
    await store.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' })
    storage.failWrites = true
    const result = await store.commit((draft) => { draft.settings.timeZone = 'Europe/Berlin' })
    expect(result).toEqual({ ok: false, reason: 'quota-exceeded' })
    expect(store.error).toBe('quota-exceeded')
    expect(store.status).toBe('error')
    expect(store.writable).toBe(false)
    expect(store.document?.revision).toBe(1)
    expect(store.document?.settings.timeZone).toBe('Asia/Tokyo')
    expect(await store.commit((draft) => { draft.settings.timeZone = 'Europe/Paris' })).toEqual({ ok: false, reason: 'error' })
    storage.failWrites = false
    await store.load()
    expect(store.status).toBe('ready')
  })

  it('a refused document is not a storage failure and keeps editing available', async () => {
    const { store } = setup()
    await store.load()
    expect(await store.commit((draft) => { draft.settings.locale = '' })).toEqual({ ok: false, reason: 'invalid-document' })
    expect(store.status).toBe('ready')
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
    expect(storage.writeTransactions).toBe(0)
  })

  it('rejects semantic violations without publishing or persisting the draft', async () => {
    const { store, storage } = setup()
    await store.load()
    const before = store.document
    expect(await store.commit((draft) => { draft.appliedProposalIds = ['duplicate', 'duplicate'] }))
      .toEqual({ ok: false, reason: 'invalid-document' })
    expect(store.document).toBe(before)
    expect(storage.writeTransactions).toBe(0)
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
    const storage = new MemoryStore()
    storage.data.set('document', 'garbage')
    const { store } = setup(storage)
    await store.load()
    expect(await store.startFresh()).toEqual({ ok: true })
    expect(store.status).toBe('ready')
    expect(storage.data.get('backup')).toBe('garbage')
  })

  it('restores the last valid backup', async () => {
    const { store, planner, storage } = setup()
    await planner.save(testDocument({ revision: 1 }), 0)
    await planner.save(testDocument({ revision: 2 }), 1)
    storage.data.set('document', 'garbage')
    await store.load()
    expect(store.backupAvailable).toBe(true)
    await store.restoreBackup()
    expect(store.status).toBe('ready')
    expect(store.document?.revision).toBe(1)
  })
})

describe('external changes', () => {
  it('reloads when another tab commits, without a storage event', async () => {
    const storage = new MemoryStore()
    const bus = new MemoryChannelBus()
    const runExclusive = mutexRunner()
    const thisTab = createTestRepositories({ store: storage, bus, runExclusive })
    const otherTab = createTestRepositories({ store: storage, bus, runExclusive })
    configurePlannerStore({ repository: thisTab.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const store = usePlannerStore()
    await store.start()
    await otherTab.planner.save(testDocument({ revision: 1 }), 0)
    await vi.waitFor(() => expect(store.document?.revision).toBe(1))
  })

  it('flags writes from an older tab to the legacy keys', async () => {
    const { store, events } = setup()
    await store.start()
    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.legacyV1, newValue: '{}' }))
    expect(store.legacyChanged).toBe(true)
  })

  it('a failing focus re-check shows the error screen with the document still exportable (A8c)', async () => {
    const { store, storage, events } = setup()
    await store.start()
    await store.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' })
    storage.failReads = true
    events.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(store.status).toBe('error'))
    await store.settled()
    expect(store.error).toBe('storage-failed:UnknownError')
    expect(store.document?.settings.timeZone).toBe('Asia/Tokyo')
  })
})

describe('delete-all', () => {
  it('replaces the document through the repository delete-all and publishes it', async () => {
    const { store, storage } = setup()
    await store.load()
    await store.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' })
    storage.data.set('backup', 'old')
    expect(store.canDeleteAll()).toBe(true)
    expect(await store.deleteAll((draft) => { draft.settings.timeZone = 'UTC'; draft.workspaceId = 'fresh' })).toEqual({ ok: true })
    expect(store.document?.workspaceId).toBe('fresh')
    expect(store.document?.revision).toBe(2)
    expect(storage.data.has('backup')).toBe(false)
    expect(storage.data.get('purgeEpoch')).toBe(1)
  })

  it('a commit started before a delete-all with its purge epoch is refused', async () => {
    const { store, planner } = setup()
    await store.load()
    const epoch = await planner.purgeEpoch()
    await store.deleteAll((draft) => { draft.workspaceId = 'fresh' })
    expect(await store.commit((draft) => { draft.calendarSources = [] }, { purgeEpoch: epoch })).toEqual({ ok: false, reason: 'conflict' })
    expect(await store.commit((draft) => { draft.calendarSources = [] }, { purgeEpoch: epoch + 1 })).toEqual({ ok: true })
  })
})

describe('what storage held when the document was loaded', () => {
  it('tells proven-empty storage apart from a stored document, including a revision-0 one', async () => {
    const empty = setup()
    await empty.store.load()
    expect(empty.store.stored).toBe(false)
    expect(empty.store.document?.revision).toBe(0)

    const storage = new MemoryStore()
    storage.data.set('document', JSON.stringify(testDocument({ revision: 0 })))
    const migrated = setup(storage)
    await migrated.store.load()
    expect(migrated.store.stored).toBe(true)
    expect(migrated.store.document?.revision).toBe(0)
  })

  it('becomes stored after the first commit', async () => {
    const { store } = setup()
    await store.load()
    expect(await store.commit((draft) => { draft.settings.onboardingDone = true })).toEqual({ ok: true })
    expect(store.stored).toBe(true)
  })
})

describe('a commit with expect', () => {
  it('asks the repository for the guarded write with what was opened on, and refuses a change in storage', async () => {
    const { store, planner, storage } = setup()
    await store.load()
    const guarded = vi.spyOn(planner, 'saveGuarded')
    const epoch = planner.knownPurgeEpoch()
    // Another tab filled storage after this tab's empty load.
    storage.data.set('document', JSON.stringify(testDocument({ revision: 0 })))
    const result = await store.commit((draft) => { draft.settings.onboardingDone = true }, { expect: { storedFingerprint: 'absent', purgeEpoch: epoch } })
    expect(guarded).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), 0, { storedFingerprint: 'absent', purgeEpoch: epoch })
    expect(result).toEqual({ ok: false, reason: 'conflict' })
    expect(JSON.parse(storage.data.get('document') as string).revision).toBe(0)
    expect(store.stored).toBe(true)
  })

  it('falls back to the plain save when the repository has no guarded write (the companion)', async () => {
    const { store, planner } = setup()
    await store.load()
    Object.defineProperty(planner, 'saveGuarded', { value: undefined })
    const save = vi.spyOn(planner, 'save')
    expect(await store.commit((draft) => { draft.settings.onboardingDone = true }, { expect: { storedFingerprint: 'absent' } })).toEqual({ ok: true })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
