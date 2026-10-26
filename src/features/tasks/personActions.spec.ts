// Tasks P1-11 and P1-12 (design rev 6 §2.1, addendum 6.1 F1–F3): a capture commits only on the planner its preview was
// built on, at most once per attempt, and its Undo removes exactly what it added, while the workspace and its
// generation are the ones it was added to. Run on the browser repository and on the companion's real Workspace.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PlannerDocument, SaveResult } from '@/core/model'
import { replaceContent } from '@/features/settings/data/dataTransfer'
import { createTestRepositories, MemoryStore, mutexRunner, testDocument } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore, type PlannerRepositoryWithExtras } from '@/stores/plannerStore'
import { Workspace } from '../../../companion/src/workspace'
import { addCapturedTasks, bindToPlanner, captureAttempt, reconcileCapture, undoCapture } from './personActions'

const work = { id: 'work', name: 'Trabajo', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
const existing = { id: 't-existing', title: 'Existing', priority: 2 as const, createdAt: '2026-10-20T08:00:00.000Z' }
const rows = [{ title: 'Llamar a mamá' }, { title: 'Pagar luz' }, { title: 'Comprar pan' }]

// What a repository write does, plus a switch that drops the response after the write committed.
function losingResponses(repository: PlannerRepositoryWithExtras) {
  const control = { dropNext: false }
  const lose = <A extends unknown[]>(write: (...args: A) => Promise<SaveResult>) => async (...args: A): Promise<SaveResult> => {
    const result = await write(...args)
    if (!control.dropNext) return result
    control.dropNext = false
    return { kind: 'error', reason: 'network-lost' }
  }
  const wrapped: PlannerRepositoryWithExtras = Object.create(repository)
  wrapped.save = lose(repository.save.bind(repository))
  if (repository.saveGuarded) wrapped.saveGuarded = lose(repository.saveGuarded.bind(repository))
  return { repository: wrapped, control }
}

type Mode = 'browser' | 'companion'
const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))) })

// One tab of the app (the planner store) and an "other tab" that changes the same storage directly.
async function setup(mode: Mode) {
  setActivePinia(createPinia())
  let base: PlannerRepositoryWithExtras
  let other: { load(): Promise<PlannerDocument>; save(next: PlannerDocument): Promise<void> }
  let failReads = (value: boolean) => { void value }
  // Another tab makes the primary unreadable and restores the backup: the revision goes back.
  let restoreBackup = async () => undefined as unknown
  if (mode === 'browser') {
    const store = new MemoryStore()
    const lock = mutexRunner()
    const tab = createTestRepositories({ store, runExclusive: lock })
    const second = createTestRepositories({ store, runExclusive: lock })
    expect((await tab.planner.save(testDocument({ revision: 1, categories: [work], tasks: [existing] }), 0)).kind).toBe('ok')
    base = tab.planner
    other = {
      load: async () => { const loaded = await second.planner.load(); if (loaded.kind !== 'ok') throw new Error(loaded.kind); return loaded.document },
      save: async (next) => { expect((await second.planner.save(next, next.revision - 1)).kind).toBe('ok') },
    }
    failReads = (value) => { store.failReads = value }
    restoreBackup = async () => {
      store.data.set('document', 'corrupt')
      expect((await second.planner.restoreBackup()).kind).toBe('ok')
    }
  } else {
    const home = await mkdtemp(join(tmpdir(), 'weeklid-person-')); homes.push(home)
    const workspace = new Workspace(home)
    await workspace.initialize()
    const empty = await workspace.document()
    expect((await workspace.save({ ...empty, revision: 1, categories: [work], tasks: [existing] }, 0)).kind).toBe('ok')
    let unreadable = false
    base = {
      load: () => (unreadable ? Promise.reject(new Error('offline')) : workspace.load()),
      save: (document, expected) => workspace.save(document, expected),
      saveGuarded: (document, expected, guard) => workspace.save(document, expected, guard),
      subscribe: () => () => undefined,
      writable: true,
    }
    other = { load: () => workspace.document(), save: async (next) => { expect((await workspace.save(next, next.revision - 1)).kind).toBe('ok') } }
    failReads = (value) => { unreadable = value }
    restoreBackup = async () => {
      await writeFile(join(home, 'planner.json'), 'corrupt')
      expect((await workspace.restoreBackup()).kind).toBe('ok')
    }
  }
  const { repository, control } = losingResponses(base)
  configurePlannerStore({ repository, now: () => new Date('2026-10-26T13:02:00Z'), newId: () => crypto.randomUUID(), locale: () => 'es', timeZone: () => 'America/Bogota' })
  const planner = usePlannerStore()
  await planner.load()
  expect(planner.status).toBe('ready')
  const stored = async () => (await other.load())
  return { planner, other, control, stored, failReads, restoreBackup }
}

