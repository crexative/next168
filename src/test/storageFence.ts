// Test support for the storage fence: the real pre-fence repositories (the `@old/*` alias, see config/preFence.ts)
// and a canonical dump of every record of every IndexedDB database.
import { IDBObjectStore } from 'fake-indexeddb'
import { vi } from 'vitest'
import type { CalendarSource, ProposalInput } from '@/core/model'
import type * as PlannerModule from '@/repositories/BrowserPlannerRepository'
import type * as ProposalModule from '@/repositories/BrowserProposalRepository'
import type * as StoreModule from '@/repositories/indexedDbStore'
import type * as CalendarStoreModule from '@/features/calendars/calendarSourceStore'
import type * as SupportModule from '@/repositories/testSupport'
import type * as FenceModule from '@/repositories/storageVersion'
import type { RunExclusive } from '@/repositories/storageCommit'
import { fixedNow, mutexRunner } from '@/repositories/testSupport'

// A variable specifier keeps TypeScript from resolving the pre-fence tree, which exists only once Vitest set it up.
async function preFence<T>(path: string): Promise<T> {
  const specifier = `@old/${path}`
  return (await import(/* @vite-ignore */ specifier)) as T
}

export async function preFenceSource(path: string): Promise<string> {
  const specifier = `@old/${path}?raw`
  return ((await import(/* @vite-ignore */ specifier)) as { default: string }).default
}

let oldIds = 0

// The pre-fence build's repositories, on `factory`, taking the shared commit `lock` like a second tab would.
export async function preFenceBuild(factory: IDBFactory, lock: RunExclusive) {
  const [{ IndexedDbStore }, { IndexedDbCalendarSourceStore }, { BrowserPlannerRepository }, { BrowserProposalRepository }, support] = await Promise.all([
    preFence<typeof StoreModule>('repositories/indexedDbStore'),
    preFence<typeof CalendarStoreModule>('features/calendars/calendarSourceStore'),
    preFence<typeof PlannerModule>('repositories/BrowserPlannerRepository'),
    preFence<typeof ProposalModule>('repositories/BrowserProposalRepository'),
    preFence<typeof SupportModule>('repositories/testSupport'),
  ])
  const store = new IndexedDbStore(factory)
  const texts = new IndexedDbCalendarSourceStore(factory)
  const bus = new support.MemoryChannelBus()
  const newId = () => `old-${++oldIds}`
  const planner = new BrowserPlannerRepository({
    store, legacy: new support.MemoryStorage(), runExclusive: lock, channel: bus.channel(), events: new EventTarget(),
    calendarTexts: texts, now: fixedNow, newId, locale: () => 'en', timeZone: () => 'UTC',
  })
  const proposals = new BrowserProposalRepository({ store, runExclusive: lock, channel: bus.channel(), now: fixedNow, newId })
  // Documents in the pre-fence build's own schema (version 2).
  return { store, texts, planner, proposals, testDocument: support.testDocument }
}

export type PreFenceBuild = Awaited<ReturnType<typeof preFenceBuild>>

// The last build fenced at storage version 2 (d325df4, `@fencedV2/*`): its repositories on `factory`, behind its own
// fence, taking the shared commit `lock` like a second tab would.
export async function fencedV2Build(factory: IDBFactory, lock: RunExclusive) {
  const load = <T>(path: string) => import(/* @vite-ignore */ `@fencedV2/${path}`) as Promise<T>
  const [{ IndexedDbStore }, { IndexedDbCalendarSourceStore }, { BrowserPlannerRepository }, { BrowserProposalRepository }, fencing, support] = await Promise.all([
    load<typeof StoreModule>('repositories/indexedDbStore'),
    load<typeof CalendarStoreModule>('features/calendars/calendarSourceStore'),
    load<typeof PlannerModule>('repositories/BrowserPlannerRepository'),
    load<typeof ProposalModule>('repositories/BrowserProposalRepository'),
    load<typeof FenceModule>('repositories/storageVersion'),
    load<typeof SupportModule>('repositories/testSupport'),
  ])
  const fence = fencing.createStorageFence(factory, { lock, now: fixedNow })
  const store = new IndexedDbStore(factory, fence)
  const texts = new IndexedDbCalendarSourceStore(factory, fence)
  const bus = new support.MemoryChannelBus()
  const newId = () => `v2-${++oldIds}`
  const planner = new BrowserPlannerRepository({
    store, legacy: new support.MemoryStorage(), runExclusive: lock, channel: bus.channel(), events: new EventTarget(),
    calendarTexts: texts, now: fixedNow, newId, locale: () => 'en', timeZone: () => 'UTC',
  })
  const proposals = new BrowserProposalRepository({ store, runExclusive: lock, channel: bus.channel(), now: fixedNow, newId })
  return { fence, store, texts, planner, proposals, testDocument: support.testDocument, storageVersion: fencing.STORAGE_VERSION }
}

export async function fencedV2Source(path: string): Promise<string> {
  const specifier = `@fencedV2/${path}?raw`
  return ((await import(/* @vite-ignore */ specifier)) as { default: string }).default
}

