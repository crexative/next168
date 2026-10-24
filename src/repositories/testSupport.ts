import { STORAGE_KEYS } from '@/core/model'
import { createEmptyDocument } from './core'
import { LocalStorageRepository } from './LocalStorageRepository'
import { LocalStorageProposalRepository } from './LocalStorageProposalRepository'
import type { RunExclusive, StorageLike } from './storageCommit'

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>()
  failWritesTo = new Set<string>()
  failAllWrites = false

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failAllWrites || this.failWritesTo.has(key)) throw new DOMException('quota', 'QuotaExceededError')
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
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
  return { ...createEmptyDocument({ now: fixedNow(), locale: 'en', timeZone: 'UTC', workspaceId: 'workspace-1' }), ...overrides }
}

export function createTestRepositories(storage = new MemoryStorage(), withLocks = true) {
  const runExclusive: RunExclusive | undefined = withLocks ? mutexRunner() : undefined
  const events = new EventTarget()
  return {
    storage,
    events,
    planner: new LocalStorageRepository({
      storage, runExclusive, events, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC',
    }),
    proposals: new LocalStorageProposalRepository({ storage, runExclusive, now: fixedNow, newId: newTestId }),
  }
}

export const KEYS = STORAGE_KEYS
