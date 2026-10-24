import { describe, expect, it, vi } from 'vitest'
import { createTestRepositories, KEYS, MemoryStorage, testDocument } from './testSupport'

const saved = (revision: number, extra = {}) => testDocument({ revision, ...extra })

describe('load', () => {
  it('reports empty storage', async () => {
    expect(await createTestRepositories().planner.load()).toEqual({ kind: 'empty' })
  })

  it('migrates the legacy key once, never writes it, and keeps its bytes', async () => {
    const { planner, storage } = createTestRepositories()
    const legacy = JSON.stringify({
      categories: [{ id: 'c1', name: 'Work', color: '#3b82f6', weeklyHourLimit: 40 }],
      timeBlocks: [{ id: 'b1', categoryId: 'c1', title: 'Focus', description: 'notes', dayOfWeek: 1, startTime: '22:00', endTime: '06:00', repeatDays: [1, 2, 2] }],
    })
    storage.data.set(KEYS.legacyV1, legacy)

    const result = await planner.load()

    expect(result).toMatchObject({ kind: 'ok', migratedFrom: 1 })
    if (result.kind !== 'ok') return
    expect(result.document.blocks[0]).toMatchObject({ days: [1, 2], start: 1320, end: 360, notes: 'notes' })
    expect(storage.data.get(KEYS.legacyV1)).toBe(legacy)
    expect(JSON.parse(storage.data.get(KEYS.document)!).blocks).toHaveLength(1)
    expect(await planner.load()).toMatchObject({ kind: 'ok' })
  })

  it('reports a corrupt legacy key without touching it or creating v2', async () => {
    const { planner, storage } = createTestRepositories()
    storage.data.set(KEYS.legacyV1, '{broken')
    expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw: '{broken' })
    expect(storage.data.has(KEYS.document)).toBe(false)
  })

  it('reports corrupt v2 data and leaves it byte-identical', async () => {
    const { planner, storage } = createTestRepositories()
    storage.data.set(KEYS.document, '{"schemaVersion":2}')
    expect(await planner.load()).toMatchObject({ kind: 'corrupt', raw: '{"schemaVersion":2}' })
    expect(storage.data.get(KEYS.document)).toBe('{"schemaVersion":2}')
  })

  it('reports a newer schema version as unsupported', async () => {
    const { planner, storage } = createTestRepositories()
    storage.data.set(KEYS.document, JSON.stringify({ schemaVersion: 9 }))
    expect(await planner.load()).toEqual({ kind: 'unsupported', schemaVersion: 9 })
  })

  it('migrates in memory only when Web Locks are missing', async () => {
    const { planner, storage } = createTestRepositories(new MemoryStorage(), false)
    storage.data.set(KEYS.legacyV1, JSON.stringify({ categories: [], timeBlocks: [] }))
    expect(planner.writable).toBe(false)
    expect(await planner.load()).toMatchObject({ kind: 'ok', migratedFrom: 1 })
    expect(storage.data.has(KEYS.document)).toBe(false)
  })
})

