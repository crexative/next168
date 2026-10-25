// Slice 0 acceptance (design-r3-1A r7 §1.4, slice1-spec §0.1): F-01, F-02, F-03 and F-05 to F-09 at the repository
// level, with the real pre-fence code (`@old/*`) and the new code sharing one fake-indexeddb factory.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { buildExportBundle, portableHash } from '@/core/exportBundle'
import type { PlannerDocument } from '@/core/model'
import { configureCalendarServices, useCalendarStore } from '@/features/calendars/calendarStore'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { provideCalendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import { MAX_IMPORT_BYTES } from '@/features/settings/data/dataTransfer'
import { preUpgradeFiles } from '@/features/settings/data/preUpgradeCopy'
import { i18n } from '@/i18n'
import StorageErrorScreen from '@/app/StorageErrorScreen.vue'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import {
  databaseVersion, dumpConnection, dumpDatabases, ics, icsOfBytes, ORPHAN_ID, preFenceBuild, preFenceSource,
  recordingLock, SEED_TEXTS, seedWithPreFenceBuild, spyStoreCalls,
} from '@/test/storageFence'
import { BrowserPlannerRepository } from './BrowserPlannerRepository'
import { BrowserProposalRepository } from './BrowserProposalRepository'
import { IndexedDbStore } from './indexedDbStore'
import { failureReason, isStorageFailure, type RunExclusive } from './storageCommit'
import {
  CALENDAR_DATABASE, createStorageFence, PLANNER_DATABASE, PRE_UPGRADE_COPY_KEY, restoreFenceRefusal, RESTORE_MIN_STORAGE_VERSION,
  STORAGE_VERSION, UPGRADE_COPY_FAILED, type PreUpgradeCopy, type StorageFence,
} from './storageVersion'
import { createEmptyDocument } from './core'
import { fixedNow, MemoryChannelBus, MemoryStorage, mutexRunner } from './testSupport'

afterEach(() => { vi.restoreAllMocks() })

let ids = 0
const newId = () => `new-${++ids}`

// The new build of one page: its fence and repositories on the shared factory and commit lock.
function newBuild(factory: IDBFactory, lock: RunExclusive, fence: StorageFence = createStorageFence(factory, { lock, now: fixedNow })) {
  const store = new IndexedDbStore(factory, fence)
  const texts = new IndexedDbCalendarSourceStore(factory, fence)
  const bus = new MemoryChannelBus()
  const planner = new BrowserPlannerRepository({
    store, legacy: new MemoryStorage(), runExclusive: lock, channel: bus.channel(), events: new EventTarget(), calendarTexts: texts,
    now: fixedNow, newId, locale: () => 'en', timeZone: () => 'UTC',
  })
  const proposals = new BrowserProposalRepository({ store, runExclusive: lock, channel: bus.channel(), now: fixedNow, newId })
  return { fence, store, texts, planner, proposals }
}

async function seeded(texts?: Record<string, string>) {
  const factory = new IDBFactory()
  const lock = mutexRunner()
  const old = await preFenceBuild(factory, lock)
  const seed = await seedWithPreFenceBuild(old, texts)
  return { factory, lock, old, ...seed }
}

// What the person had before the upgrade, as a portable fingerprint (texts the document references).
async function portableBefore(document: PlannerDocument, texts: Record<string, string>): Promise<string> {
  const referenced = Object.fromEntries(document.calendarSources.map((source) => [source.id, texts[source.id]!]))
  return portableHash(buildExportBundle(document, referenced, { now: fixedNow }))
}

async function readCopy(factory: IDBFactory): Promise<PreUpgradeCopy | undefined> {
  const dump = JSON.parse(await dumpDatabases(factory, [PLANNER_DATABASE]))
  const entry = (dump[PLANNER_DATABASE]?.stores.snapshots ?? []).find(([key]: [string]) => key === PRE_UPGRADE_COPY_KEY)
  return entry?.[1]
}

// 'storage-error' when the operation failed on storage (rejected, or resolved with a storage-failure result).
async function settledOutcome(operation: () => Promise<unknown>): Promise<'storage-error' | unknown> {
  try {
    const result = await operation()
    if (result && typeof result === 'object' && 'kind' in result && result.kind === 'error' && 'reason' in result && isStorageFailure(result.reason as string)) return 'storage-error'
    return result
  } catch (error) {
    const reason = failureReason(error)
    return isStorageFailure(reason) || reason === 'calendars.storage' ? 'storage-error' : `rejected:${reason}`
  }
}

describe('F-01: two real builds on one IndexedDB factory', () => {
  it('the pre-fence code is the real version-1 code', async () => {
    expect(await preFenceSource('repositories/indexedDbStore.ts')).toContain('factory.open(DATABASE_NAME, 1)')
    expect(await preFenceSource('features/calendars/calendarSourceStore.ts')).toContain("open('next168-calendars', 1)")
  })

  it('after the new code opens, every old operation fails and leaves every store of both databases byte-identical', async () => {
    const { factory, lock, old, document, proposal } = await seeded()
    const fresh = newBuild(factory, lock)
    expect((await fresh.planner.load()).kind).toBe('ok')
    expect(await databaseVersion(factory, PLANNER_DATABASE)).toBe(STORAGE_VERSION)
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(STORAGE_VERSION)

    const next = { ...document, revision: 3 }
    const operations: Record<string, () => Promise<unknown>> = {
      load: () => old.planner.load(),
      save: () => old.planner.save(next, 2),
      saveAtEpoch: () => old.planner.saveAtEpoch(next, 2, 0),
      saveGuarded: () => old.planner.saveGuarded(next, 2, {}),
      deleteAll: () => old.planner.deleteAll(createEmptyDocument({ now: fixedNow(), locale: 'en', timeZone: 'UTC', idGen: () => 'ws-fresh' }), 2),
      restoreBackup: () => old.planner.restoreBackup(),
      proposalCreate: () => old.proposals.create({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 2, summary: 'x', ops: [{ op: 'delete_block', id: 'b-sentinel' }] }, 'mcp'),
      proposalApprove: () => old.proposals.approve(proposal.id, proposal.contentHash, 2),
      proposalReject: () => old.proposals.reject(proposal.id),
      calendarPut: () => old.texts.put('cal-file', ics('SENTINEL-overwrite')),
      calendarGet: () => old.texts.get('cal-file'),
      calendarDelete: () => old.texts.delete('cal-file'),
      calendarList: () => old.texts.list(),
    }
    for (const [name, operation] of Object.entries(operations)) {
      const before = await dumpDatabases(factory)
      const outcome = await settledOutcome(operation)
      expect([name, outcome]).toEqual([name, 'storage-error'])
      expect([name, await dumpDatabases(factory)]).toEqual([name, before])
    }
  })
})

describe('F-02: a blocked upgrade waits and writes nothing before it completes', () => {
  it('reports waiting, reads only under the commit lock, writes only inside the versionchange transaction, and no repository call resolves first', async () => {
    const events: string[] = []
    const factory = new IDBFactory()
    const lock = recordingLock(events)
    const old = await preFenceBuild(factory, lock)
    await seedWithPreFenceBuild(old)
    const seededDump = await dumpDatabases(factory)

    // An old tab's connection, held open as during one of its long transactions.
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PLANNER_DATABASE, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    events.length = 0
    const calls = spyStoreCalls(events)
    const fresh = newBuild(factory, lock)
    const waiting: boolean[] = []
    fresh.fence.onWaiting((value) => { waiting.push(value); events.push(`waiting:${value}`) })

    const load = fresh.planner.load().then((result) => { events.push('repository-resolved'); return result })
    const list = fresh.texts.list().then((result) => { events.push('repository-resolved'); return result })
    await vi.waitFor(() => expect(fresh.fence.waiting()).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))

    // Blocked: nothing resolved, nothing written, and both databases hold exactly what the old build stored.
    expect(events).not.toContain('repository-resolved')
    expect(calls.writes).toEqual([])
    const mark = events.length
    const blockedDump = { [PLANNER_DATABASE]: { version: held.version, stores: await dumpConnection(held) }, [CALENDAR_DATABASE]: JSON.parse(await dumpDatabases(factory, [CALENDAR_DATABASE]))[CALENDAR_DATABASE] }
    expect(blockedDump).toEqual(JSON.parse(seededDump))
    // The test's own dump reads are not the app's.
    events.splice(mark)

    held.close()
    expect((await load).kind).toBe('ok')
    expect((await list).sort()).toEqual(Object.keys(SEED_TEXTS).sort())
    expect(waiting).toEqual([true, false])

    // The capture reads happen while the fence holds the lock, before the upgrade; the only write before the
    // upgrade completes is the fence's own copy, inside the versionchange transaction (r7-fix).
    const upgradeWrites = calls.writes.filter((call) => call.mode === 'versionchange')
    expect(upgradeWrites).toEqual([{ method: 'add', database: PLANNER_DATABASE, store: 'snapshots', mode: 'versionchange', key: PRE_UPGRADE_COPY_KEY }])
    const firstRepositoryWrite = calls.writes.findIndex((call) => call.mode !== 'versionchange')
    expect(firstRepositoryWrite === -1 || calls.writes.slice(0, firstRepositoryWrite).every((call) => call.mode === 'versionchange')).toBe(true)
    // Order: lock → capture reads of both databases → upgrade (blocked, then its own write) → lock released →
    // repositories resolve. Every read before the release belongs to the capture.
    const released = events.indexOf('lock-released')
    const upgradeWrite = events.indexOf(`write:${PLANNER_DATABASE}:versionchange`)
    const captureReads = events.slice(0, released).filter((event) => event.startsWith('read:'))
    expect(events[0]).toBe('lock-acquired')
    expect(captureReads).toContain(`read:${PLANNER_DATABASE}`)
    expect(captureReads).toContain(`read:${CALENDAR_DATABASE}`)
    expect(events.lastIndexOf(`read:${CALENDAR_DATABASE}`, released)).toBeLessThan(events.indexOf('waiting:true'))
    expect(events.indexOf('waiting:true')).toBeLessThan(upgradeWrite)
    expect(upgradeWrite).toBeLessThan(released)
    expect(events.slice(0, released).filter((event) => event.startsWith('write:') && !event.endsWith(':versionchange'))).toEqual([])
    expect(events.indexOf('repository-resolved')).toBeGreaterThan(released)

    const after = JSON.parse(await dumpDatabases(factory))
    const before = JSON.parse(seededDump)
    for (const name of [PLANNER_DATABASE, CALENDAR_DATABASE]) {
      for (const [store, records] of Object.entries(before[name].stores)) {
        if (name === PLANNER_DATABASE && store === 'meta') continue
        expect([name, store, after[name].stores[store]]).toEqual([name, store, records])
      }
    }
  })
})

