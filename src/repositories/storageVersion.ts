// The storage fence. Both IndexedDB databases open at STORAGE_VERSION, so every build that opens them at an older
// explicit version (all pre-fence builds open version 1) fails with `VersionError` and writes nothing.
//
// The first upgrade from version 1 first reads everything both databases hold, under the commit lock, and stores that
// complete pre-upgrade copy inside the planner database's versionchange transaction: all of it commits, or neither
// database changes. If any read fails, nothing is upgraded and the planner opens read-only from version 1.
import { buildExportBundle, portableHash } from '@/core/exportBundle'
import type { ExportBundle } from '@/core/model'
import { parseDocument } from './core'
import { commitLockHeldInPage, webLockRunner, type RunExclusive } from './storageCommit'

// Increment it in every change that adds a storage invariant older writers cannot keep, so they are fenced out.
export const STORAGE_VERSION = 2
// Restore steps run only on a connection at least this new (slice 1A raises both constants together).
export const RESTORE_MIN_STORAGE_VERSION = 2
// Upgrading from below this version is the first upgrade: the only one that takes the pre-upgrade copy.
const FIRST_FENCED_VERSION = 2

export const PLANNER_DATABASE = 'next168'
export const CALENDAR_DATABASE = 'next168-calendars'
export const PLANNER_STORES = ['document', 'backup', 'proposals', 'meta', 'snapshots'] as const
export const CALENDAR_STORE = 'sources'
export const SNAPSHOTS_STORE = 'snapshots'
export const PRE_UPGRADE_COPY_KEY = 'pre-v3'
export const UPGRADE_COPY_FAILED = 'upgrade-copy-failed'
export const RESTORE_UNFENCED = 'restore-unfenced'

export type FencedDatabase = typeof PLANNER_DATABASE | typeof CALENDAR_DATABASE

// The planner records exactly as version 1 stored them (strings or structured values), plus every calendar text,
// including texts the document does not reference.
export interface PreUpgradeCopy {
  capturedAt: string
  fromVersion: number
  raw: { document?: unknown; backup?: unknown; proposals?: unknown; meta: Record<string, unknown> }
  calendarSourceTexts: Record<string, string>
  calendarsComplete: true
  portableHash: string | null
}

// A capture read failed: nothing was upgraded. `document` is the raw planner document read at version 1, if any,
// so the planner can still be shown read-only and exported.
export class UpgradeCopyFailedError extends Error {
  constructor(readonly reason: unknown, readonly document: unknown) {
    super(UPGRADE_COPY_FAILED)
    this.name = 'UpgradeCopyFailedError'
  }
}

export function restoreFenceRefusal(connection: Pick<IDBDatabase, 'version'>): typeof RESTORE_UNFENCED | undefined {
  return connection.version >= RESTORE_MIN_STORAGE_VERSION ? undefined : RESTORE_UNFENCED
}

export interface FenceOptions {
  // The commit lock every pre-fence writer takes (Web Locks `next168-commit`).
  lock?: RunExclusive
  // True while a task of this page holds that lock: upgrading then would wait for itself, so it fails closed.
  lockHeldInPage?: () => boolean
  now?: () => Date
  // Tests simulate a later bump; the app always uses STORAGE_VERSION.
  version?: number
}

export interface StorageFence {
  readonly version: number
  // Resolves once both databases are at `version`; repositories are usable only after it. After a failed upgrade it
  // keeps failing (an export or any other read never re-runs the upgrade) until `retry`.
  ready(): Promise<void>
  // Runs the upgrade again after a failure: the planner's load (and its Retry) calls it.
  retry(): Promise<void>
  open(name: FencedDatabase): Promise<IDBDatabase>
  // Whether an upgrade is waiting for older connections (another tab) to close.
  waiting(): boolean
  onWaiting(listener: (waiting: boolean) => void): () => void
}

// An in-page lock for browsers without Web Locks. It is enough there: without Web Locks no build can write at all
// (every pre-fence and fenced write path requires the commit lock), so only this page's own upgrade must be serialized.
function inPageLock(): RunExclusive {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

function failure(name: string, message: string): DOMException {
  return new DOMException(message, name)
}

// The version of a database, or 0 when it does not exist. Opening without a version would create a missing database,
// so that creation is aborted, which leaves no database behind.
function probeVersion(factory: IDBFactory, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name)
    let creating = false
    request.onupgradeneeded = () => {
      creating = true
      request.transaction?.abort()
    }
    request.onsuccess = () => {
      const { version } = request.result
      request.result.close()
      resolve(version)
    }
    request.onerror = (event) => {
      if (!creating) return reject(request.error ?? failure('UnknownError', 'probe failed'))
      event.preventDefault()
      resolve(0)
    }
  })
}

// Opens an existing database at its current version (never an upgrade) for the capture reads.
function openExisting(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? failure('UnknownError', 'open failed'))
    request.onblocked = () => reject(failure('UnknownError', 'capture open blocked'))
  })
}

