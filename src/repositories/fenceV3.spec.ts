// Tasks P1-1 (design rev 4 §2.1, rev 6 §3): P1 raises the storage fence again, so the last build fenced at version 2
// (d325df4, the real code through `@fencedV2/*`) can no longer write anything once a P1 tab has opened the databases.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { databaseVersion, dumpDatabases, fencedV2Build, fencedV2Source, ics } from '@/test/storageFence'
import { BrowserPlannerRepository } from './BrowserPlannerRepository'
import { BrowserProposalRepository } from './BrowserProposalRepository'
import { IndexedDbStore } from './indexedDbStore'
import { failureReason, isStorageFailure, type RunExclusive } from './storageCommit'
import { CALENDAR_DATABASE, createStorageFence, PLANNER_DATABASE, RESTORE_MIN_STORAGE_VERSION, STORAGE_VERSION, type StorageFence } from './storageVersion'
import { fixedNow, MemoryChannelBus, MemoryStorage, mutexRunner } from './testSupport'

afterEach(() => { vi.restoreAllMocks() })

let ids = 0
function p1Build(factory: IDBFactory, lock: RunExclusive, fence: StorageFence = createStorageFence(factory, { lock, now: fixedNow })) {
  const store = new IndexedDbStore(factory, fence)
  const texts = new IndexedDbCalendarSourceStore(factory, fence)
  const bus = new MemoryChannelBus()
  const planner = new BrowserPlannerRepository({
    store, legacy: new MemoryStorage(), runExclusive: lock, channel: bus.channel(), events: new EventTarget(), calendarTexts: texts,
    now: fixedNow, newId: () => `p1-${++ids}`, locale: () => 'en', timeZone: () => 'UTC',
  })
  const proposals = new BrowserProposalRepository({ store, runExclusive: lock, channel: bus.channel(), now: fixedNow, newId: () => `p1-${++ids}` })
  return { fence, store, texts, planner, proposals }
}

async function settledOutcome(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    const result = await operation()
    if (result && typeof result === 'object' && 'kind' in result && result.kind === 'error' && 'reason' in result && isStorageFailure(result.reason as string)) return 'storage-error'
    return result
  } catch (error) {
    const reason = failureReason(error)
    return isStorageFailure(reason) || reason === 'calendars.storage' ? 'storage-error' : `rejected:${reason}`
  }
}

// The d325df4 build seeds a plan with a calendar text, a backup and two pending proposals.
async function seededByV2() {
  const factory = new IDBFactory()
  const lock = mutexRunner()
  const v2 = await fencedV2Build(factory, lock)
  await v2.texts.put('cal-1', ics('SENTINEL-v2-text'))
  const first = v2.testDocument({ revision: 1, categories: [{ id: 'c-1', name: 'SENTINEL', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }], calendarSources: [{ id: 'cal-1', name: 'Cal', kind: 'file', colorKey: 'green' }] })
  expect((await v2.planner.save(first, 0)).kind).toBe('ok')
  const second = { ...first, revision: 2, blocks: [{ id: 'b-1', categoryId: 'c-1', title: 'SENTINEL-block', days: [1], start: 540, end: 600 }] }
  expect((await v2.planner.save(second, 1)).kind).toBe('ok')
  const input = (summary: string) => ({ contractVersion: '1.0' as const, workspaceId: first.workspaceId, baseRevision: 2, summary, ops: [{ op: 'delete_block' as const, id: 'b-1' }] })
  const a = await v2.proposals.create(input('SENTINEL-A'), 'mcp')
  const b = await v2.proposals.create(input('SENTINEL-B'), 'mcp')
  return { factory, lock, v2, document: second, a, b }
}

function operationsOf(v2: Awaited<ReturnType<typeof fencedV2Build>>, document: { workspaceId: string }, proposal: { id: string; contentHash: string }) {
  const next = { ...v2.testDocument({ workspaceId: document.workspaceId }), revision: 3 }
  return {
    load: () => v2.planner.load(),
    save: () => v2.planner.save(next, 2),
    saveGuarded: () => v2.planner.saveGuarded(next, 2, {}),
    deleteAll: () => v2.planner.deleteAll(v2.testDocument({ workspaceId: 'ws-fresh' }), 2),
    restoreBackup: () => v2.planner.restoreBackup(),
    proposalCreate: () => v2.proposals.create({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 2, summary: 'x', ops: [{ op: 'delete_block', id: 'b-1' }] }, 'mcp'),
    proposalApprove: () => v2.proposals.approve(proposal.id, proposal.contentHash, 2),
    // K1's probe: rejecting A rewrote the whole list with the old schema and stripped B's newer fields.
    proposalReject: () => v2.proposals.reject(proposal.id),
    calendarPut: () => v2.texts.put('cal-1', ics('SENTINEL-overwrite')),
    calendarDelete: () => v2.texts.delete('cal-1'),
  } satisfies Record<string, () => Promise<unknown>>
}

