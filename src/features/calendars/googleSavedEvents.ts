import type { ExternalOccurrence } from '@/core/model'
import { GOOGLE_SOURCE_ID, fitsGoogleTitle, type GoogleCoverage } from './googleCalendar'

// The on-device copy of the last complete Google Calendar read, so reopening Weeklid shows those events at once.
// It is its own IndexedDB database, outside the planner document: exports, backups, the pre-upgrade copy and the
// companion never see it. It holds only the occurrences the overlay draws, the window they cover and the planner they
// were read for. Never the token, the granted scopes, an address or anything else Google sent.
//
// Deletion wins over a write that started before it, in any tab: every deletion stores a new random epoch, and a
// write lands only while the stored epoch is still the one this tab last knew. A tab learns a newer epoch only when
// it already forgot what it had read under the older one (Disconnect broadcasts it; a planner or zone change re-reads
// it), so a late write can never bring deleted events back.

export const SAVED_GOOGLE_DATABASE = 'next168-google'
const STORE = 'saved'
const COPY_KEY = 'primary'
const EPOCH_KEY = 'epoch'
const FORMAT = 1
// What one complete read can hold: at most 8 pages of 250 events.
export const MAX_SAVED_OCCURRENCES = 2000
const MAX_TEXT = 1024
const EPOCH = /^[A-Za-z0-9-]{1,64}$/

// The planner a copy belongs to: shown only while all three still match.
export interface SavedBinding { workspaceId: string; plannerGeneration: number; timeZone: string }

export interface SavedGoogleEvents {
  format: typeof FORMAT
  workspaceId: string
  plannerGeneration: number
  coverage: GoogleCoverage
  occurrences: ExternalOccurrence[]
}

export interface SavedGoogleEventsPort {
  // The copy bound to this planner and zone, if any. A copy for anything else (or one that cannot be read) is
  // deleted on the way.
  loadMatching(binding: SavedBinding): Promise<SavedGoogleEvents | undefined>
  // Replaces the copy, unless a deletion happened in any tab since this tab last synchronised.
  save(copy: SavedGoogleEvents): Promise<'saved' | 'refused'>
  // Deletes the copy. Returns the new epoch at once (for the broadcast); the deletion itself is queued.
  discard(): string
  // Another tab deleted the copy and said so: its epoch is now the one this tab knows.
  adopt(epoch: unknown): void
  // Delete all data: the whole database goes (nothing is created where there was none), in any build.
  erase(): Promise<void>
  // Resolves when every queued operation of this tab has finished.
  settled(): Promise<void>
}

const isText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max
const CIVIL = /^\d{4}-\d{2}-\d{2}$/

