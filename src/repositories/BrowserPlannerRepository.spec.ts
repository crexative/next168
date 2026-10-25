import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { STORED_DOCUMENT_MISSING } from './BrowserPlannerRepository'
import { IndexedDbStore, type BrowserStore, type Change, type StoredPart } from './indexedDbStore'
import { LEGACY_KEYS } from './legacyImport'
import {
  createTestRepositories, KEYS, MemoryCalendarTexts, MemoryChannelBus, MemoryStorage, MemoryStore, mutexRunner, testDocument,
  type TestRepositoryOptions,
} from './testSupport'

const saved = (revision: number, extra = {}) => testDocument({ revision, ...extra })
const json = (value: unknown) => JSON.stringify(value)

type StoreCase = { name: string; create: () => BrowserStore; failWritesOf: (store: BrowserStore, part: StoredPart) => void }
const storeCases: StoreCase[] = [
  {
    name: 'MemoryStore',
    create: () => new MemoryStore(),
    failWritesOf: (store, part) => { (store as MemoryStore).failWritesTo.add(part) },
  },
  {
    name: 'IndexedDbStore',
    create: () => new IndexedDbStore(new IDBFactory()),
    failWritesOf: (_store, part) => {
      const put = IDBObjectStore.prototype.put
      const keys: Record<StoredPart, string> = { document: 'current', backup: 'current', proposals: 'all', migration: 'migration', purge: 'purge', purgeEpoch: 'purgeEpoch', unsavedBaseline: 'unsavedBaseline', preUpgradeCopy: 'pre-v3' }
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (key === keys[part] && (this.name === part || this.name === 'meta')) throw new DOMException('q', 'QuotaExceededError')
        return put.call(this, value, key)
      })
    },
  },
]

// A5(k): no repository operation in this suite may write localStorage.
const legacies: MemoryStorage[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const legacy of legacies.splice(0)) expect(legacy.writes).toBe(0)
})

