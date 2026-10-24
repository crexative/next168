import { STORAGE_KEYS, type CalendarSourceStore } from '@/core/model'
import { createEmptyDocument } from './core'
import { BrowserPlannerRepository } from './BrowserPlannerRepository'
import { BrowserProposalRepository } from './BrowserProposalRepository'
import type { ChangeChannel } from './changeChannel'
import { changedParts, type BrowserStore, type Change, type Snapshot, type StoredPart } from './indexedDbStore'
import type { RunExclusive, StorageLike } from './storageCommit'

// The legacy localStorage of older builds. `writes` counts setItem calls: the new code must never make one.
export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes++
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

// An atomic in-memory BrowserStore: every entry of a change is checked before any is applied.
export class MemoryStore implements BrowserStore {
  readonly data = new Map<StoredPart, unknown>()
  failWrites = false
  failWritesTo = new Set<StoredPart>()
  failReads = false
  writeTransactions = 0

  async read(parts: readonly StoredPart[]): Promise<Snapshot> {
    if (this.failReads) throw new DOMException('read failed', 'UnknownError')
    const snapshot: Record<string, unknown> = {}
    for (const part of parts) if (this.data.has(part)) snapshot[part] = structuredClone(this.data.get(part))
    return snapshot as Snapshot
  }

  async write(change: Change): Promise<void> {
    const parts = changedParts(change)
    if (parts.length === 0) return
    if (this.failWrites || parts.some((part) => this.failWritesTo.has(part))) throw new DOMException('quota', 'QuotaExceededError')
    this.writeTransactions++
    for (const part of parts) {
      const value = change[part]
      if (value === null) this.data.delete(part)
      else this.data.set(part, structuredClone(value))
    }
  }
}

export class MemoryCalendarTexts implements CalendarSourceStore {
  readonly data = new Map<string, string>()
  async get(sourceId: string): Promise<string | undefined> { return this.data.get(sourceId) }
  async put(sourceId: string, text: string): Promise<void> { this.data.set(sourceId, text) }
  async delete(sourceId: string): Promise<void> { this.data.delete(sourceId) }
  async list(): Promise<string[]> { return [...this.data.keys()] }
}

// Several "tabs" share one bus. `drop` loses messages, as a killed sender or a frozen receiver would.
export class MemoryChannelBus {
  private readonly listeners = new Set<() => void>()
  drop = false
  notifyFails = false

  channel(): ChangeChannel {
    const own = new Set<() => void>()
    return {
      notify: () => {
        if (this.notifyFails) throw new Error('channel closed')
        if (this.drop) return
        for (const listener of this.listeners) if (!own.has(listener)) listener()
      },
      listen: (onChange) => {
        const listener = () => onChange()
        own.add(listener)
        this.listeners.add(listener)
        return () => { own.delete(listener); this.listeners.delete(listener) }
      },
    }
  }
}

export function mutexRunner(): RunExclusive {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

let counter = 0
export const newTestId = () => `id-${++counter}`
export const fixedNow = () => new Date('2026-10-24T12:00:00.000Z')

export function testDocument(overrides: Partial<ReturnType<typeof createEmptyDocument>> = {}) {
  return { ...createEmptyDocument({ now: fixedNow(), locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), ...overrides }
}

export interface TestRepositoryOptions {
  legacy?: MemoryStorage
  withLocks?: boolean
  store?: BrowserStore
  runExclusive?: RunExclusive
  bus?: MemoryChannelBus
  calendarTexts?: CalendarSourceStore
}

export function createTestRepositories(options: TestRepositoryOptions = {}) {
  const legacy = options.legacy ?? new MemoryStorage()
  const store = options.store ?? new MemoryStore()
  const runExclusive: RunExclusive | undefined = options.withLocks === false ? undefined : (options.runExclusive ?? mutexRunner())
  const bus = options.bus ?? new MemoryChannelBus()
  const channel = bus.channel()
  const calendarTexts = options.calendarTexts ?? new MemoryCalendarTexts()
  const events = new EventTarget()
  const visibilityTarget = new EventTarget()
  let visible = true
  const visibility = { target: visibilityTarget, visible: () => visible, set: (next: boolean) => { visible = next } }
  return {
    legacy,
    store,
    bus,
    channel,
    calendarTexts,
    events,
    visibility,
    runExclusive,
    planner: new BrowserPlannerRepository({
      store, legacy, runExclusive, channel, events, visibility, calendarTexts,
      now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC',
    }),
    proposals: new BrowserProposalRepository({ store, runExclusive, channel, now: fixedNow, newId: newTestId }),
  }
}

export const KEYS = STORAGE_KEYS