const titles = (document: PlannerDocument) => document.tasks.map((task) => task.title)

for (const mode of ['browser', 'companion'] as const) {
  describe(`P1-11 freshness (${mode})`, () => {
    const changes: [string, (document: PlannerDocument) => PlannerDocument][] = [
      ['a category renamed', (document) => ({ ...document, categories: [{ ...work, name: 'Oficina' }] })],
      ['the time zone changed', (document) => ({ ...document, settings: { ...document.settings, timeZone: 'Europe/Madrid' } })],
      ['weekStartsOn changed', (document) => ({ ...document, settings: { ...document.settings, weekStartsOn: 0 } })],
      ['a task completed', (document) => ({ ...document, tasks: document.tasks.map((task) => ({ ...task, doneAt: '2026-10-26T13:00:00.000Z' })) })],
      ['the workspace replaced', (document) => { const next = structuredClone(document); replaceContent(next, { ...structuredClone(document), workspaceId: 'ws-imported' }); return next }],
    ]
    for (const [name, change] of changes) {
      it(`refuses a preview built before ${name}, writes nothing, and works once rebuilt`, async () => {
        const { planner, other, stored } = await setup(mode)
        const binding = (await bindToPlanner())!
        const attempt = captureAttempt(rows)
        const current = await other.load()
        await other.save({ ...change(current), revision: current.revision + 1 })
        const before = await stored()
        expect(await addCapturedTasks(attempt, binding)).toEqual({ kind: 'changed-elsewhere' })
        expect(await stored()).toEqual(before)
        // The same refusal when this tab had already reloaded (the in-memory revision moved on).
        await planner.load()
        expect(await addCapturedTasks(captureAttempt(rows), binding)).toEqual({ kind: 'changed-elsewhere' })
        expect(await stored()).toEqual(before)
        const rebuilt = (await bindToPlanner())!
        expect((await addCapturedTasks(captureAttempt(rows), rebuilt)).kind).toBe('added')
        expect(titles(await stored())).toEqual([...titles(before), ...rows.map((row) => row.title)])
      })
    }
  })

  describe(`P1-11 freshness when a revision number repeats (${mode})`, () => {
    it('a backup restore takes the revision back; a preview built on the same number but other content is refused', async () => {
      const { other, stored, restoreBackup } = await setup(mode)
      const first = await other.load()
      await other.save({ ...first, revision: 2, categories: [{ ...work, name: 'Seen in the preview' }] })
      await usePlannerStore().load()
      const binding = (await bindToPlanner())!
      expect(binding.revision).toBe(2)
      await restoreBackup()
      const restored = await other.load()
      expect(restored.revision).toBe(1)
      await other.save({ ...restored, revision: 2, categories: [{ ...work, name: 'Different content' }] })
      const before = await stored()
      expect(await addCapturedTasks(captureAttempt(rows), binding)).toEqual({ kind: 'changed-elsewhere' })
      expect(await stored()).toEqual(before)
    })
  })

  describe(`P1-12 idempotency and Undo (${mode})`, () => {
    it('an attempt already applied is never applied again, even on a fresh binding', async () => {
      const { stored } = await setup(mode)
      const attempt = captureAttempt(rows)
      expect((await addCapturedTasks(attempt, (await bindToPlanner())!)).kind).toBe('added')
      expect((await addCapturedTasks(attempt, (await bindToPlanner())!)).kind).toBe('added')
      expect(titles(await stored())).toHaveLength(4)
    })

    it('a double tap commits once', async () => {
      const { stored } = await setup(mode)
      const binding = (await bindToPlanner())!
      const attempt = captureAttempt(rows)
      const [first, second] = await Promise.all([addCapturedTasks(attempt, binding), addCapturedTasks(attempt, binding)])
      expect(first.kind).toBe('added')
      expect(second).toEqual(first)
      expect(titles(await stored())).toEqual(['Existing', ...rows.map((row) => row.title)])
    })

    it('Undo removes exactly the receipt, and nothing when one of its tasks changed elsewhere', async () => {
      const { other, stored } = await setup(mode)
      const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
      if (added.kind !== 'added') throw new Error(added.kind)
      // An unrelated task whose id looks like the created ones is never touched.
      const current = await other.load()
      const lookalike = { ...existing, id: `${added.receipt.createdIds[0]!.slice(0, -1)}x`, title: 'Lookalike' }
      await other.save({ ...current, revision: current.revision + 1, tasks: [...current.tasks, lookalike] })
      await usePlannerStore().load()
      expect(await undoCapture(added.receipt)).toBe('undone')
      expect(titles(await stored())).toEqual(['Existing', 'Lookalike'])

      const again = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
      if (again.kind !== 'added') throw new Error(again.kind)
      const edited = await other.load()
      await other.save({ ...edited, revision: edited.revision + 1, tasks: edited.tasks.map((task) => (task.title === 'Pagar luz' ? { ...task, title: 'Pagar agua' } : task)) })
      await usePlannerStore().load()
      const before = await stored()
      expect(await undoCapture(again.receipt)).toBe('changed-elsewhere')
      expect(await stored()).toEqual(before)
    })

    it('a lost response: the outcome is checked, never sent as a new attempt, and Undo works from the read-back receipt', async () => {
      const { control, stored } = await setup(mode)
      const attempt = captureAttempt(rows)
      const binding = (await bindToPlanner())!
      control.dropNext = true
      expect(await addCapturedTasks(attempt, binding)).toEqual({ kind: 'unknown' })
      const reconciled = await reconcileCapture(attempt)
      if (reconciled.kind !== 'added') throw new Error(reconciled.kind)
      expect(titles(await stored())).toEqual(['Existing', ...rows.map((row) => row.title)])
      // The person retries the same attempt: it is already applied, and nothing is added twice.
      expect((await addCapturedTasks(attempt, binding)).kind).toBe('added')
      expect(titles(await stored())).toHaveLength(4)
      expect(await undoCapture(reconciled.receipt)).toBe('undone')
      expect(titles(await stored())).toEqual(['Existing'])
    })

    it('a lost response whose check cannot read the planner fails closed and sends nothing', async () => {
      const { control, stored, failReads } = await setup(mode)
      const attempt = captureAttempt(rows)
      control.dropNext = true
      expect(await addCapturedTasks(attempt, (await bindToPlanner())!)).toEqual({ kind: 'unknown' })
      failReads(true)
      expect(await reconcileCapture(attempt)).toEqual({ kind: 'unverified' })
      failReads(false)
      expect(titles(await stored())).toHaveLength(4)
    })

    it('a lost Undo response is checked by its own attempt', async () => {
      const { control, stored } = await setup(mode)
      const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
      if (added.kind !== 'added') throw new Error(added.kind)
      control.dropNext = true
      expect(await undoCapture(added.receipt)).toBe('undone')
      expect(titles(await stored())).toEqual(['Existing'])
    })
  })
}