describe.each(storeCases)('$name', ({ create, failWritesOf }) => {
  function repos(options: TestRepositoryOptions = {}) {
    const legacy = options.legacy ?? new MemoryStorage()
    legacies.push(legacy)
    const store = options.store ?? create()
    return { ...createTestRepositories({ ...options, legacy, store }), failWritesOf: (part: StoredPart) => failWritesOf(store, part) }
  }
  const peek = async (store: BrowserStore, part: StoredPart) => (await store.read([part]))[part]
  const seed = (store: BrowserStore, change: Change) => store.write(change)
  const v1 = json({
    categories: [{ id: 'c1', name: 'Work', color: '#3b82f6', weeklyHourLimit: 40 }],
    timeBlocks: [{ id: 'b1', categoryId: 'c1', title: 'Focus', description: 'notes', dayOfWeek: 1, startTime: '22:00', endTime: '06:00', durationMinutes: 480, repeatDays: [1, 2, 2] }],
  })

  describe('load and the one-time import (A5)', () => {
    it('reports empty storage', async () => {
      expect(await repos().planner.load()).toMatchObject({ kind: 'empty', document: { revision: 0 } })
    })

    it('(a) copies v2, its backup and proposals byte for byte with the migration record in one transaction', async () => {
      const { planner, legacy, store } = repos()
      const document = json(saved(3))
      const backup = json(saved(2))
      const proposals = '[]'
      legacy.data.set(KEYS.document, document)
      legacy.data.set(KEYS.backup, backup)
      legacy.data.set(KEYS.proposals, proposals)
      const writes = vi.spyOn(store, 'write')
      const result = await planner.load()
      expect(result).toMatchObject({ kind: 'ok', document: { revision: 3 } })
      expect(result).not.toHaveProperty('migratedFrom')
      expect(writes).toHaveBeenCalledTimes(1)
      expect(await store.read(['document', 'backup', 'proposals'])).toEqual({ document, backup, proposals })
      expect(await peek(store, 'migration')).toMatchObject({ source: 'v2' })
    })

    it('(b) migrates v1 once, reports it, and leaves next168-data byte-identical', async () => {
      const { planner, legacy, store } = repos()
      legacy.data.set(KEYS.legacyV1, v1)
      const result = await planner.load()
      expect(result).toMatchObject({ kind: 'ok', migratedFrom: 1 })
      if (result.kind !== 'ok') return
      expect(result.document.blocks[0]).toMatchObject({ days: [1, 2], start: 1320, end: 360, notes: 'notes' })
      expect(legacy.data.get(KEYS.legacyV1)).toBe(v1)
      expect(JSON.parse((await peek(store, 'document')) as string).blocks).toHaveLength(1)
      expect(await peek(store, 'migration')).toMatchObject({ source: 'v1' })
    })

    it('(c) prefers v2 over v1 when both exist', async () => {
      const { planner, legacy } = repos()
      legacy.data.set(KEYS.legacyV1, v1)
      legacy.data.set(KEYS.document, json(saved(7)))
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { revision: 7 } })
    })

    it('(d) never imports again: later legacy edits are ignored and nothing is written', async () => {
      const { planner, legacy, store } = repos()
      legacy.data.set(KEYS.document, json(saved(1)))
      await planner.load()
      const stored = await peek(store, 'document')
      legacy.data.set(KEYS.document, json(saved(9)))
      legacy.data.set(KEYS.legacyV1, v1)
      const writes = vi.spyOn(store, 'write')
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { revision: 1 } })
      expect(writes).not.toHaveBeenCalled()
      expect(await peek(store, 'document')).toBe(stored)
    })

    it('(e) a lost document after an import is recovery, never a second import of v1', async () => {
      const { planner, legacy, store } = repos()
      await seed(store, { migration: { source: 'v1', at: '2026-10-24T12:00:00.000Z' } })
      legacy.data.set(KEYS.legacyV1, v1)
      expect(await planner.load()).toEqual({ kind: 'corrupt', raw: '', reason: STORED_DOCUMENT_MISSING })
      expect(await peek(store, 'document')).toBeUndefined()
      expect(await planner.replaceCorrupt(saved(0))).toMatchObject({ kind: 'ok' })
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { revision: 0 } })
    })

    it('(e) without Web Locks a lost document after an import is still recovery, not v1 in memory', async () => {
      const { planner, legacy, store } = repos({ withLocks: false })
      await seed(store, { migration: { source: 'v1', at: '2026-10-24T12:00:00.000Z' } })
      legacy.data.set(KEYS.legacyV1, v1)
      expect(await planner.load()).toEqual({ kind: 'corrupt', raw: '', reason: STORED_DOCUMENT_MISSING })
    })

    it('(f) two concurrent loads import exactly once', async () => {
      const { planner, legacy, store } = repos()
      legacy.data.set(KEYS.legacyV1, v1)
      const writes = vi.spyOn(store, 'write')
      const [first, second] = await Promise.all([planner.load(), planner.load()])
      expect(writes).toHaveBeenCalledTimes(1)
      expect(first).toMatchObject({ kind: 'ok' })
      expect(second).toMatchObject({ kind: 'ok' })
    })

    it('(g) without Web Locks migrates in memory only and writes nothing', async () => {
      const { planner, legacy, store } = repos({ withLocks: false })
      legacy.data.set(KEYS.legacyV1, json({ categories: [], timeBlocks: [] }))
      const writes = vi.spyOn(store, 'write')
      expect(planner.writable).toBe(false)
      expect(await planner.load()).toMatchObject({ kind: 'ok', migratedFrom: 1 })
      expect(writes).not.toHaveBeenCalled()
    })

    it('(h) a failed import changes nothing, surfaces the error, and the next load imports', async () => {
      const { planner, legacy, store, failWritesOf } = repos()
      legacy.data.set(KEYS.legacyV1, v1)
      failWritesOf('migration')
      await expect(planner.load()).rejects.toMatchObject({ name: 'QuotaExceededError' })
      vi.restoreAllMocks()
      if (store instanceof MemoryStore) store.failWritesTo.clear()
      expect(await store.read(['document', 'backup', 'proposals', 'migration'])).toEqual({})
      expect(legacy.data.get(KEYS.legacyV1)).toBe(v1)
      expect(await planner.load()).toMatchObject({ kind: 'ok', migratedFrom: 1 })
      expect(await peek(store, 'migration')).toMatchObject({ source: 'v1' })
    })

    it('(i) a corrupt v1 is reported and nothing is written', async () => {
      const { planner, legacy, store } = repos()
      legacy.data.set(KEYS.legacyV1, '{broken')
      const writes = vi.spyOn(store, 'write')
      expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw: '{broken' })
      expect(writes).not.toHaveBeenCalled()
    })

    it('keeps an unrepresentable v1 document for recovery instead of dropping blocks', async () => {
      const { planner, legacy, store } = repos()
      const raw = json({ categories: [], timeBlocks: [{ id: 'orphan', categoryId: 'missing', title: 'Focus', dayOfWeek: 1, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }] })
      legacy.data.set(KEYS.legacyV1, raw)
      expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw })
      expect(await peek(store, 'document')).toBeUndefined()
    })

    it('(j) a corrupt v2 is copied byte for byte and reported with the same raw text', async () => {
      const { planner, legacy, store } = repos()
      const raw = JSON.stringify(testDocument({ appliedProposalIds: ['duplicate', 'duplicate'] }), null, 2)
      legacy.data.set(KEYS.document, raw)
      expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw })
      expect(await peek(store, 'document')).toBe(raw)
      expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw })
    })

    it('reports a newer schema version as unsupported', async () => {
      const { planner, store } = repos()
      await seed(store, { document: json({ schemaVersion: 9 }) })
      expect(await planner.load()).toEqual({ kind: 'unsupported', schemaVersion: 9 })
    })

    it('rejects when the store cannot be read', async () => {
      const failing: BrowserStore = { read: () => Promise.reject(new DOMException('gone', 'UnknownError')), write: () => Promise.resolve() }
      await expect(repos({ store: failing }).planner.load()).rejects.toMatchObject({ name: 'UnknownError' })
    })
  })

  describe('save', () => {
    it('writes the new document and the backup of the previous bytes in one transaction', async () => {
      const { planner, store } = repos()
      expect(await planner.save(saved(1), 0)).toEqual({ kind: 'ok', revision: 1 })
      const first = await peek(store, 'document')
      const writes = vi.spyOn(store, 'write')
      expect(await planner.save(saved(2), 1)).toEqual({ kind: 'ok', revision: 2 })
      expect(writes).toHaveBeenCalledTimes(1)
      expect(writes.mock.calls[0]![0]).toEqual({ document: json(saved(2)), backup: first })
      expect(await peek(store, 'backup')).toBe(first)
    })

    it('serializes concurrent commits from the same revision: one wins, one conflicts', async () => {
      const { planner } = repos()
      const results = await Promise.all([planner.save(saved(1), 0), planner.save(saved(1, { updatedAt: '2026-10-24T13:00:00.000Z' }), 0)])
      expect(results.filter((result) => result.kind === 'ok')).toHaveLength(1)
      expect(results.find((result) => result.kind === 'conflict')).toEqual({ kind: 'conflict', currentRevision: 1 })
    })

    it('leaves document and backup unchanged when the write hits the quota', async () => {
      const { planner, store, failWritesOf } = repos()
      await planner.save(saved(1), 0)
      await planner.save(saved(2), 1)
      const before = await store.read(['document', 'backup'])
      failWritesOf('document')
      expect(await planner.save(saved(3), 2)).toEqual({ kind: 'error', reason: 'quota-exceeded' })
      vi.restoreAllMocks()
      expect(await store.read(['document', 'backup'])).toEqual(before)
    })

    it('refuses to overwrite unreadable stored data', async () => {
      const { planner, store } = repos()
      await seed(store, { document: 'garbage' })
      expect(await planner.save(saved(1), 0)).toEqual({ kind: 'error', reason: 'stored-document-unreadable' })
      expect(await peek(store, 'document')).toBe('garbage')
    })

    it('refuses invalid documents and read-only mode', async () => {
      const { planner } = repos()
      expect(await planner.save({ ...saved(1), revision: -5 }, 0)).toEqual({ kind: 'error', reason: 'invalid-document' })
      expect(await repos({ withLocks: false }).planner.save(saved(1), 0)).toEqual({ kind: 'error', reason: 'no-web-locks' })
    })

    it('refuses semantic violations before writing the document', async () => {
      const { planner, store } = repos()
      const writes = vi.spyOn(store, 'write')
      expect(await planner.save(saved(1, { appliedProposalIds: ['duplicate', 'duplicate'] }), 0)).toEqual({ kind: 'error', reason: 'invalid-document' })
      expect(writes).not.toHaveBeenCalled()
    })

    it('refuses a save started before a delete-all even when the revision matches', async () => {
      const { planner } = repos()
      await planner.save(saved(1), 0)
      const epoch = await planner.purgeEpoch()
      expect(await planner.deleteAll(saved(2), 1)).toMatchObject({ kind: 'ok' })
      expect(await planner.saveAtEpoch(saved(3), 2, epoch)).toEqual({ kind: 'conflict', currentRevision: 2 })
      expect(await planner.saveAtEpoch(saved(3), 2, epoch + 1)).toEqual({ kind: 'ok', revision: 3 })
    })
  })

  describe('recovery', () => {
    it('replaces corrupt data, keeping the raw bytes in the backup', async () => {
      const { planner, store } = repos()
      await seed(store, { document: 'garbage' })
      expect(await planner.replaceCorrupt(saved(0))).toMatchObject({ kind: 'ok' })
      expect(await peek(store, 'backup')).toBe('garbage')
      expect(await planner.load()).toMatchObject({ kind: 'ok' })
    })

    it('keeps a valid backup instead of overwriting it with corrupt bytes', async () => {
      const { planner, store } = repos()
      await planner.save(saved(1), 0)
      await planner.save(saved(2), 1)
      const goodBackup = await peek(store, 'backup')
      await seed(store, { document: 'garbage' })
      await planner.replaceCorrupt(saved(0))
      expect(await peek(store, 'backup')).toBe(goodBackup)
    })

    it('refuses to replace readable data', async () => {
      const { planner } = repos()
      await planner.save(saved(1), 0)
      expect(await planner.replaceCorrupt(saved(0))).toEqual({ kind: 'error', reason: 'data-is-not-corrupt' })
    })

    it('restores a valid backup over corrupt data', async () => {
      const { planner, store } = repos()
      await planner.save(saved(1), 0)
      await planner.save(saved(2), 1)
      await seed(store, { document: 'garbage' })
      expect(await planner.peekBackup()).toMatchObject({ revision: 1 })
      expect(await planner.restoreBackup()).toEqual({ kind: 'ok', revision: 1 })
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { revision: 1 } })
    })

    it('reports a storage failure during recovery as an error result', async () => {
      const { planner, store, failWritesOf } = repos()
      await seed(store, { document: 'garbage' })
      failWritesOf('document')
      expect(await planner.replaceCorrupt(saved(0))).toEqual({ kind: 'error', reason: 'quota-exceeded' })
    })
  })

  describe('delete-all (A7)', () => {
    const sourceA = { id: 'source-a', name: 'A', kind: 'file' as const, colorKey: 'blue' as const, lastSyncedAt: '2026-10-24T12:00:00.000Z' }
    async function seeded(options: TestRepositoryOptions = {}) {
      const calendarTexts = new MemoryCalendarTexts()
      const repositories = repos({ calendarTexts, ...options })
      const { planner, proposals, legacy } = repositories
      await planner.save(saved(1, { categories: [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }], calendarSources: [sourceA, { ...sourceA, id: 'source-b' }] }), 0)
      await planner.save({ ...(await loaded(planner)), revision: 2 }, 1)
      await proposals.create({ contractVersion: '1.0', workspaceId: 'workspace-1', baseRevision: 2, summary: 'S', ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'F', days: [1], start: 540, end: 600 } }] }, 'mcp')
      calendarTexts.data.set('source-a', 'A-TEXT')
      calendarTexts.data.set('source-b', 'B-TEXT')
      for (const key of LEGACY_KEYS) legacy.data.set(key, key === KEYS.legacyV1 ? v1 : 'x')
      return { ...repositories, calendarTexts }
    }
    async function loaded(planner: { load(): Promise<unknown> }) {
      const result = await planner.load() as { kind: string; document: ReturnType<typeof testDocument> }
      return result.document
    }
    const fresh = () => saved(3, { workspaceId: 'workspace-2', calendarSources: [] })

    it('replaces the planner and removes backup, proposals, calendar texts and every legacy key', async () => {
      const { planner, store, legacy, calendarTexts } = await seeded()
      expect(await planner.deleteAll(fresh(), 2)).toEqual({ kind: 'ok', revision: 3 })
      expect(await store.read(['backup', 'proposals'])).toEqual({})
      expect(JSON.parse((await peek(store, 'document')) as string).workspaceId).toBe('workspace-2')
      expect(calendarTexts.data.size).toBe(0)
      for (const key of LEGACY_KEYS) expect(legacy.data.has(key)).toBe(false)
      expect(await peek(store, 'purge')).toEqual({ legacyKeys: true, calendarSourceIds: [] })
      expect(await peek(store, 'purgeEpoch')).toBe(1)
    })

    it('runs in ONE hold of the real, non-reentrant commit lock (no nested request deadlocks it)', async () => {
      const runExclusive = mutexRunner()
      const { planner } = await seeded({ runExclusive })
      const timeout = new Promise<'deadlock'>((resolve) => setTimeout(() => resolve('deadlock'), 1000))
      expect(await Promise.race([planner.deleteAll(fresh(), 2), timeout])).toEqual({ kind: 'ok', revision: 3 })
      // The lock is free again afterwards.
      expect(await Promise.race([runExclusive(async () => 'free'), timeout])).toBe('free')
    })

    it('(a) a failed delete-all transaction changes nothing and records no purge', async () => {
      const { planner, store, legacy, calendarTexts, failWritesOf } = await seeded()
      const before = await store.read(['document', 'backup', 'proposals', 'purge', 'purgeEpoch'])
      failWritesOf('purge')
      expect(await planner.deleteAll(fresh(), 2)).toEqual({ kind: 'error', reason: 'quota-exceeded' })
      vi.restoreAllMocks()
      expect(await store.read(['document', 'backup', 'proposals', 'purge', 'purgeEpoch'])).toEqual(before)
      expect(calendarTexts.data.size).toBe(2)
      expect(legacy.data.size).toBe(LEGACY_KEYS.length)
    })

    it('(b) interrupted before the key removals: the next load finishes everything', async () => {
      const { planner, store, legacy, calendarTexts } = await seeded()
      const getItem = vi.spyOn(legacy, 'getItem').mockImplementationOnce(() => { throw new Error('killed') })
      expect(await planner.deleteAll(fresh(), 2)).toMatchObject({ kind: 'ok' })
      expect(legacy.data.size).toBe(LEGACY_KEYS.length)
      expect(calendarTexts.data.size).toBe(2)
      getItem.mockRestore()
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { workspaceId: 'workspace-2' } })
      expect(legacy.data.size).toBe(0)
      expect(calendarTexts.data.size).toBe(0)
      expect(await peek(store, 'purge')).toEqual({ legacyKeys: true, calendarSourceIds: [] })
      expect(await store.read(['backup', 'proposals'])).toEqual({})
    })

    it('(c) interrupted after the key removals, before the calendar deletions: the next load deletes them', async () => {
      const { planner, legacy, calendarTexts } = await seeded()
      const remove = vi.spyOn(calendarTexts, 'delete').mockRejectedValueOnce(new Error('killed'))
      await planner.deleteAll(fresh(), 2)
      expect(legacy.data.size).toBe(0)
      expect(calendarTexts.data.size).toBe(2)
      remove.mockRestore()
      await planner.load()
      expect(calendarTexts.data.size).toBe(0)
    })

    it('(d) interrupted before the final purge write: the next load completes it', async () => {
      const { planner, store, calendarTexts } = await seeded()
      const write = store.write.bind(store)
      const writes = vi.spyOn(store, 'write').mockImplementation(async (change) => {
        if (change.purge && !change.document) throw new DOMException('killed', 'AbortError')
        return write(change)
      })
      await planner.deleteAll(fresh(), 2)
      expect(calendarTexts.data.size).toBe(0)
      expect(await peek(store, 'purge')).toEqual({ legacyKeys: true, calendarSourceIds: ['source-a', 'source-b'] })
      writes.mockRestore()
      await planner.load()
      expect(await peek(store, 'purge')).toEqual({ legacyKeys: true, calendarSourceIds: [] })
    })

    it('(e) legacy keys a kill brings back are removed again, and never re-imported', async () => {
      const { planner, legacy } = await seeded()
      await planner.deleteAll(fresh(), 2)
      legacy.data.set(KEYS.legacyV1, v1)
      legacy.data.set(KEYS.document, json(saved(9)))
      expect(await planner.load()).toMatchObject({ kind: 'ok', document: { workspaceId: 'workspace-2', revision: 3 } })
      expect(legacy.data.size).toBe(0)
    })

    it('(f) a listed calendar the current document references again is kept', async () => {
      const { planner, calendarTexts } = await seeded()
      vi.spyOn(calendarTexts, 'delete').mockRejectedValueOnce(new Error('killed'))
      await planner.deleteAll(fresh(), 2)
      vi.restoreAllMocks()
      expect(await planner.save({ ...fresh(), revision: 4, calendarSources: [sourceA] }, 3)).toMatchObject({ kind: 'ok' })
      await planner.load()
      expect([...calendarTexts.data.keys()]).toEqual(['source-a'])
    })

    it('without Web Locks a pending purge stays pending and nothing is mutated', async () => {
      const shared = await seeded()
      vi.spyOn(shared.calendarTexts, 'delete').mockRejectedValueOnce(new Error('killed'))
      vi.spyOn(shared.legacy, 'getItem').mockImplementationOnce(() => { throw new Error('killed') })
      await shared.planner.deleteAll(fresh(), 2)
      vi.restoreAllMocks()
      const unlocked = repos({ withLocks: false, store: shared.store, legacy: shared.legacy, calendarTexts: shared.calendarTexts })
      const writes = vi.spyOn(shared.store, 'write')
      expect(await unlocked.planner.load()).toMatchObject({ kind: 'ok' })
      expect(writes).not.toHaveBeenCalled()
      expect(shared.legacy.data.size).toBe(LEGACY_KEYS.length)
      expect(shared.calendarTexts.data.size).toBe(2)
    })
  })

  describe('cross-tab notification (A9)', () => {
    function twoTabs() {
      const store = create()
      const bus = new MemoryChannelBus()
      const runExclusive = mutexRunner()
      return { a: repos({ store, bus, runExclusive }), b: repos({ store, bus, runExclusive }), bus }
    }

    it('notifies the other tab when a commit landed', async () => {
      const { a, b } = twoTabs()
      const listener = vi.fn()
      b.planner.subscribe(listener)
      await a.planner.save(saved(1), 0)
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('(a) a dropped message is caught up by exactly one reload on focus', async () => {
      const { a, b, bus } = twoTabs()
      await b.planner.load()
      const listener = vi.fn()
      b.planner.subscribe(listener)
      bus.drop = true
      await a.planner.save(saved(1), 0)
      expect(listener).not.toHaveBeenCalled()
      b.events.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    })

    it('(b) focus or visibility with an unchanged revision does not reload', async () => {
      const { a } = twoTabs()
      await a.planner.save(saved(1), 0)
      await a.planner.load()
      const listener = vi.fn()
      a.planner.subscribe(listener)
      a.events.dispatchEvent(new Event('focus'))
      a.visibility.target.dispatchEvent(new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(listener).not.toHaveBeenCalled()
    })

    it('a visible-again tab re-checks, a hidden one does not', async () => {
      const { a, b, bus } = twoTabs()
      await b.planner.load()
      const listener = vi.fn()
      b.planner.subscribe(listener)
      bus.drop = true
      await a.planner.save(saved(1), 0)
      b.visibility.set(false)
      b.visibility.target.dispatchEvent(new Event('visibilitychange'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(listener).not.toHaveBeenCalled()
      b.visibility.set(true)
      b.visibility.target.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    })

    it('a failing re-check read is reported through a reload', async () => {
      const store = create()
      const failing: BrowserStore = { read: async (parts) => { if (parts.length === 1 && parts[0] === 'document') throw new DOMException('gone', 'UnknownError'); return store.read(parts) }, write: (change) => store.write(change) }
      const { planner, events } = repos({ store: failing })
      const listener = vi.fn()
      planner.subscribe(listener)
      events.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    })

    it('(c) a notification that throws after the commit still returns ok', async () => {
      const { a, bus } = twoTabs()
      bus.notifyFails = true
      expect(await a.planner.save(saved(1), 0)).toEqual({ kind: 'ok', revision: 1 })
    })

    it('(d) a stale tab committing after a dropped message gets a conflict and changes nothing', async () => {
      const { a, b, bus } = twoTabs()
      await b.planner.load()
      bus.drop = true
      await a.planner.save(saved(1, { settings: { ...saved(1).settings, timeZone: 'Asia/Tokyo' } }), 0)
      const stored = await a.store.read(['document'])
      expect(await b.planner.save(saved(1), 0)).toEqual({ kind: 'conflict', currentRevision: 1 })
      expect(await a.store.read(['document'])).toEqual(stored)
    })

    it('stops listening on unsubscribe', async () => {
      const { a, b } = twoTabs()
      const listener = vi.fn()
      const stop = b.planner.subscribe(listener)
      stop()
      await a.planner.save(saved(1), 0)
      b.events.dispatchEvent(new Event('focus'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('legacy banner (A10)', () => {
    const storageEvent = (key: string, newValue: string | null) => Object.assign(new Event('storage'), { key, newValue })

    it('flags writes to next168-data or next168-v2 by an older tab, not removals', () => {
      const { planner, events } = repos()
      const listener = vi.fn()
      planner.onLegacyChange(listener)
      events.dispatchEvent(storageEvent(KEYS.legacyV1, '{}'))
      events.dispatchEvent(storageEvent(KEYS.document, '{}'))
      expect(listener).toHaveBeenCalledTimes(2)
      events.dispatchEvent(storageEvent(KEYS.legacyV1, null))
      events.dispatchEvent(storageEvent(KEYS.document, null))
      events.dispatchEvent(storageEvent('next168-language', 'es'))
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })
})