describe('F-03: restore runs only on a fenced connection', () => {
  it('refuses a connection below RESTORE_MIN_STORAGE_VERSION without touching storage', async () => {
    const factory = new IDBFactory()
    const unfenced = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(PLANNER_DATABASE, RESTORE_MIN_STORAGE_VERSION - 1)
      request.onsuccess = () => resolve(request.result)
    })
    const calls = spyStoreCalls()
    expect(restoreFenceRefusal(unfenced)).toBe('restore-unfenced')
    unfenced.close()
    const fence = createStorageFence(factory)
    const fenced = await fence.open(PLANNER_DATABASE)
    expect(restoreFenceRefusal(fenced)).toBeUndefined()
    fenced.close()
    expect(calls.writes.filter((call) => call.mode !== 'versionchange')).toEqual([])
  })
})

function configurePlanner(fresh: ReturnType<typeof newBuild>, fetchText: () => string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: fresh.planner, now: fixedNow, newId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: fresh.texts, fetcher: { fetch: async () => fetchText() }, now: fixedNow, newId, purgeGuard: fresh.planner })
  provideCalendarSourceStore(fresh.texts)
  return { planner: usePlannerStore(), pinia }
}

describe('F-05: the complete pre-upgrade copy (slice 0: refresh, deletion and commits, no restores)', () => {
  it('keeps the original calendar bytes and the v1 records after a refresh, a deletion and three commits', async () => {
    const { factory, lock, document } = await seeded()
    const v1 = JSON.parse(await dumpDatabases(factory))[PLANNER_DATABASE].stores
    const expected = await portableBefore(document, SEED_TEXTS)

    const fresh = newBuild(factory, lock)
    const { planner } = configurePlanner(fresh, () => ics('SENTINEL-url-refreshed'))
    await planner.load()
    expect(planner.status).toBe('ready')
    const calendars = useCalendarStore()
    await calendars.refreshSource('cal-url')
    expect(await fresh.texts.get('cal-url')).toContain('SENTINEL-url-refreshed')
    await calendars.removeSource('cal-file')
    expect(await fresh.texts.get('cal-file')).toBeUndefined()
    for (const name of ['one', 'two', 'three']) expect((await planner.commit((draft) => { draft.categories[0]!.name = name })).ok).toBe(true)

    const copy = await fresh.planner.preUpgradeCopy()
    expect(copy).toBeDefined()
    const files = await preUpgradeFiles(copy!)
    expect(files.bundle).toBeDefined()
    expect(await portableHash(JSON.parse(files.bundle!.json))).toBe(expected)
    expect(copy!.portableHash).toBe(expected)
    expect(files.bundle!.tooLarge).toBe(false)
    // The raw download is the version-1 bytes of the document, the backup and the proposals, plus every text.
    const raw = JSON.parse(files.raw.json) as PreUpgradeCopy
    expect(raw.raw.document).toBe(v1.document[0][1])
    expect(raw.raw.backup).toBe(v1.backup[0][1])
    expect(raw.raw.proposals).toBe(v1.proposals[0][1])
    expect(raw.calendarSourceTexts).toEqual(SEED_TEXTS)
    expect(raw.calendarSourceTexts[ORPHAN_ID]).toBe(SEED_TEXTS[ORPHAN_ID])
  })

  it('an oversized plan (six 5-MiB calendars) is kept complete, and its download is flagged too large to import', async () => {
    const big = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`cal-big-${index}`, icsOfBytes(`SENTINEL-big-${index}`, 5 * 1024 * 1024)]))
    const sources = Object.keys(big).map((id) => ({ id, name: id, kind: 'file' as const, colorKey: 'blue' as const }))
    const factory = new IDBFactory()
    const lock = mutexRunner()
    const old = await preFenceBuild(factory, lock)
    const { document } = await seedWithPreFenceBuild(old, big, sources)
    const expected = await portableBefore(document, big)
    const fresh = newBuild(factory, lock)
    expect((await fresh.planner.load()).kind).toBe('ok')
    const files = await preUpgradeFiles((await fresh.planner.preUpgradeCopy())!)
    expect(files.bundle!.bytes).toBeGreaterThan(31_000_000)
    expect(files.bundle!.tooLarge).toBe(true)
    expect(await portableHash(JSON.parse(files.bundle!.json))).toBe(expected)
  }, 60_000)

  it('flags the download as too large exactly above 25 MiB of serialized bytes', async () => {
    const sources = Array.from({ length: 5 }, (_, index) => ({ id: `cal-${index}`, name: `C${index}`, kind: 'file' as const, colorKey: 'blue' as const }))
    const document = { ...createEmptyDocument({ now: fixedNow(), locale: 'en', timeZone: 'UTC', idGen: () => 'ws' }), calendarSources: sources }
    async function filesOfBytes(extra: number) {
      const texts = (lengths: number[]) => Object.fromEntries(sources.map((source, index) => [source.id, 'x'.repeat(lengths[index]!)]))
      const copyOf = async (calendarSourceTexts: Record<string, string>) => {
        const copy: PreUpgradeCopy = { capturedAt: fixedNow().toISOString(), fromVersion: 1, raw: { document: JSON.stringify(document), meta: {} }, calendarSourceTexts, calendarsComplete: true, portableHash: null }
        copy.portableHash = await portableHash(buildExportBundle(document, calendarSourceTexts, { now: () => new Date(copy.capturedAt) }))
        return preUpgradeFiles(copy)
      }
      const overhead = (await copyOf(texts([0, 0, 0, 0, 0]))).bundle!.bytes
      let remaining = MAX_IMPORT_BYTES + extra - overhead
      const lengths = sources.map(() => { const length = Math.min(remaining, 5 * 1024 * 1024); remaining -= length; return length })
      return copyOf(texts(lengths))
    }
    const exact = await filesOfBytes(0)
    expect(exact.bundle!.bytes).toBe(MAX_IMPORT_BYTES)
    expect(exact.bundle!.tooLarge).toBe(false)
    const over = await filesOfBytes(1)
    expect(over.bundle!.bytes).toBe(MAX_IMPORT_BYTES + 1)
    expect(over.bundle!.tooLarge).toBe(true)
  }, 60_000)
})

