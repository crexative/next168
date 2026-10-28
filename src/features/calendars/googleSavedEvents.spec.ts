import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { ExternalOccurrence } from '@/core/model'
import { IndexedDbSavedGoogleEvents, SAVED_GOOGLE_DATABASE, savedCopyOf, type SavedBinding } from './googleSavedEvents'

// The on-device copy of the last Google Calendar read: only the overlay's fields, bound to its planner and zone, and
// a deletion in any tab always beats a write that started before it.
const BINDING: SavedBinding = { workspaceId: 'ws-1', plannerGeneration: 2, timeZone: 'UTC' }
const COVERAGE = { start: '2026-10-13', end: '2026-11-30', timeZone: 'UTC', fetchedAt: '2026-10-20T12:00:00.000Z' }
const STANDUP: ExternalOccurrence = { sourceId: 'google:primary', uid: 'evt-1', title: 'Standup', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:30:00.000Z', allDay: false, busy: true }
const copy = (occurrences: ExternalOccurrence[] = [STANDUP]) => savedCopyOf(BINDING, COVERAGE, occurrences)

async function raw(factory: IDBFactory): Promise<Record<string, unknown>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(SAVED_GOOGLE_DATABASE)
    open.onupgradeneeded = () => open.result.createObjectStore('saved')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    const store = db.transaction('saved', 'readonly').objectStore('saved')
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((resolve) => { const read = store.getAllKeys(); read.onsuccess = () => resolve(read.result) }),
      new Promise<unknown[]>((resolve) => { const read = store.getAll(); read.onsuccess = () => resolve(read.result) }),
    ])
    return Object.fromEntries(keys.map((key, index) => [String(key), values[index]]))
  } finally {
    db.close()
  }
}

async function put(factory: IDBFactory, key: string, value: unknown): Promise<void> {
  const tab = new IndexedDbSavedGoogleEvents(factory)
  await tab.loadMatching(BINDING)
  const db = await new Promise<IDBDatabase>((resolve) => { const open = factory.open(SAVED_GOOGLE_DATABASE); open.onsuccess = () => resolve(open.result) })
  await new Promise<void>((resolve) => {
    const transaction = db.transaction('saved', 'readwrite')
    transaction.objectStore('saved').put(value, key)
    transaction.oncomplete = () => resolve()
  })
  db.close()
}