function hasOnly(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function validOccurrence(item: unknown): item is ExternalOccurrence {
  if (typeof item !== 'object' || item === null) return false
  const value = item as Record<string, unknown>
  return hasOnly(value, ['sourceId', 'uid', 'recurrenceId', 'title', 'start', 'end', 'allDay', 'busy'])
    && value.sourceId === GOOGLE_SOURCE_ID && isText(value.uid) && (value.recurrenceId === undefined || isText(value.recurrenceId))
    && fitsGoogleTitle(value.title) && isText(value.start, 64) && isText(value.end, 64)
    && typeof value.allDay === 'boolean' && typeof value.busy === 'boolean'
}

function validCoverage(value: unknown): value is GoogleCoverage {
  if (typeof value !== 'object' || value === null) return false
  const coverage = value as Record<string, unknown>
  return hasOnly(coverage, ['start', 'end', 'timeZone', 'fetchedAt'])
    && typeof coverage.start === 'string' && CIVIL.test(coverage.start) && typeof coverage.end === 'string' && CIVIL.test(coverage.end)
    && isText(coverage.timeZone, 64) && typeof coverage.fetchedAt === 'string' && Number.isFinite(Date.parse(coverage.fetchedAt))
}

export function validSavedCopy(value: unknown): value is SavedGoogleEvents {
  if (typeof value !== 'object' || value === null) return false
  const copy = value as Record<string, unknown>
  return hasOnly(copy, ['format', 'workspaceId', 'plannerGeneration', 'coverage', 'occurrences'])
    && copy.format === FORMAT && isText(copy.workspaceId, 128) && Number.isInteger(copy.plannerGeneration)
    && validCoverage(copy.coverage) && Array.isArray(copy.occurrences) && copy.occurrences.length <= MAX_SAVED_OCCURRENCES
    && copy.occurrences.every(validOccurrence)
}

// Built field by field, so nothing else that might ride along on an occurrence is ever written.
export function savedCopyOf(binding: SavedBinding, coverage: GoogleCoverage, occurrences: readonly ExternalOccurrence[]): SavedGoogleEvents {
  return {
    format: FORMAT,
    workspaceId: binding.workspaceId,
    plannerGeneration: binding.plannerGeneration,
    coverage: { start: coverage.start, end: coverage.end, timeZone: coverage.timeZone, fetchedAt: coverage.fetchedAt },
    occurrences: occurrences.map((item) => ({
      sourceId: item.sourceId, uid: item.uid, ...(item.recurrenceId === undefined ? {} : { recurrenceId: item.recurrenceId }),
      title: item.title, start: item.start, end: item.end, allDay: item.allDay, busy: item.busy,
    })),
  }
}

function matches(copy: SavedGoogleEvents, binding: SavedBinding): boolean {
  return copy.workspaceId === binding.workspaceId && copy.plannerGeneration === binding.plannerGeneration && copy.coverage.timeZone === binding.timeZone
}

function newEpoch(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class IndexedDbSavedGoogleEvents implements SavedGoogleEventsPort {
  // The epoch this tab last synchronised with; undefined until it first read one, and then nothing is written.
  private known: string | undefined
  // Bumped whenever this tab sets the epoch itself; a read queued before that must not overwrite it.
  private localChanges = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  loadMatching(binding: SavedBinding): Promise<SavedGoogleEvents | undefined> {
    const changes = this.localChanges
    const learn = (epoch: string) => { if (this.localChanges === changes) this.known = epoch }
    return this.enqueue(() => this.transaction(async (store, done) => {
      const [copy, epoch] = await Promise.all([request(store.get(COPY_KEY)), request(store.get(EPOCH_KEY))])
      if (copy !== undefined && (!validSavedCopy(copy) || !matches(copy, binding))) {
        const next = newEpoch()
        store.delete(COPY_KEY)
        store.put(next, EPOCH_KEY)
        await done
        learn(next)
        return undefined
      }
      await done
      learn(typeof epoch === 'string' ? epoch : '')
      return copy as SavedGoogleEvents | undefined
    }))
  }

  save(copy: SavedGoogleEvents): Promise<'saved' | 'refused'> {
    // The epoch is the one known when the write runs (a first read queued before it has finished by then), unless
    // this tab deleted the copy or learned of a deletion after the write was asked for.
    const changes = this.localChanges
    return this.enqueue(() => this.transaction(async (store, done) => {
      const expected = this.localChanges === changes ? this.known : undefined
      if (expected === undefined || !validSavedCopy(copy)) return 'refused' as const
      const stored = await request(store.get(EPOCH_KEY))
      if ((typeof stored === 'string' ? stored : '') !== expected) return 'refused' as const
      store.put(copy, COPY_KEY)
      await done
      return 'saved' as const
    }))
  }

  discard(): string {
    const next = newEpoch()
    this.known = next
    this.localChanges += 1
    void this.enqueue(() => this.transaction(async (store, done) => {
      store.delete(COPY_KEY)
      store.put(next, EPOCH_KEY)
      await done
    }).catch(() => this.deleteDatabase())).catch(() => undefined)
    return next
  }

  erase(): Promise<void> {
    this.known = ''
    this.localChanges += 1
    return this.enqueue(() => this.deleteDatabase()).catch(() => undefined)
  }

  adopt(epoch: unknown): void {
    if (typeof epoch !== 'string' || !EPOCH.test(epoch)) return
    this.known = epoch
    this.localChanges += 1
  }

  settled(): Promise<void> {
    return this.queue.then(() => undefined, () => undefined)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async transaction<T>(work: (store: IDBObjectStore, done: Promise<void>) => Promise<T>): Promise<T> {
    const db = await this.open()
    try {
      const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' })
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new DOMException('aborted', 'AbortError'))
      })
      done.catch(() => undefined)
      const result = await work(transaction.objectStore(STORE), done)
      await done
      return result
    } finally {
      db.close()
    }
  }

  // The last resort when a deletion could not run as a transaction: the whole database goes.
  private deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.factory) return reject(new DOMException('indexedDB missing', 'UnknownError'))
      const deleting = this.factory.deleteDatabase(SAVED_GOOGLE_DATABASE)
      deleting.onsuccess = () => resolve()
      deleting.onerror = () => reject(deleting.error)
    })
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.factory
    if (!factory) return Promise.reject(new DOMException('indexedDB missing', 'UnknownError'))
    return new Promise((resolve, reject) => {
      const opening = factory.open(SAVED_GOOGLE_DATABASE, 1)
      opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains(STORE)) opening.result.createObjectStore(STORE) }
      opening.onsuccess = () => {
        const db = opening.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      opening.onerror = () => reject(opening.error ?? new DOMException('open failed', 'UnknownError'))
      opening.onblocked = () => reject(new DOMException('open blocked', 'UnknownError'))
    })
  }
}

function request<T>(read: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    read.onsuccess = () => resolve(read.result)
    read.onerror = () => reject(read.error)
  })
}

let shared: SavedGoogleEventsPort | undefined

// One per page, so every caller shares the epoch this tab knows.
export function savedGoogleEvents(): SavedGoogleEventsPort {
  return (shared ??= new IndexedDbSavedGoogleEvents())
}
