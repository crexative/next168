// Tasks P1-3 (design rev 2.1 §10, addendum 6.1 F3): schema v3 is a lazy widening. A stored v2 document is widened in
// memory on every load and written as v3 only by its first commit; every write that replaces the planner moves its
// generation forward, so an Undo receipt of the replaced planner can never apply to the new one.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { parseExportBundle } from '@/core/exportBundle'
import { validateDocumentV2 } from '@/core/legacy/v2'
import { parseDocument } from '@/core/documents'
import { replaceContent } from '@/features/settings/data/dataTransfer'
import { spyStoreCalls } from '@/test/storageFence'
import { BrowserPlannerRepository } from './BrowserPlannerRepository'
import { IndexedDbStore } from './indexedDbStore'
import { createStorageFence } from './storageVersion'
import { createTestRepositories, fixedNow, MemoryChannelBus, MemoryStorage, MemoryStore, mutexRunner, testDocument } from './testSupport'

afterEach(() => { vi.restoreAllMocks() })

const V2_PLANNER = {
  schemaVersion: 2, workspaceId: 'ws-v2', revision: 4, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: true, theme: 'dark' },
  categories: [{ id: 'c-work', name: 'Trabajo', colorKey: 'blue', icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } }, { id: 'c-legacy', name: 'Antigua', colorKey: 'gray', customColor: '#123456', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Trabajo', notes: 'nota', days: [1, 2, 3, 4, 5], start: 540, end: 1020 }, { id: 'b-night', categoryId: 'c-legacy', title: 'Noche', days: [0, 6], start: 1380, end: 360 }],
  tasks: [
    { id: 't-open', title: 'Informe', categoryId: 'c-work', durationMin: 180, dueDate: '2026-10-30', priority: 1, createdAt: '2026-10-20T08:00:00.000Z' },
    { id: 't-done', title: 'Llamar', durationMin: 15, priority: 3, doneAt: '2026-10-21T10:00:00.000Z', createdAt: '2026-10-20T08:00:00.000Z' },
  ],
  checkIns: [{ date: '2026-10-20', bedtime: 1380, wake: 390, exercise: 'yes', stress: 2, note: 'bien' }],
  actuals: [{ date: '2026-10-20', blockId: 'b-work', categoryId: 'c-work', plannedStartAt: '2026-10-20T14:00:00.000Z', plannedEndAt: '2026-10-20T22:00:00.000Z', plannedMinutes: 480, status: 'partial', actualMinutes: 300 }],
  events: [{ id: 'e-1', title: 'Cita', start: '2026-10-22T15:00:00.000Z', end: '2026-10-22T16:00:00.000Z', allDay: false, location: 'Centro', notes: 'traer papeles', attendees: ['ana@example.invalid'] }],
  calendarSources: [{ id: 'cal-1', name: 'Festivos', kind: 'url', url: 'https://example.invalid/f.ics', colorKey: 'green', lastSyncedAt: '2026-10-20T08:00:00.000Z' }],
  appliedProposalIds: ['p-1', 'p-2'],
}

// Every v2 document the repository holds in fixtures: this edge planner, the tap-budget planner and the vector documents.
function v2Fixtures(): [string, unknown][] {
  const vectors = JSON.parse(readFileSync('src/repositories/__fixtures__/preUpgradeVectors.json', 'utf8')) as { name: string; kind: string; document: string }[]
  return [
    ['edge planner', V2_PLANNER],
    ['tap-budget planner', JSON.parse(readFileSync('e2e/fixtures/tapBudgetPlanner.json', 'utf8'))],
    ...vectors.filter((vector) => vector.kind === 'portable').map((vector): [string, unknown] => [`vector: ${vector.name}`, JSON.parse(vector.document)]),
  ]
}

function indexedDbRepository(factory: IDBFactory, lock = mutexRunner()) {
  const store = new IndexedDbStore(factory, createStorageFence(factory, { lock, now: fixedNow }))
  const planner = new BrowserPlannerRepository({
    store, legacy: new MemoryStorage(), runExclusive: lock, channel: new MemoryChannelBus().channel(), events: new EventTarget(),
    now: fixedNow, newId: () => 'id', locale: () => 'es', timeZone: () => 'UTC',
  })
  return { store, planner }
}