describe('P1-12 Undo lifetime (browser)', () => {
  it('export, delete-all and import of the same document: identical ids and snapshots, and Undo is refused by the generation', async () => {
    const { planner, stored } = await setup('browser')
    const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
    if (added.kind !== 'added') throw new Error(added.kind)
    const exported = structuredClone(await stored())
    expect((await planner.deleteAll((draft) => replaceContent(draft, { ...testDocument(), workspaceId: 'ws-fresh' }))).ok).toBe(true)
    expect((await planner.commit((draft) => replaceContent(draft, exported))).ok).toBe(true)
    const imported = await stored()
    expect(imported.tasks).toEqual(exported.tasks)
    expect(imported.workspaceId).toBe(exported.workspaceId)
    expect(await undoCapture(added.receipt)).toBe('changed-elsewhere')
    expect(titles(await stored())).toEqual(titles(exported))
  })

  it('a backup restore that keeps the workspace id refuses Undo', async () => {
    setActivePinia(createPinia())
    const store = new MemoryStore()
    const repos = createTestRepositories({ store })
    await repos.planner.save(testDocument({ revision: 1, tasks: [existing] }), 0)
    configurePlannerStore({ repository: repos.planner, now: () => new Date(), newId: () => crypto.randomUUID(), locale: () => 'es', timeZone: () => 'UTC' })
    const planner = usePlannerStore()
    await planner.load()
    const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
    if (added.kind !== 'added') throw new Error(added.kind)
    // A second commit keeps the receipt's tasks in the backup, then the primary becomes unreadable and is restored.
    expect((await planner.commit((draft) => { draft.settings.weekStartsOn = 0 })).ok).toBe(true)
    store.data.set('document', 'corrupt')
    await planner.load()
    expect((await planner.restoreBackup()).ok).toBe(true)
    const restored = JSON.parse(store.data.get('document') as string) as PlannerDocument
    expect(restored.workspaceId).toBe(added.receipt.workspaceId)
    expect(restored.tasks.filter((task) => added.receipt.createdIds.includes(task.id))).toHaveLength(3)
    expect(await undoCapture(added.receipt)).toBe('changed-elsewhere')
    expect((JSON.parse(store.data.get('document') as string) as PlannerDocument).tasks).toHaveLength(4)
  })
})

