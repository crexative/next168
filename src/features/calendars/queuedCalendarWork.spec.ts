import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { IDBFactory } from 'fake-indexeddb'
import type { CalendarSource, PlannerDocument } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryChannelBus, MemoryStore, mutexRunner } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { useUndoToast } from '@/ui/undoToast'
import common from '@/i18n/en/common.json'
import calendarsCatalog from '@/i18n/en/calendars.json'
import CalendarsSection from '@/features/settings/calendars/CalendarsSection.vue'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { cancelCalendarRefreshes, configureCalendarServices, useCalendarStore } from './calendarStore'

// Bug family 2: calendar work that is queued, deferred or offered for undo is bound to the planner the user acted
// on (its workspace and purge epoch) when the action is initiated, not when the queued work finally runs.
const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${title}\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
const NOW = new Date('2026-10-19T00:00:00Z')
const urlSource: CalendarSource = { id: 'url-source', name: 'Team', kind: 'url', url: 'https://calendar.example/team.ics', colorKey: 'purple', lastSyncedAt: NOW.toISOString() }
const removedSource: CalendarSource = { id: 'removed-source', name: 'Old file', kind: 'file', colorKey: 'blue', lastSyncedAt: NOW.toISOString() }

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function setup(sources: CalendarSource[] = [urlSource]) {
  const store = new MemoryStore()
  const bus = new MemoryChannelBus()
  const runExclusive = mutexRunner()
  const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  const thisTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const otherTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const document: PlannerDocument = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), calendarSources: sources }
  await thisTab.planner.save({ ...document, revision: 1 }, 0)
  for (const source of sources) await texts.put(source.id, feed(source.name))
  configurePlannerStore({ repository: thisTab.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  const deleteAllElsewhere = async () => {
    const loaded = await otherTab.planner.load()
    if (loaded.kind !== 'ok') throw new Error('expected a document')
    const fresh = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), revision: loaded.document.revision + 1 }
    expect(await otherTab.planner.deleteAll(fresh, loaded.document.revision)).toMatchObject({ kind: 'ok' })
  }
  const deleteAllHere = () => planner.deleteAll((draft) => { Object.assign(draft, createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), { revision: draft.revision }) })
  const storedSources = async () => (JSON.parse((await store.read(['document'])).document!) as PlannerDocument).calendarSources
  return { thisTab, texts, planner, deleteAllElsewhere, deleteAllHere, storedSources }
}

let app: App | undefined
let host: HTMLElement | undefined
beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); host?.remove(); app = undefined; vi.restoreAllMocks() })

describe('calendar work queued before a delete-all', () => {
  it('a restore queued behind a pending refresh does not resurrect the source after delete-all (review finding)', async () => {
    const { thisTab, texts, planner, deleteAllHere, storedSources } = await setup()
    const fetched = deferred<string>()
    configureCalendarServices({ texts, fetcher: { fetch: () => fetched.promise }, purgeGuard: thisTab.planner, now: () => NOW })
    const calendars = useCalendarStore()
    const refresh = calendars.refreshSource(urlSource.id).catch((error: unknown) => error)
    const restore = calendars.restoreSource(removedSource, feed('Old file')).catch((error: unknown) => error)
    cancelCalendarRefreshes()
    expect(await deleteAllHere()).toEqual({ ok: true })
    fetched.resolve(feed('New'))
    await refresh
    await restore
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })

  it('a file import queued behind a pending refresh does not land in the fresh planner', async () => {
    const { thisTab, texts, planner, deleteAllHere, storedSources } = await setup()
    const fetched = deferred<string>()
    configureCalendarServices({ texts, fetcher: { fetch: () => fetched.promise }, purgeGuard: thisTab.planner, now: () => NOW })
    const calendars = useCalendarStore()
    const refresh = calendars.refreshSource(urlSource.id).catch((error: unknown) => error)
    const imported = calendars.importFile('Queued', feed('Queued')).catch((error: unknown) => error)
    expect(await deleteAllHere()).toEqual({ ok: true })
    fetched.resolve(feed('New'))
    await refresh
    expect(await imported).toMatchObject({ message: 'calendars.save' })
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })

  it('a URL subscription queued behind a pending refresh does not land in the fresh planner', async () => {
    const { thisTab, texts, planner, deleteAllHere, storedSources } = await setup()
    const first = deferred<string>()
    let calls = 0
    configureCalendarServices({ texts, fetcher: { fetch: () => (++calls === 1 ? first.promise : Promise.resolve(feed('Added'))) }, purgeGuard: thisTab.planner, now: () => NOW })
    const calendars = useCalendarStore()
    const refresh = calendars.refreshSource(urlSource.id).catch((error: unknown) => error)
    const added = calendars.addUrl('Added', 'https://calendar.example/added.ics').catch((error: unknown) => error)
    expect(await deleteAllHere()).toEqual({ ok: true })
    first.resolve(feed('New'))
    await refresh
    expect(await added).toMatchObject({ message: 'calendars.save' })
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })

  it('a rename and a removal queued behind a pending refresh do not commit into the fresh planner', async () => {
    const { thisTab, texts, planner, deleteAllHere } = await setup()
    const fetched = deferred<string>()
    configureCalendarServices({ texts, fetcher: { fetch: () => fetched.promise }, purgeGuard: thisTab.planner, now: () => NOW })
    const calendars = useCalendarStore()
    const refresh = calendars.refreshSource(urlSource.id).catch((error: unknown) => error)
    const renamed = calendars.updateSource(urlSource.id, { name: 'Renamed' }).catch((error: unknown) => error)
    const removed = calendars.removeSource(urlSource.id).catch((error: unknown) => error)
    expect(await deleteAllHere()).toEqual({ ok: true })
    const reset = planner.document!.revision
    fetched.resolve(feed('New'))
    await refresh
    expect(await renamed).toMatchObject({ message: 'calendars.save' })
    expect(await removed).toMatchObject({ message: 'calendars.save' })
    expect(planner.document?.revision).toBe(reset)
  })

  it('a calendar imported after a delete-all in this tab is accepted into the fresh planner', async () => {
    const { thisTab, texts, planner, deleteAllHere, storedSources } = await setup()
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('unused') }, purgeGuard: thisTab.planner, now: () => NOW })
    expect(await deleteAllHere()).toEqual({ ok: true })
    await useCalendarStore().importFile('After reset', feed('After reset'))
    expect((await storedSources()).map((source) => source.name)).toEqual(['After reset'])
    expect(planner.document?.calendarSources.map((source) => source.name)).toEqual(['After reset'])
    expect(await texts.list()).toHaveLength(1)
  })

  it('refreshes started on open before another tab deleted everything write nothing after this tab reloads', async () => {
    const { thisTab, texts, planner, deleteAllElsewhere, storedSources } = await setup()
    const fetched = deferred<string>()
    configureCalendarServices({ texts, fetcher: { fetch: () => fetched.promise }, purgeGuard: thisTab.planner, now: () => NOW })
    const refreshing = useCalendarStore().refreshOnOpen().catch((error: unknown) => error)
    await deleteAllElsewhere()
    await planner.load()
    fetched.resolve(feed('New'))
    await refreshing
    expect(await storedSources()).toEqual([])
    expect(await texts.list()).toEqual([])
  })
})