describe('F-06: a calendar read failure during capture aborts the upgrade', () => {
  it('keeps both databases at version 1, unchanged, shows the read-only error screen, and Retry completes the copy', async () => {
    const { factory, lock, document } = await seeded()
    const before = await dumpDatabases(factory)
    const get = IDBObjectStore.prototype.get
    let failing = true
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (failing && this.name === 'sources' && key === 'cal-nonascii') throw new DOMException('injected read failure', 'UnknownError')
      return get.call(this, key)
    })
    const fresh = newBuild(factory, lock)
    const { planner, pinia } = configurePlanner(fresh, () => ics('unused'))
    await planner.load()
    expect(await databaseVersion(factory, PLANNER_DATABASE)).toBe(1)
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(1)
    expect(await dumpDatabases(factory)).toBe(before)
    expect(planner.status).toBe('readonly')
    expect(planner.error).toBe(UPGRADE_COPY_FAILED)
    expect(planner.document?.workspaceId).toBe(document.workspaceId)
    expect((await planner.commit((draft) => { draft.categories = [] })).ok).toBe(false)

    i18n.global.locale.value = 'en'
    const host = window.document.createElement('div')
    window.document.body.append(host)
    const screen = createApp(StorageErrorScreen).use(pinia).use(i18n)
    screen.mount(host)
    await nextTick()
    expect(host.textContent).toContain("The update couldn't be prepared safely; your data didn't change.")
    expect([...host.querySelectorAll('button')].map((button) => button.textContent?.trim())).toEqual(['Export a copy', 'Try again'])

    // The read would work now, but exporting never re-runs the upgrade: it writes nothing and says what is missing.
    failing = false
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    ;[...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Export a copy')!.click()
    await vi.waitFor(() => expect(click).toHaveBeenCalled())
    await nextTick()
    expect(host.textContent).toContain('Some calendar texts could not be read, so they were exported empty.')
    expect(await dumpDatabases(factory)).toBe(before)

    ;[...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Try again')!.click()
    await vi.waitFor(() => expect(planner.status).toBe('ready'))
    screen.unmount()
    host.remove()
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(STORAGE_VERSION)
    expect((await readCopy(factory))!.calendarSourceTexts).toEqual(SEED_TEXTS)
  })
})