export function ics(title: string, padding = ''): string {
  const head = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//next168//fence//EN\r\nBEGIN:VEVENT\r\nUID:${title.replace(/\W/g, '')}@fence\r\n`
  const tail = `DTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
  return padding ? `${head}X-PADDING:${padding}\r\n${tail}` : head + tail
}

// An ICS text of exactly `bytes` UTF-8 bytes (ASCII padding).
export function icsOfBytes(title: string, bytes: number): string {
  const base = new TextEncoder().encode(ics(title, 'x')).length - 1
  return ics(title, 'p'.repeat(bytes - base - 'X-PADDING:\r\n'.length))
}

export const SOURCES: CalendarSource[] = [
  { id: 'cal-url', name: 'Team feed', kind: 'url', url: 'https://example.invalid/team.ics', colorKey: 'blue', lastSyncedAt: '2026-10-20T08:00:00.000Z' },
  { id: 'cal-file', name: 'Holidays', kind: 'file', colorKey: 'green' },
  { id: 'cal-nonascii', name: 'Café 日本', kind: 'file', colorKey: 'purple' },
]
export const ORPHAN_ID = 'cal-orphan'
export const SEED_TEXTS: Record<string, string> = {
  'cal-url': ics('SENTINEL-url-original'),
  'cal-file': ics('SENTINEL-file'),
  'cal-nonascii': ics('SENTINEL-nonascii Reunión café ☕ 日本語 ñandú'),
  [ORPHAN_ID]: ics('SENTINEL-orphan'),
}
export const CATEGORY = { id: 'c-sentinel', name: 'SENTINEL-category', colorKey: 'blue' as const, goal: { type: 'max' as const, hoursPerWeek: 40 } }

// The pre-fence build seeds a plan with calendar sources, an orphan text, a backup and a pending proposal.
export async function seedWithPreFenceBuild(old: PreFenceBuild, texts: Record<string, string> = SEED_TEXTS, sources: CalendarSource[] = SOURCES) {
  for (const [id, text] of Object.entries(texts)) await old.texts.put(id, text)
  const first = old.testDocument({ revision: 1, categories: [CATEGORY], calendarSources: sources })
  expectOk(await old.planner.save(first, 0))
  const second = { ...first, revision: 2, blocks: [{ id: 'b-sentinel', categoryId: CATEGORY.id, title: 'SENTINEL-block', days: [1], start: 540, end: 600 }] }
  expectOk(await old.planner.save(second as typeof first, 1))
  const input: ProposalInput = {
    contractVersion: '1.0', workspaceId: first.workspaceId, baseRevision: 2, summary: 'SENTINEL-proposal',
    ops: [{ op: 'add_block', block: { categoryId: CATEGORY.id, title: 'Focus', days: [2], start: 540, end: 600 } }],
  }
  const proposal = await old.proposals.create(input, 'mcp')
  return { document: second, proposal }
}

function expectOk(result: { kind: string }): void {
  if (result.kind !== 'ok') throw new Error(`seed failed: ${JSON.stringify(result)}`)
}

function request<T>(make: () => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const pending = make()
    pending.onsuccess = () => resolve(pending.result)
    pending.onerror = () => reject(pending.error)
  })
}

// Every record (key and value) of every store, read on `db` in one transaction.
export async function dumpConnection(db: IDBDatabase): Promise<Record<string, [IDBValidKey, unknown][]>> {
  const names = [...db.objectStoreNames].sort()
  const stores: Record<string, [IDBValidKey, unknown][]> = {}
  if (names.length === 0) return stores
  const transaction = db.transaction(names, 'readonly')
  for (const name of names) {
    const store = transaction.objectStore(name)
    const [keys, values] = await Promise.all([request(() => store.getAllKeys()), request(() => store.getAll())])
    stores[name] = keys.map((key, index) => [key, values[index]])
  }
  return stores
}

// A canonical dump of every database: name, version and every record. Opening without a version never upgrades.
export async function dumpDatabases(factory: IDBFactory, names?: string[]): Promise<string> {
  const existing = (await factory.databases()).map((database) => database.name!).sort()
  const dump: Record<string, unknown> = {}
  for (const name of names ?? existing) {
    if (!existing.includes(name)) { dump[name] = null; continue }
    const db = await request(() => factory.open(name))
    try {
      dump[name] = { version: db.version, stores: await dumpConnection(db) }
    } finally {
      db.close()
    }
  }
  return JSON.stringify(dump)
}

export async function databaseVersion(factory: IDBFactory, name: string): Promise<number> {
  if (!(await factory.databases()).some((database) => database.name === name)) return 0
  const db = await request(() => factory.open(name))
  db.close()
  return db.version
}

export interface StoreCall { method: string; database: string; store: string; mode: IDBTransactionMode; key?: unknown }

// Records every write request (put, add, delete, clear) and every read request made on any object store.
// With `events`, each call is also logged there in order, as `read:<database>` or `write:<database>:<mode>`.
export function spyStoreCalls(events?: string[]): { writes: StoreCall[]; reads: StoreCall[] } {
  const writes: StoreCall[] = []
  const reads: StoreCall[] = []
  for (const method of ['put', 'add', 'delete', 'clear', 'get', 'getAll', 'getAllKeys'] as const) {
    const original = IDBObjectStore.prototype[method] as (...args: unknown[]) => IDBRequest
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
      const call: StoreCall = {
        method, database: this.transaction.db.name, store: this.name, mode: this.transaction.mode,
        key: method === 'put' || method === 'add' ? args[1] : args[0],
      }
      const isRead = ['get', 'getAll', 'getAllKeys'].includes(method)
      ;(isRead ? reads : writes).push(call)
      events?.push(isRead ? `read:${call.database}` : `write:${call.database}:${call.mode}`)
      return original.apply(this, args)
    } as never)
  }
  return { writes, reads }
}

// The shared commit lock (Web Locks across tabs), recording when the fence holds it.
export function recordingLock(events: string[]): RunExclusive {
  const mutex = mutexRunner()
  return <T>(task: () => Promise<T>) => mutex(async () => {
    events.push('lock-acquired')
    try {
      return await task()
    } finally {
      events.push('lock-released')
    }
  })
}