describe('the saved Google Calendar copy', () => {
  it('comes back for the same planner and zone exactly as saved', async () => {
    const factory = new IDBFactory()
    const tab = new IndexedDbSavedGoogleEvents(factory)
    expect(await tab.loadMatching(BINDING)).toBeUndefined()
    expect(await tab.save(copy())).toBe('saved')
    expect(await new IndexedDbSavedGoogleEvents(factory).loadMatching(BINDING)).toEqual(copy())
  })

  it('keeps only the fields the overlay draws, never anything else that rides along', () => {
    const extra = { ...STANDUP, attendees: [{ email: 'ana@example.com' }], description: 'Agenda', token: 'tok-SECRET' } as unknown as ExternalOccurrence
    const saved = savedCopyOf(BINDING, { ...COVERAGE, account: 'ana@example.com' } as typeof COVERAGE, [extra])
    expect(JSON.stringify(saved)).not.toMatch(/ana@example\.com|Agenda|tok-SECRET/u)
    expect(Object.keys(saved).sort()).toEqual(['coverage', 'format', 'occurrences', 'plannerGeneration', 'workspaceId'])
    expect(Object.keys(saved.occurrences[0]!).sort()).toEqual(['allDay', 'busy', 'end', 'sourceId', 'start', 'title', 'uid'])
  })

  for (const [what, binding] of [
    ['another workspace', { ...BINDING, workspaceId: 'ws-2' }],
    ['a replaced planner (import, restore, Delete all data)', { ...BINDING, plannerGeneration: 3 }],
    ['another time zone', { ...BINDING, timeZone: 'America/Bogota' }],
  ] as const) {
    it(`is deleted, not shown, for ${what}`, async () => {
      const factory = new IDBFactory()
      const tab = new IndexedDbSavedGoogleEvents(factory)
      await tab.loadMatching(BINDING)
      await tab.save(copy())
      expect(await tab.loadMatching(binding)).toBeUndefined()
      expect(Object.keys(await raw(factory))).toEqual(['epoch'])
      expect(await tab.loadMatching(BINDING)).toBeUndefined()
    })
  }

  it('deletes a stored record it cannot vouch for (unknown fields, wrong source, too many events)', async () => {
    for (const bad of [
      { ...copy(), token: 'tok-SECRET' },
      copy([{ ...STANDUP, sourceId: 'ics:other' }]),
      copy(Array.from({ length: 2001 }, (_, index) => ({ ...STANDUP, uid: `evt-${index}` }))),
    ]) {
      const factory = new IDBFactory()
      await put(factory, 'primary', bad)
      expect(await new IndexedDbSavedGoogleEvents(factory).loadMatching(BINDING)).toBeUndefined()
      expect(await raw(factory)).not.toHaveProperty('primary')
    }
  })

  it('a deletion in another tab beats a write this tab starts afterwards, until this tab learns of it', async () => {
    const factory = new IDBFactory()
    const first = new IndexedDbSavedGoogleEvents(factory)
    const second = new IndexedDbSavedGoogleEvents(factory)
    await first.loadMatching(BINDING)
    await second.loadMatching(BINDING)
    expect(await first.save(copy())).toBe('saved')
    const epoch = second.discard()
    await second.settled()
    expect(await raw(factory)).not.toHaveProperty('primary')
    expect(await first.save(copy())).toBe('refused')
    expect(await raw(factory)).not.toHaveProperty('primary')
    first.adopt(epoch)
    expect(await first.save(copy())).toBe('saved')
  })

  it('a write queued before a deletion in another tab, but committed after it, never lands', async () => {
    const factory = new IDBFactory()
    const first = new IndexedDbSavedGoogleEvents(factory)
    const second = new IndexedDbSavedGoogleEvents(factory)
    await Promise.all([first.loadMatching(BINDING), second.loadMatching(BINDING)])
    second.discard()
    const late = first.save(copy())
    await second.settled()
    expect(await late).toBe('refused')
    expect(await raw(factory)).not.toHaveProperty('primary')
  })

  // A write asked for before this tab heard of the other tab's deletion carries what was read before it: learning the
  // new epoch must not let that write through.
  it('a write asked for before this tab adopts another tab\'s deletion stays refused', async () => {
    const factory = new IDBFactory()
    const first = new IndexedDbSavedGoogleEvents(factory)
    const second = new IndexedDbSavedGoogleEvents(factory)
    await Promise.all([first.loadMatching(BINDING), second.loadMatching(BINDING)])
    const epoch = second.discard()
    await second.settled()
    const late = first.save(copy())
    first.adopt(epoch)
    expect(await late).toBe('refused')
    expect(await raw(factory)).not.toHaveProperty('primary')
  })

  it('writes nothing before it has read the stored epoch', async () => {
    const factory = new IDBFactory()
    expect(await new IndexedDbSavedGoogleEvents(factory).save(copy())).toBe('refused')
    expect(await raw(factory)).not.toHaveProperty('primary')
  })

  it('a deletion and a later write in the same tab apply in order, whatever a read queued before them finds', async () => {
    const factory = new IDBFactory()
    const tab = new IndexedDbSavedGoogleEvents(factory)
    await tab.loadMatching(BINDING)
    await tab.save(copy())
    const reading = tab.loadMatching({ ...BINDING, plannerGeneration: 9 })
    tab.discard()
    expect(await tab.save(copy())).toBe('saved')
    await reading
    expect(await raw(factory)).toHaveProperty('primary')
    expect(await tab.save(copy())).toBe('saved')
  })
})