describe('F-07: an upgrade interrupted between the two databases', () => {
  it('finishes the calendar upgrade before any repository call, keeps the copy, and an old tab can only delete a text the copy holds', async () => {
    const { factory, lock, old } = await seeded()
    // The page dies after the planner upgrade (step 4), before the calendar upgrade (step 5).
    const open = IDBFactory.prototype.open
    const killed = vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function (this: IDBFactory, name: string, version?: number) {
      if (name === CALENDAR_DATABASE && version === STORAGE_VERSION) throw new DOMException('page killed', 'AbortError')
      return open.call(this, name, version)
    })
    await expect(newBuild(factory, lock).fence.ready()).rejects.toThrow('page killed')
    killed.mockRestore()
    expect(await databaseVersion(factory, PLANNER_DATABASE)).toBe(STORAGE_VERSION)
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(1)
    const copyAfterStep4 = JSON.stringify(await readCopy(factory))

    // An old tab in that window: it cannot load the planner, and its stale removeSource delete targets a text the
    // captured plan does not reference, whose bytes the copy already holds.
    expect(await settledOutcome(() => old.planner.load())).toBe('storage-error')
    await old.texts.delete(ORPHAN_ID)
    const copy = JSON.parse(copyAfterStep4) as PreUpgradeCopy
    expect(copy.calendarSourceTexts[ORPHAN_ID]).toBe(SEED_TEXTS[ORPHAN_ID])
    expect(JSON.parse(copy.raw.document as string).calendarSources.map((source: { id: string }) => source.id)).not.toContain(ORPHAN_ID)

    // Restart: the calendar database is upgraded before the repository resolves.
    const order: string[] = []
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function (this: IDBFactory, name: string, version?: number) {
      const request = open.call(this, name, version)
      if (name === CALENDAR_DATABASE && version === STORAGE_VERSION) request.addEventListener('upgradeneeded', () => order.push('calendars-upgraded'))
      return request
    })
    const restarted = newBuild(factory, lock)
    await restarted.planner.load().then(() => order.push('repository-resolved'))
    expect(order).toEqual(['calendars-upgraded', 'repository-resolved'])
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(STORAGE_VERSION)
    expect(JSON.stringify(await readCopy(factory))).toBe(copyAfterStep4)
    expect(await settledOutcome(() => old.texts.list())).toBe('storage-error')
  })
})