describe('undo offered before a delete-all', () => {
  it('undoing a calendar removal after another tab deleted everything restores nothing', async () => {
    const { thisTab, texts, planner, deleteAllElsewhere, storedSources } = await setup([removedSource])
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('unused') }, purgeGuard: thisTab.planner, now: () => NOW })
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common, calendars: calendarsCatalog } } })
    host = document.createElement('div'); document.body.append(host)
    app = createApp(CalendarsSection).use(i18n)
    app.use((await import('pinia')).getActivePinia()!)
    app.mount(host)
    await nextTick()
    const remove = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Remove')!
    remove.click()
    await vi.waitFor(() => expect(useUndoToast().toast.value).not.toBeNull())
    expect(await storedSources()).toEqual([])
    await deleteAllElsewhere()
    await planner.load()
    useUndoToast().undo()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await storedSources()).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })
})

describe('undo offered before the workspace was replaced', () => {
  it('undoing a calendar removal after an import replaced the workspace restores nothing into it', async () => {
    const { thisTab, texts, planner, storedSources } = await setup([removedSource])
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('unused') }, purgeGuard: thisTab.planner, now: () => NOW })
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common, calendars: calendarsCatalog } } })
    host = document.createElement('div'); document.body.append(host)
    app = createApp(CalendarsSection).use(i18n)
    app.use((await import('pinia')).getActivePinia()!)
    app.mount(host)
    await nextTick()
    const remove = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Remove')!
    remove.click()
    await vi.waitFor(() => expect(useUndoToast().toast.value).not.toBeNull())
    // An import replaces the content with another workspace; the purge epoch does not change.
    expect((await planner.commit((draft) => { draft.workspaceId = 'workspace-imported'; draft.calendarSources = [] })).ok).toBe(true)
    useUndoToast().undo()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await storedSources()).toEqual([])
    expect(await texts.list()).toEqual([])
  })
})

describe('a Data import confirmed before a delete-all', () => {
  it('writes no calendar texts once another tab deleted everything after the import committed', async () => {
    const { thisTab, texts, planner, deleteAllElsewhere } = await setup([])
    configureCalendarServices({ texts, fetcher: { fetch: async () => feed('unused') }, purgeGuard: thisTab.planner, now: () => NOW })
    const { default: registerCalendars } = await import('./index')
    registerCalendars({ registerView: () => undefined, registerSettingsSection: () => undefined })
    const { buildExportFile } = await import('@/features/settings/data/dataTransfer')
    const imported: PlannerDocument = { ...planner.document!, calendarSources: [removedSource] }
    const bundle = await buildExportFile(imported, { get: async () => feed('Imported'), put: async () => undefined, delete: async () => undefined, list: async () => [] }, { now: () => NOW })
    // The other tab resets everything right after this tab's import commit, before its calendar texts are written.
    const saveAtEpoch = thisTab.planner.saveAtEpoch.bind(thisTab.planner)
    thisTab.planner.saveAtEpoch = async (...args) => {
      const saved = await saveAtEpoch(...args)
      await deleteAllElsewhere()
      return saved
    }
    const { i18n } = await import('@/i18n')
    const { default: DataSettings } = await import('@/features/settings/data/DataSettings.vue')
    host = document.createElement('div'); document.body.append(host)
    app = createApp(DataSettings).use((await import('pinia')).getActivePinia()!).use(i18n)
    app.mount(host)
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [new File([bundle.json], bundle.fileName, { type: 'application/json' })], configurable: true })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(host!.querySelector('[data-testid=import-preview]')).not.toBeNull())
    const replace = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Replace my data')!
    replace.click()
    await vi.waitFor(() => expect(host!.querySelector('[data-testid=data-notice]')?.textContent).toBeTruthy())
    expect(await texts.list()).toEqual([])
    expect(host.querySelector('[data-testid=data-notice]')?.textContent).not.toContain('verified')
  })
})
