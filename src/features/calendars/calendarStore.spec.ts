import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IDBFactory } from 'fake-indexeddb'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createEmptyDocument } from '@/core/documents'
import { configureCalendarServices, useCalendarStore } from './calendarStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import type { PlannerDocument } from '@/core/model'
const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:refresh\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
let persisted: PlannerDocument
let failSave = false
beforeEach(async () => {
  setActivePinia(createPinia())
  persisted = createEmptyDocument({ now: new Date('2026-10-19T00:00:00Z'), locale: 'en', timeZone: 'UTC' })
  failSave = false
  configurePlannerStore({
    now: () => new Date('2026-10-19T00:00:00Z'), newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC',
    repository: { load: async () => ({ kind: 'ok', document: persisted }), subscribe: () => () => undefined,
      save: async doc => { if (failSave) return { kind: 'error', reason: 'quota' }; persisted = doc; return { kind: 'ok', revision: doc.revision } } },
  })
  await usePlannerStore().load()
})
describe('calendar source lifecycle', () => {
  it('imports a file, keeps raw text, changes metadata and removes it', async () => {
    const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
    configureCalendarServices({ texts })
    const store = useCalendarStore()
    await store.importFile('Team', feed('First'))
    const source = persisted.calendarSources[0]!
    expect(await texts.get(source.id)).toBe(feed('First'))
    await store.updateSource(source.id, { name: 'Renamed', colorKey: 'green' })
    expect(persisted.calendarSources[0]?.name).toBe('Renamed')
    await store.removeSource(source.id)
    expect(persisted.calendarSources).toEqual([])
    expect(await texts.get(source.id)).toBeUndefined()
  })
  it('refreshes a changing URL, records failures and keeps the last good feed offline', async () => {
    const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
    let title = 'First', fail = false
    configureCalendarServices({ texts, fetcher: { fetch: async () => { if (fail) throw new Error('calendars.fetch'); return feed(title) } } })
    const store = useCalendarStore()
    await store.addUrl('Team', 'webcal://example.invalid/feed')
    const id = persisted.calendarSources[0]!.id
    expect(persisted.calendarSources[0]?.url).toBe('https://example.invalid/feed')
    title = 'Second'
    await store.refreshSource(id)
    expect(await texts.get(id)).toContain('SUMMARY:Second')
    fail = true
    await store.refreshSource(id)
    expect(persisted.calendarSources[0]?.lastError).toBe('calendars.fetch')
    expect(persisted.calendarSources[0]?.lastSyncedAt).toBeTruthy()
    expect(await texts.get(id)).toContain('SUMMARY:Second')
  })
  it('rolls back raw feed changes when the document save fails', async () => {
    const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
    let title = 'First'
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed(title) } })
    const store = useCalendarStore()
    await store.addUrl('Team', 'https://example.invalid/feed')
    const id = persisted.calendarSources[0]!.id
    title = 'Second'; failSave = true
    await expect(store.refreshSource(id)).rejects.toThrow('save')
    expect(await texts.get(id)).toContain('SUMMARY:First')
    await expect(store.importFile('Another', feed('Another'))).rejects.toThrow('save')
    expect(await texts.list()).toEqual([id])
  })
})

it('refreshes URL sources once on open and clears their stored error after recovery', async () => {
  const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  let calls = 0, fail = false
  configureCalendarServices({ texts, fetcher: { fetch: async () => { calls++; if (fail) throw new Error('calendars.fetch'); return feed('Current') } } })
  const store = useCalendarStore()
  await store.addUrl('Team', 'https://example.invalid/feed')
  const id = persisted.calendarSources[0]!.id
  await store.refreshOnOpen(); await store.refreshOnOpen()
  expect(calls).toBe(2)
  fail = true; await store.refreshSource(id)
  expect(persisted.calendarSources[0]?.lastError).toBe('calendars.fetch')
  fail = false; await store.refreshSource(id)
  expect(persisted.calendarSources[0]?.lastError).toBeUndefined()
})

it('restores the exact source identity and raw text for undo', async () => {
  const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  configureCalendarServices({ texts })
  const store = useCalendarStore()
  await store.importFile('Original', feed('Original'))
  const source = structuredClone(persisted.calendarSources[0]!)
  await store.removeSource(source.id)
  await store.restoreSource(source, feed('Original'))
  expect(persisted.calendarSources).toEqual([source])
  expect(await texts.get(source.id)).toBe(feed('Original'))
})