// Every key and value of one store, read as `getAllKeys` then one `get` per key.
function readStore(db: IDBDatabase, store: string): Promise<Map<IDBValidKey, unknown>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<IDBValidKey, unknown>()
    let cause: unknown
    const fail = (error: unknown) => {
      cause ??= error
      try { transaction.abort() } catch { /* Already finished: onabort reports it. */ }
    }
    const transaction = db.transaction(store, 'readonly')
    transaction.oncomplete = () => (cause === undefined ? resolve(entries) : reject(cause))
    transaction.onabort = () => reject(cause ?? transaction.error ?? failure('AbortError', 'capture read aborted'))
    try {
      const objectStore = transaction.objectStore(store)
      const keys = objectStore.getAllKeys()
      keys.onerror = () => { cause ??= keys.error }
      keys.onsuccess = () => {
        try {
          for (const key of keys.result) {
            const request = objectStore.get(key)
            request.onerror = () => { cause ??= request.error }
            request.onsuccess = () => { entries.set(key, request.result) }
          }
        } catch (error) { fail(error) }
      }
    } catch (error) { fail(error) }
  })
}

async function readDatabase(factory: IDBFactory, name: string, version: number, stores: readonly string[]): Promise<Record<string, Map<IDBValidKey, unknown>>> {
  const db = await openExisting(factory, name, version)
  try {
    const result: Record<string, Map<IDBValidKey, unknown>> = {}
    for (const store of stores) result[store] = db.objectStoreNames.contains(store) ? await readStore(db, store) : new Map()
    return result
  } finally {
    db.close()
  }
}

// The export bundle of a pre-upgrade copy: its document with the texts that document references (a missing text is
// exported empty, as every export does). Null when the stored document does not parse.
export function preUpgradeBundle(copy: PreUpgradeCopy): ExportBundle | null {
  if (typeof copy.raw.document !== 'string') return null
  const parsed = parseDocument(copy.raw.document)
  if (parsed.kind !== 'ok') return null
  const texts = Object.fromEntries(parsed.document.calendarSources.map((source) => [source.id, copy.calendarSourceTexts[source.id] ?? '']))
  try {
    return buildExportBundle(parsed.document, texts, { now: () => new Date(copy.capturedAt) })
  } catch {
    return null
  }
}

// Reads both databases at their current versions. Undefined when there is nothing to keep.
async function capturePreUpgradeCopy(
  factory: IDBFactory, versions: { planner: number; calendars: number }, now: () => Date,
): Promise<PreUpgradeCopy | undefined> {
  let document: unknown
  try {
    const planner = versions.planner === 0 ? undefined : await readDatabase(factory, PLANNER_DATABASE, versions.planner, ['document', 'backup', 'proposals', 'meta'])
    document = planner?.document?.get('current')
    const calendars = versions.calendars === 0 ? undefined : await readDatabase(factory, CALENDAR_DATABASE, versions.calendars, [CALENDAR_STORE])
    const calendarSourceTexts: Record<string, string> = {}
    for (const [key, text] of calendars?.[CALENDAR_STORE] ?? []) calendarSourceTexts[String(key)] = text as string
    const meta = Object.fromEntries([...(planner?.meta ?? new Map())].map(([key, value]) => [String(key), value]))
    const raw = { document, backup: planner?.backup?.get('current'), proposals: planner?.proposals?.get('all'), meta }
    const empty = raw.document === undefined && raw.backup === undefined && raw.proposals === undefined
      && Object.keys(meta).length === 0 && Object.keys(calendarSourceTexts).length === 0
    if (empty) return undefined
    const copy: PreUpgradeCopy = {
      capturedAt: now().toISOString(), fromVersion: versions.planner, raw, calendarSourceTexts, calendarsComplete: true, portableHash: null,
    }
    const bundle = preUpgradeBundle(copy)
    copy.portableHash = bundle ? await portableHash(bundle) : null
    return copy
  } catch (error) {
    throw new UpgradeCopyFailedError(error, document)
  }
}

type Upgrade = (db: IDBDatabase, transaction: IDBTransaction, oldVersion: number) => void

function createMissingStores(db: IDBDatabase, stores: readonly string[]): void {
  for (const store of stores) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
}

// Opens `name` at `version`, running `upgrade` inside the versionchange transaction. A blocked open stays pending
// (it never fails open) until the older connections close.
function openAt(factory: IDBFactory, name: string, version: number, upgrade: Upgrade, setWaiting: (waiting: boolean) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version)
    let cause: unknown
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction!
      try {
        upgrade(request.result, transaction, event.oldVersion)
      } catch (error) {
        cause ??= error
        transaction.abort()
      }
    }
    request.onblocked = () => setWaiting(true)
    request.onsuccess = () => {
      setWaiting(false)
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => {
      setWaiting(false)
      reject(cause ?? request.error ?? failure('UnknownError', 'open failed'))
    }
  })
}