describe('F-08: the copy is written once', () => {
  it('a later fence bump upgrades both databases and leaves the copy byte-identical', async () => {
    const { factory, lock } = await seeded()
    await newBuild(factory, lock).fence.ready()
    const copy = JSON.stringify(await readCopy(factory))
    expect(copy).not.toBe(JSON.stringify(undefined))
    const later = newBuild(factory, lock, createStorageFence(factory, { lock, now: () => new Date('2027-01-01T00:00:00.000Z'), version: STORAGE_VERSION + 1 }))
    expect((await later.planner.load()).kind).toBe('ok')
    expect(await databaseVersion(factory, PLANNER_DATABASE)).toBe(STORAGE_VERSION + 1)
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(STORAGE_VERSION + 1)
    expect(JSON.stringify(await readCopy(factory))).toBe(copy)
  })
})

describe('F-09: delete-all erases the pre-upgrade copy and every unreferenced calendar text', () => {
  const SENTINELS = [...Object.keys(SEED_TEXTS), 'SENTINEL']

  async function upgraded() {
    const setup = await seeded()
    const fresh = newBuild(setup.factory, setup.lock)
    expect((await fresh.planner.load()).kind).toBe('ok')
    expect(await readCopy(setup.factory)).toBeDefined()
    const fresher = createEmptyDocument({ now: fixedNow(), locale: 'en', timeZone: 'UTC', idGen: () => 'ws-fresh' })
    return { ...setup, fresh, fresher: { ...fresher, revision: 3 } }
  }

  function expectErased(dump: string): void {
    const parsed = JSON.parse(dump)
    expect(parsed[PLANNER_DATABASE].stores.snapshots).toEqual([])
    const metaKeys = parsed[PLANNER_DATABASE].stores.meta.map(([key]: [string]) => key)
    expect(metaKeys.filter((key: string) => key.startsWith('snap:') || key === 'restorePointer')).toEqual([])
    expect(parsed[CALENDAR_DATABASE].stores.sources).toEqual([])
    for (const sentinel of SENTINELS) expect([sentinel, dump.includes(sentinel)]).toEqual([sentinel, false])
  }

  it('leaves no snapshot, pointer, text or id of the deleted plan in either database', async () => {
    const { factory, fresh, fresher } = await upgraded()
    expect((await fresh.planner.deleteAll(fresher, 2)).kind).toBe('ok')
    expectErased(await dumpDatabases(factory))
  })

  it('a kill between the reset transaction and the calendar deletes is finished by the next load', async () => {
    const { factory, lock, fresh, fresher } = await upgraded()
    const remove = IDBObjectStore.prototype.delete
    const killed = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'sources') throw new DOMException('page killed', 'AbortError')
      return remove.call(this, key)
    })
    expect((await fresh.planner.deleteAll(fresher, 2)).kind).toBe('ok')
    killed.mockRestore()
    const interrupted = JSON.parse(await dumpDatabases(factory))
    expect(interrupted[PLANNER_DATABASE].stores.snapshots).toEqual([])
    expect(interrupted[CALENDAR_DATABASE].stores.sources.length).toBe(Object.keys(SEED_TEXTS).length)
    await newBuild(factory, lock).planner.load()
    expectErased(await dumpDatabases(factory))
  })

  for (const [failing, inject] of [
    ['clearing the snapshots store', (store: IDBObjectStore) => store.name === 'snapshots'],
    ['writing the purge record', (store: IDBObjectStore, method: string, key?: unknown) => store.name === 'meta' && method === 'put' && key === 'purge'],
  ] as const) {
    it(`an aborted reset transaction (${failing}) changes neither database, and a retry completes the erasure`, async () => {
      const { factory, fresh, fresher } = await upgraded()
      const before = await dumpDatabases(factory)
      const clear = IDBObjectStore.prototype.clear
      const put = IDBObjectStore.prototype.put
      vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
        if (inject(this, 'clear')) throw new DOMException('injected', 'UnknownError')
        return clear.call(this)
      })
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (inject(this, 'put', key)) throw new DOMException('injected', 'UnknownError')
        return put.call(this, value, key)
      })
      const result = await fresh.planner.deleteAll(fresher, 2)
      expect(result.kind).toBe('error')
      expect(await dumpDatabases(factory)).toBe(before)
      vi.restoreAllMocks()
      expect((await fresh.planner.deleteAll(fresher, 2)).kind).toBe('ok')
      expectErased(await dumpDatabases(factory))
    })
  }
})

describe('the fence never fails open', () => {
  it('refuses to upgrade from inside a commit-lock hold of this page instead of waiting for itself', async () => {
    const factory = new IDBFactory()
    const fence = createStorageFence(factory, { lock: mutexRunner(), lockHeldInPage: () => true })
    await expect(fence.ready()).rejects.toMatchObject({ name: 'InvalidStateError' })
    expect(await factory.databases()).toEqual([])
  })

  it('a database upgraded by a newer build is never downgraded', async () => {
    const factory = new IDBFactory()
    await createStorageFence(factory, { version: STORAGE_VERSION + 1 }).ready()
    const before = await dumpDatabases(factory)
    await expect(createStorageFence(factory).open(PLANNER_DATABASE)).rejects.toMatchObject({ name: 'VersionError' })
    expect(await dumpDatabases(factory)).toBe(before)
  })

  it('a fresh device gets both databases with no copy', async () => {
    const factory = new IDBFactory()
    const fresh = newBuild(factory, mutexRunner())
    expect((await fresh.planner.load()).kind).toBe('empty')
    expect(await readCopy(factory)).toBeUndefined()
    expect(await fresh.planner.preUpgradeCopy()).toBeUndefined()
  })
})