describe('P1-3: lazy widening from schema v2', () => {
  it('every v2 fixture widens to v3, deep-equal on every v2 field, with generation 0 and no capture ids', () => {
    for (const [name, raw] of v2Fixtures()) {
      const v2 = validateDocumentV2(raw)
      const loaded = parseDocument(JSON.stringify(raw))
      expect([name, loaded.kind]).toEqual([name, 'ok'])
      if (loaded.kind !== 'ok') continue
      const { schemaVersion, generation, appliedCaptureIds, ...rest } = loaded.document
      expect([name, schemaVersion, generation, appliedCaptureIds]).toEqual([name, 3, 0, []])
      const { schemaVersion: _v2Version, ...v2Fields } = v2
      expect([name, rest]).toEqual([name, v2Fields])
      expect(_v2Version).toBe(2)
    }
  })

  it('loading a stored v2 document and showing it writes nothing', async () => {
    const factory = new IDBFactory()
    const first = indexedDbRepository(factory)
    await first.planner.load()
    await first.store.write({ document: JSON.stringify(V2_PLANNER) })
    const { writes } = spyStoreCalls()
    const { planner } = indexedDbRepository(factory)
    const loaded = await planner.load()
    expect(loaded.kind).toBe('ok')
    expect(writes).toEqual([])
    expect((await first.store.read(['document'])).document).toBe(JSON.stringify(V2_PLANNER))
  })

  it('the first commit writes v3 with revision + 1, and the backup holds the v2 bytes', async () => {
    const factory = new IDBFactory()
    const { store, planner } = indexedDbRepository(factory)
    await planner.load()
    const v2Bytes = JSON.stringify(V2_PLANNER)
    await store.write({ document: v2Bytes })
    const loaded = await planner.load()
    if (loaded.kind !== 'ok') throw new Error(loaded.kind)
    const next = { ...loaded.document, revision: loaded.document.revision + 1, tasks: [...loaded.document.tasks, { id: 't-new', title: 'Sin tiempo', priority: 2 as const, createdAt: fixedNow().toISOString() }] }
    expect(await planner.save(next, 4)).toEqual({ kind: 'ok', revision: 5 })
    const stored = await store.read(['document', 'backup'])
    expect(stored.backup).toBe(v2Bytes)
    expect(JSON.parse(stored.document!)).toMatchObject({ schemaVersion: 3, revision: 5, generation: 0, appliedCaptureIds: [] })
  })

  it("d325df4's parser refuses a v3 document and a v3 bundle as unsupported", async () => {
    const tree = '@fencedV2'
    const documents = await import(/* @vite-ignore */ `${tree}/core/documents`) as typeof import('@/core/documents')
    const bundles = await import(/* @vite-ignore */ `${tree}/core/exportBundle`) as typeof import('@/core/exportBundle')
    const v3 = testDocument({ revision: 2 })
    expect(documents.parseDocument(JSON.stringify(v3))).toEqual({ kind: 'unsupported', schemaVersion: 3 })
    const bundle = { format: 'next168-export', bundleVersion: 1, exportedAt: fixedNow().toISOString(), document: v3, calendarSourceTexts: {} }
    expect(bundles.parseExportBundle(JSON.stringify(bundle))).toEqual({ kind: 'unsupported', schemaVersion: 3 })
  })

  it('a v2 export bundle imports widened, and reports the version it held', () => {
    const bundle = { format: 'next168-export', bundleVersion: 1, exportedAt: fixedNow().toISOString(), document: { ...V2_PLANNER, calendarSources: [] }, calendarSourceTexts: {} }
    const parsed = parseExportBundle(JSON.stringify(bundle))
    expect(parsed).toMatchObject({ kind: 'ok', sourceVersion: 2, document: { schemaVersion: 3, generation: 0, appliedCaptureIds: [] } })
  })
})

describe('P1-3: every replacing write moves the generation forward', () => {
  it('delete-all, even when the caller kept the old generation', async () => {
    const { planner } = createTestRepositories()
    expect((await planner.save(testDocument({ revision: 1, generation: 4 }), 0)).kind).toBe('ok')
    expect((await planner.deleteAll(testDocument({ workspaceId: 'ws-fresh', revision: 2 }), 1)).kind).toBe('ok')
    const loaded = await planner.load()
    expect(loaded).toMatchObject({ kind: 'ok', document: { workspaceId: 'ws-fresh', generation: 5 } })
  })

  it('import and delete-all through replaceContent: past both planners', () => {
    const draft = testDocument({ generation: 2 })
    replaceContent(draft, testDocument({ workspaceId: 'ws-imported', generation: 7 }))
    expect(draft).toMatchObject({ workspaceId: 'ws-imported', generation: 8 })
    const again = testDocument({ generation: 9 })
    replaceContent(again, testDocument({ generation: 0 }))
    expect(again.generation).toBe(10)
  })

  it('backup restore and recovery of an unreadable planner', async () => {
    const store = new MemoryStore()
    const { planner } = createTestRepositories({ store })
    store.data.set('document', 'corrupt bytes')
    store.data.set('backup', JSON.stringify(testDocument({ revision: 3, generation: 6 })))
    expect((await planner.restoreBackup()).kind).toBe('ok')
    expect(JSON.parse(store.data.get('document') as string)).toMatchObject({ revision: 3, generation: 7 })

    store.data.set('document', 'corrupt again')
    expect((await planner.replaceCorrupt(testDocument({ workspaceId: 'ws-new', generation: 0 }))).kind).toBe('ok')
    expect(JSON.parse(store.data.get('document') as string)).toMatchObject({ workspaceId: 'ws-new', generation: 7 })
  })
})
