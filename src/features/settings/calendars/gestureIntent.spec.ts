import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { IDBFactory } from 'fake-indexeddb'
import type { PlannerDocument, PlannerEvent } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories, MemoryChannelBus, MemoryStore, mutexRunner } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { useUndoToast } from '@/ui/undoToast'
import common from '@/i18n/en/common.json'
import calendarsCatalog from '@/i18n/en/calendars.json'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { configureCalendarServices } from '@/features/calendars/calendarStore'
import CalendarsSection from './CalendarsSection.vue'

// Bug family 2 at the UI layer: a calendar write is bound to the planner on screen at the user's gesture,
// even when the component awaits something (a file read, an open sheet, an undo toast) before writing.
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:before\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:Before reset\r\nEND:VEVENT\r\nEND:VCALENDAR'
const NOW = new Date('2026-10-19T08:00:00Z')
const event: PlannerEvent = { id: 'event-1', title: 'Dentist', start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:00:00.000Z', allDay: false, attendees: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let app: App | undefined
let host: HTMLElement | undefined
beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); host?.remove(); app = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

async function mounted(extra: Partial<PlannerDocument> = {}) {
  const store = new MemoryStore()
  const bus = new MemoryChannelBus()
  const runExclusive = mutexRunner()
  const texts = new IndexedDbCalendarSourceStore(new IDBFactory())
  const thisTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const otherTab = createTestRepositories({ store, bus, runExclusive, calendarTexts: texts })
  const document: PlannerDocument = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), ...extra }
  await thisTab.planner.save({ ...document, revision: 1 }, 0)
  configurePlannerStore({ repository: thisTab.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts, fetcher: { fetch: async () => ICS }, purgeGuard: thisTab.planner, now: () => NOW })
  const planner = usePlannerStore()
  await planner.load()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common, calendars: calendarsCatalog } } })
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp(CalendarsSection).use(getActivePinia()!).use(i18n)
  app.mount(host)
  await nextTick()
  const deleteAllHere = () => planner.deleteAll((draft) => { Object.assign(draft, createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), { revision: draft.revision }) })
  const deleteAllElsewhere = async () => {
    const loaded = await otherTab.planner.load()
    if (loaded.kind !== 'ok') throw new Error('expected a document')
    const fresh = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), revision: loaded.document.revision + 1 }
    expect(await otherTab.planner.deleteAll(fresh, loaded.document.revision)).toMatchObject({ kind: 'ok' })
  }
  const stored = async () => JSON.parse((await store.read(['document'])).document!) as PlannerDocument
  const button = (label: string) => [...host!.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === label)!
  return { planner, texts, deleteAllHere, deleteAllElsewhere, stored, button }
}

describe('gesture-bound calendar writes', () => {
  it('a file chosen before a delete-all, whose read finishes after it, is not imported (review finding)', async () => {
    const { planner, texts, deleteAllHere, stored } = await mounted()
    const read = deferred<string>()
    const file = new File([ICS], 'Before reset.ics', { type: 'text/calendar' })
    vi.spyOn(file, 'text').mockReturnValue(read.promise)
    const input = host!.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    expect(await deleteAllHere()).toEqual({ ok: true })
    read.resolve(ICS)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await stored()).calendarSources).toEqual([])
    expect(planner.document?.calendarSources).toEqual([])
    expect(await texts.list()).toEqual([])
  })

  it('an event sheet opened before another tab deleted everything does not save into the fresh planner', async () => {
    const { planner, deleteAllElsewhere, stored, button } = await mounted()
    button('New event').click()
    await nextTick(); await nextTick()
    const dialog = window.document.querySelector('[role=dialog]')!
    const title = [...dialog.querySelectorAll('label')].find((node) => node.textContent?.trim().startsWith('Title'))!.querySelector('input')!
    title.value = 'Opened before reset'; title.dispatchEvent(new Event('input', { bubbles: true }))
    await deleteAllElsewhere()
    await planner.load()
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await stored()).events).toEqual([])
    expect(planner.document?.events).toEqual([])
  })

  it('undoing an event removal after another tab deleted everything restores nothing', async () => {
    const { planner, deleteAllElsewhere, stored } = await mounted({ events: [event] })
    const remove = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.getAttribute('aria-label')?.includes('Dentist') || node.closest('li')?.textContent?.includes('Dentist') && node.textContent?.trim() === 'Remove')
    expect(remove).toBeDefined()
    remove!.click()
    await vi.waitFor(() => expect(useUndoToast().toast.value).not.toBeNull())
    expect((await stored()).events).toEqual([])
    await deleteAllElsewhere()
    await planner.load()
    useUndoToast().undo()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await stored()).events).toEqual([])
    expect(planner.document?.events).toEqual([])
  })
})
