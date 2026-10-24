import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { IDBFactory } from 'fake-indexeddb'
import type { CalendarSource, CalendarSourceStore, PlannerDocument } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryChannelBus, MemoryStore, mutexRunner } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { cancelCalendarRefreshes, configureCalendarServices, useCalendarStore } from './calendarStore'

// Coordinator correction 1: a calendar refresh that started before a delete-all must write nothing after it.
const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:race\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
const NOW = new Date('2026-10-19T00:00:00Z')
const source: CalendarSource = { id: 'source-old', name: 'Team', kind: 'url', url: 'https://calendar.example/team.ics', colorKey: 'purple', lastSyncedAt: NOW.toISOString() }

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function twoTabs() {
  const store = new MemoryStore()
  const bus = new MemoryChannelBus()
  const runExclusive = mutexRunner()
  const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  const thisTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const otherTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const document: PlannerDocument = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), calendarSources: [source] }
  await thisTab.planner.save({ ...document, revision: 1 }, 0)
  await texts.put(source.id, feed('Old'))
  setActivePinia(createPinia())
  configurePlannerStore({ repository: thisTab.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  // The other tab deletes everything from the revision it has loaded.
  const deleteAllElsewhere = async () => {
    const loaded = await otherTab.planner.load()
    if (loaded.kind !== 'ok') throw new Error('expected a document')
    const fresh = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), revision: loaded.document.revision + 1 }
    expect(await otherTab.planner.deleteAll(fresh, loaded.document.revision)).toMatchObject({ kind: 'ok' })
  }
  const storedSources = async () => (JSON.parse((await store.read(['document'])).document!) as PlannerDocument).calendarSources
  return { thisTab, texts, planner, deleteAllElsewhere, storedSources }
}

// Pauses the refresh right after it read the previous text, before it writes anything: the red-team's interleaving.
function pausingAfterRead(texts: CalendarSourceStore) {
  const reached = deferred()
  const resume = deferred()
  let armed = true
  const wrapped: CalendarSourceStore = {
    get: async (id) => {
      const value = await texts.get(id)
      if (armed) { armed = false; reached.resolve(); await resume.promise }
      return value
    },
    put: (id, text) => texts.put(id, text),
    delete: (id) => texts.delete(id),
    list: () => texts.list(),
  }
  return { wrapped, reached: reached.promise, resume: resume.resolve }
}

beforeEach(() => { setActivePinia(createPinia()) })

describe('calendar writes racing a delete-all', () => {
  it('a refresh paused after reading the old text writes nothing once another tab deleted everything', async () => {
    const { thisTab, texts, deleteAllElsewhere, storedSources } = await twoTabs()
    const pause = pausingAfterRead(texts)
    configureCalendarServices({ texts: pause.wrapped, fetcher: { fetch: async () => feed('New') }, purgeGuard: thisTab.planner, now: () => NOW })
    const refresh = useCalendarStore().refreshSource(source.id).catch((error: unknown) => error)
    await pause.reached
    await deleteAllElsewhere()
    expect(await texts.list()).toEqual([])
    pause.resume()
    await refresh
    // Without the epoch guard the failed commit's rollback writes the old text back (red-team finding 1).
    expect(await texts.list()).toEqual([])
    expect(await texts.get(source.id)).toBeUndefined()
    expect(await storedSources()).toEqual([])
  })

  it('a refresh whose text landed before the delete-all cannot restore it from its rollback', async () => {
    const { thisTab, texts, deleteAllElsewhere, storedSources } = await twoTabs()
    const reached = deferred()
    const resume = deferred()
    const saveAtEpoch = thisTab.planner.saveAtEpoch.bind(thisTab.planner)
    thisTab.planner.saveAtEpoch = async (...args) => { reached.resolve(); await resume.promise; return saveAtEpoch(...args) }
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('New') }, purgeGuard: thisTab.planner, now: () => NOW })
    const refresh = useCalendarStore().refreshSource(source.id).catch((error: unknown) => error)
    await reached.promise
    expect(await texts.get(source.id)).toBe(feed('New'))
    await deleteAllElsewhere()
    expect(await texts.list()).toEqual([])
    resume.resolve()
    expect(await refresh).toMatchObject({ message: 'calendars.save' })
    expect(await texts.list()).toEqual([])
    expect(await storedSources()).toEqual([])
  })

  it('a refresh whose text landed before a delete-all in this tab cannot add its source to the fresh planner', async () => {
    const { thisTab, texts, planner, storedSources } = await twoTabs()
    const reached = deferred()
    const resume = deferred()
    let first = true
    // Pauses right after the guarded text write, when the lock is free again and before the document commit.
    const purgeGuard = {
      knownPurgeEpoch: () => thisTab.planner.knownPurgeEpoch(),
      ifPurgeEpoch: async (epoch: number, write: () => Promise<void>) => {
        const written = await thisTab.planner.ifPurgeEpoch(epoch, write)
        if (first) { first = false; reached.resolve(); await resume.promise }
        return written
      },
    }
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('New') }, purgeGuard, now: () => NOW })
    const refresh = useCalendarStore().refreshSource(source.id).catch((error: unknown) => error)
    await reached.promise
    expect(await planner.deleteAll((draft) => { draft.calendarSources = []; draft.workspaceId = 'workspace-2' })).toEqual({ ok: true })
    resume.resolve()
    // The commit builds on the fresh planner, so only the purge epoch can refuse it.
    expect(await refresh).toMatchObject({ message: 'calendars.save' })
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })

  it('a slow refresh in this tab finishes after delete-all without any calendar data reappearing', async () => {
    const { thisTab, texts, planner, storedSources } = await twoTabs()
    const fetched = deferred<string>()
    let signal: AbortSignal | undefined
    configureCalendarServices({ texts, fetcher: { fetch: (_url, abort) => { signal = abort; return fetched.promise } }, purgeGuard: thisTab.planner, now: () => NOW })
    const refresh = useCalendarStore().refreshSource(source.id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await planner.deleteAll((draft) => { draft.calendarSources = []; draft.workspaceId = 'workspace-2' })).toEqual({ ok: true })
    fetched.resolve(feed('New'))
    await refresh
    expect(signal?.aborted).toBe(false)
    expect(await texts.list()).toEqual([])
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
  })

  it('delete-all cancels the refreshes this tab has in flight', async () => {
    const { thisTab, texts } = await twoTabs()
    let signal: AbortSignal | undefined
    configureCalendarServices({ texts, fetcher: { fetch: (_url, abort) => { signal = abort; return new Promise((_resolve, reject) => abort?.addEventListener('abort', () => reject(new Error('aborted')))) } }, purgeGuard: thisTab.planner, now: () => NOW })
    const refresh = useCalendarStore().refreshSource(source.id)
    await new Promise((resolve) => setTimeout(resolve, 0))
    cancelCalendarRefreshes()
    expect(signal?.aborted).toBe(true)
    await expect(refresh).resolves.toBeUndefined()
    expect(await texts.get(source.id)).toBe(feed('Old'))
  })
})