async function expectFencedOut(factory: IDBFactory, operations: Record<string, () => Promise<unknown>>): Promise<void> {
  for (const [name, operation] of Object.entries(operations)) {
    const before = await dumpDatabases(factory)
    expect([name, await settledOutcome(operation)]).toEqual([name, 'storage-error'])
    expect([name, await dumpDatabases(factory)]).toEqual([name, before])
  }
}

describe('P1-1: the P1 fence excludes the build fenced at version 2', () => {
  it('runs the real d325df4 code, fenced at version 2', async () => {
    expect(await fencedV2Source('repositories/storageVersion.ts')).toContain('export const STORAGE_VERSION = 2')
    const factory = new IDBFactory()
    expect((await fencedV2Build(factory, mutexRunner())).storageVersion).toBe(2)
  })

  it('P1 opens both databases one version above it, and restore needs that version too', () => {
    expect(STORAGE_VERSION).toBe(3)
    expect(RESTORE_MIN_STORAGE_VERSION).toBe(STORAGE_VERSION)
  })

  it('after a P1 tab opens, every d325df4 operation fails and both databases stay byte-identical', async () => {
    const { factory, lock, v2, document, a } = await seededByV2()
    const p1 = p1Build(factory, lock)
    expect((await p1.planner.load()).kind).toBe('ok')
    expect(await databaseVersion(factory, PLANNER_DATABASE)).toBe(STORAGE_VERSION)
    expect(await databaseVersion(factory, CALENDAR_DATABASE)).toBe(STORAGE_VERSION)
    await expectFencedOut(factory, operationsOf(v2, document, a))
  })

  it('a d325df4 write queued while the upgrade waits for an open connection fails once it runs, and writes nothing', async () => {
    const { factory, lock, v2, document } = await seededByV2()
    // Another d325df4 tab in the middle of a transaction: its connection does not close on versionchange.
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PLANNER_DATABASE, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const before = await dumpDatabases(factory, [CALENDAR_DATABASE])
    const p1 = p1Build(factory, lock)
    const ready = p1.fence.ready()
    await vi.waitFor(() => expect(p1.fence.waiting()).toBe(true))
    const queued = settledOutcome(() => v2.planner.save({ ...v2.testDocument({ workspaceId: document.workspaceId }), revision: 3 }, 2))
    held.close()
    await ready
    expect(await queued).toBe('storage-error')
    expect(await dumpDatabases(factory, [CALENDAR_DATABASE])).toBe(before.replace('"version":2', `"version":${STORAGE_VERSION}`))
    const stored = JSON.parse(await dumpDatabases(factory, [PLANNER_DATABASE]))[PLANNER_DATABASE]
    expect(JSON.parse(stored.stores.document[0][1]).revision).toBe(2)
  })

  // 1A (backup and restore) raises the fence too. Whichever of the two merges second raises it once more and fences
  // out the first: P1 after 1A is the case above; 1A after P1 is this one.
  it('a later fence bump excludes the P1 build in the same way', async () => {
    const { factory, lock } = await seededByV2()
    const p1 = p1Build(factory, lock)
    expect((await p1.planner.load()).kind).toBe('ok')
    const seed = await p1.planner.load()
    if (seed.kind !== 'ok') throw new Error('no document')
    const later = p1Build(factory, lock, createStorageFence(factory, { lock, now: fixedNow, version: STORAGE_VERSION + 1 }))
    expect((await later.planner.load()).kind).toBe('ok')
    await expectFencedOut(factory, {
      load: () => p1.planner.load(),
      save: () => p1.planner.save({ ...seed.document, revision: 3 }, 2),
      proposalList: () => p1.proposals.list(),
      calendarPut: () => p1.texts.put('cal-1', ics('SENTINEL-p1')),
    })
  })
})