async function upgradeAll(factory: IDBFactory, version: number, now: () => Date, setWaiting: (waiting: boolean) => void): Promise<void> {
  const planner = await probeVersion(factory, PLANNER_DATABASE)
  const calendars = await probeVersion(factory, CALENDAR_DATABASE)
  // Never downgrade: a newer build's data stays untouched, and this build reports a storage error.
  if (planner > version || calendars > version) throw failure('VersionError', 'storage was upgraded by a newer version')
  if (planner < version) {
    const copy = planner < FIRST_FENCED_VERSION ? await capturePreUpgradeCopy(factory, { planner, calendars }, now) : undefined
    let db: IDBDatabase
    try {
      db = await openAt(factory, PLANNER_DATABASE, version, (upgrading, transaction, oldVersion) => {
        createMissingStores(upgrading, PLANNER_STORES)
        // `add` fails on an existing key, which aborts the whole upgrade: the copy is written once and never replaced.
        if (copy && oldVersion < FIRST_FENCED_VERSION) transaction.objectStore(SNAPSHOTS_STORE).add(copy, PRE_UPGRADE_COPY_KEY)
      }, setWaiting)
    } catch (error) {
      // The versionchange transaction aborted (quota, for example): nothing changed, so the planner opens read-only
      // from version 1 exactly as after a failed read.
      if (planner < FIRST_FENCED_VERSION) throw new UpgradeCopyFailedError(error, copy?.raw.document)
      throw error
    }
    db.close()
  }
  // Also finishes an upgrade interrupted after the planner database, before any repository can write.
  if (calendars < version) {
    const db = await openAt(factory, CALENDAR_DATABASE, version, (upgrading) => createMissingStores(upgrading, [CALENDAR_STORE]), setWaiting)
    db.close()
  }
}

const SCHEMA: Record<FencedDatabase, readonly string[]> = { [PLANNER_DATABASE]: PLANNER_STORES, [CALENDAR_DATABASE]: [CALENDAR_STORE] }

// A database below `version` found after this page upgraded (an older build recreated it): the fence runs again.
class FenceReset extends Error {}

export function createStorageFence(factory: IDBFactory | undefined, options: FenceOptions = {}): StorageFence {
  const version = options.version ?? STORAGE_VERSION
  const lock = options.lock ?? inPageLock()
  const now = options.now ?? (() => new Date())
  let upgraded = false
  let pending: Promise<void> | undefined
  let failed: { error: unknown } | undefined
  let isWaiting = false
  const listeners = new Set<(waiting: boolean) => void>()
  const setWaiting = (next: boolean) => {
    if (next === isWaiting) return
    isWaiting = next
    for (const listener of listeners) listener(next)
  }

  function ready(): Promise<void> {
    if (upgraded) return Promise.resolve()
    if (!factory) return Promise.reject(failure('UnknownError', 'indexedDB missing'))
    if (failed) return Promise.reject(failed.error)
    if (options.lockHeldInPage?.()) return Promise.reject(failure('InvalidStateError', 'storage fence not ready inside the commit lock'))
    pending ??= lock(() => upgradeAll(factory, version, now, setWaiting)).then(
      () => { upgraded = true },
      (error: unknown) => { pending = undefined; failed = { error }; throw error },
    )
    return pending
  }

  function openUpgraded(name: FencedDatabase): Promise<IDBDatabase> {
    return openAt(factory!, name, version, (db, transaction, oldVersion) => {
      if (oldVersion !== 0) throw new FenceReset()
      createMissingStores(db, SCHEMA[name])
    }, setWaiting)
  }

  return {
    version,
    ready,
    retry() {
      failed = undefined
      return ready()
    },
    async open(name) {
      await ready()
      try {
        return await openUpgraded(name)
      } catch (error) {
        if (!(error instanceof FenceReset)) throw error
        upgraded = false
        await ready()
        return openUpgraded(name)
      }
    },
    waiting: () => isWaiting,
    onWaiting(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const fences = new WeakMap<IDBFactory, StorageFence>()

// The page's commit lock: the same Web Lock every repository and every pre-fence build takes.
function pageFenceOptions(): FenceOptions {
  const lock = webLockRunner(typeof navigator === 'undefined' ? undefined : navigator.locks)
  return lock ? { lock, lockHeldInPage: commitLockHeldInPage } : {}
}

// One fence per IndexedDB factory, so every store of the page shares one upgrade.
export function fenceFor(factory: IDBFactory | undefined): StorageFence {
  if (!factory) return createStorageFence(undefined)
  let fence = fences.get(factory)
  if (!fence) {
    fence = createStorageFence(factory, pageFenceOptions())
    fences.set(factory, fence)
  }
  return fence
}

export function openFenced(name: FencedDatabase, fence: StorageFence = fenceFor(globalThis.indexedDB)): Promise<IDBDatabase> {
  return fence.open(name)
}