describe('save', () => {
  it('writes the backup of the previous bytes, then the new document', async () => {
    const { planner, storage } = createTestRepositories()
    expect(await planner.save(saved(1), 0)).toEqual({ kind: 'ok', revision: 1 })
    const first = storage.data.get(KEYS.document)
    expect(await planner.save(saved(2), 1)).toEqual({ kind: 'ok', revision: 2 })
    expect(storage.data.get(KEYS.backup)).toBe(first)
    expect(JSON.parse(storage.data.get(KEYS.document)!).revision).toBe(2)
  })

  it('serializes concurrent commits from the same revision: one wins, one conflicts', async () => {
    const { planner } = createTestRepositories()
    const results = await Promise.all([planner.save(saved(1), 0), planner.save(saved(1, { updatedAt: '2026-10-24T13:00:00.000Z' }), 0)])
    expect(results.filter((result) => result.kind === 'ok')).toHaveLength(1)
    expect(results.find((result) => result.kind === 'conflict')).toEqual({ kind: 'conflict', currentRevision: 1 })
  })

  it('leaves the previous document intact when the backup write hits the quota', async () => {
    const { planner, storage } = createTestRepositories()
    await planner.save(saved(1), 0)
    const before = storage.data.get(KEYS.document)
    storage.failWritesTo.add(KEYS.backup)
    expect(await planner.save(saved(2), 1)).toEqual({ kind: 'error', reason: 'quota-exceeded' })
    expect(storage.data.get(KEYS.document)).toBe(before)
  })

  it('leaves the previous document intact when the primary write hits the quota', async () => {
    const { planner, storage } = createTestRepositories()
    await planner.save(saved(1), 0)
    const before = storage.data.get(KEYS.document)
    storage.failWritesTo.add(KEYS.document)
    expect(await planner.save(saved(2), 1)).toEqual({ kind: 'error', reason: 'quota-exceeded' })
    expect(storage.data.get(KEYS.document)).toBe(before)
    expect(storage.data.get(KEYS.backup)).toBe(before)
  })

  it('refuses to overwrite unreadable stored data', async () => {
    const { planner, storage } = createTestRepositories()
    storage.data.set(KEYS.document, 'garbage')
    expect(await planner.save(saved(1), 0)).toEqual({ kind: 'error', reason: 'stored-document-unreadable' })
    expect(storage.data.get(KEYS.document)).toBe('garbage')
  })

  it('refuses invalid documents and read-only mode', async () => {
    const { planner } = createTestRepositories()
    expect(await planner.save({ ...saved(1), revision: -5 }, 0)).toEqual({ kind: 'error', reason: 'invalid-document' })
    const readOnly = createTestRepositories(new MemoryStorage(), false).planner
    expect(await readOnly.save(saved(1), 0)).toEqual({ kind: 'error', reason: 'no-web-locks' })
  })
})

describe('recovery', () => {
  it('replaces corrupt data, keeping the raw bytes in the backup slot', async () => {
    const { planner, storage } = createTestRepositories()
    storage.data.set(KEYS.document, 'garbage')
    expect(await planner.replaceCorrupt(saved(0))).toMatchObject({ kind: 'ok' })
    expect(storage.data.get(KEYS.backup)).toBe('garbage')
    expect(await planner.load()).toMatchObject({ kind: 'ok' })
  })

  it('keeps a valid backup instead of overwriting it with corrupt bytes', async () => {
    const { planner, storage } = createTestRepositories()
    await planner.save(saved(1), 0)
    await planner.save(saved(2), 1)
    const goodBackup = storage.data.get(KEYS.backup)
    storage.data.set(KEYS.document, 'garbage')
    await planner.replaceCorrupt(saved(0))
    expect(storage.data.get(KEYS.backup)).toBe(goodBackup)
  })

  it('refuses to replace readable data', async () => {
    const { planner } = createTestRepositories()
    await planner.save(saved(1), 0)
    expect(await planner.replaceCorrupt(saved(0))).toEqual({ kind: 'error', reason: 'data-is-not-corrupt' })
  })

  it('restores a valid backup over corrupt data', async () => {
    const { planner, storage } = createTestRepositories()
    await planner.save(saved(1), 0)
    await planner.save(saved(2), 1)
    storage.data.set(KEYS.document, 'garbage')
    expect(await planner.peekBackup()).toMatchObject({ revision: 1 })
    expect(await planner.restoreBackup()).toEqual({ kind: 'ok', revision: 1 })
    expect(await planner.load()).toMatchObject({ kind: 'ok', document: { revision: 1 } })
  })
})

describe('subscriptions', () => {
  it('notifies on changes to the document key and on clear', () => {
    const { planner, events } = createTestRepositories()
    const listener = vi.fn()
    const stop = planner.subscribe(listener)
    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.document }))
    events.dispatchEvent(Object.assign(new Event('storage'), { key: null }))
    events.dispatchEvent(Object.assign(new Event('storage'), { key: 'other' }))
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.document }))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('reports writes to the legacy key by an older tab', () => {
    const { planner, events } = createTestRepositories()
    const listener = vi.fn()
    planner.onLegacyChange(listener)
    events.dispatchEvent(Object.assign(new Event('storage'), { key: KEYS.legacyV1 }))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