describe('captureAttempt builds strict contract ops from plain rows', () => {
  it('refuses a row the contract refuses', () => {
    expect(() => captureAttempt([{ title: '' }])).toThrow()
    expect(() => captureAttempt([{ title: 'Dentista', at: 540 }])).toThrow()
    expect(captureAttempt([{ title: 'Dentista', at: 540, dueDate: '2026-10-27' }]).ops[0]!.task).toEqual({ title: 'Dentista', at: 540, dueDate: '2026-10-27', priority: 2 })
  })
})


for (const mode of ['browser', 'companion'] as const) {
  describe(`P1 review fixes (${mode})`, () => {
    // F1: a receipt from generation 0; another client commits, then restores its backup (generation 1, same revision
    // number as the receipt's planner). The stale Undo must not delete anything nor write generation 0 back.
    it('F1: an Undo never crosses a backup restored elsewhere', async () => {
      const { other, stored, restoreBackup } = await setup(mode)
      const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
      if (added.kind !== 'added') throw new Error(added.kind)
      const current = await other.load()
      await other.save({ ...current, revision: current.revision + 1, settings: { ...current.settings, weekStartsOn: 0 } })
      await restoreBackup()
      const restored = await stored()
      expect(restored.revision).toBe(current.revision)
      expect(restored.generation).toBe(1)
      expect(await undoCapture(added.receipt)).toBe('changed-elsewhere')
      expect(await stored()).toEqual(restored)
    })

    it('an unrelated edit in another client, not yet read here, does not block Undo', async () => {
      const { other, stored } = await setup(mode)
      const added = await addCapturedTasks(captureAttempt(rows), (await bindToPlanner())!)
      if (added.kind !== 'added') throw new Error(added.kind)
      const current = await other.load()
      await other.save({ ...current, revision: current.revision + 1, categories: [{ ...work, name: 'Oficina' }] })
      expect(await undoCapture(added.receipt)).toBe('undone')
      expect(titles(await stored())).toEqual(['Existing'])
      expect((await stored()).categories[0]!.name).toBe('Oficina')
    })

    // F2: the commit stored, its response was lost, another client edited a created task, then the outcome was read
    // back. The receipt is the one the commit staged, so Undo leaves the edited task alone.
    it('F2: after a lost response, Undo is bound to what the commit staged, not to later edits', async () => {
      const { control, other, stored } = await setup(mode)
      const attempt = captureAttempt(rows)
      control.dropNext = true
      expect(await addCapturedTasks(attempt, (await bindToPlanner())!)).toEqual({ kind: 'unknown' })
      const current = await other.load()
      await other.save({ ...current, revision: current.revision + 1, tasks: current.tasks.map((task) => (task.title === 'Pagar luz' ? { ...task, title: 'Pagar luz y agua' } : task)) })
      const reconciled = await reconcileCapture(attempt)
      if (reconciled.kind !== 'added') throw new Error(reconciled.kind)
      expect(await undoCapture(reconciled.receipt)).toBe('changed-elsewhere')
      expect(titles(await stored())).toContain('Pagar luz y agua')
      expect(titles(await stored())).toHaveLength(4)
    })
  })
}
