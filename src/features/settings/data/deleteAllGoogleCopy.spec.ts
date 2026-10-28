import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { IndexedDbSavedGoogleEvents, SAVED_GOOGLE_DATABASE, savedCopyOf } from '@/features/calendars/googleSavedEvents'
import { i18n } from '@/i18n'
import DataSettings from './DataSettings.vue'

// Review finding (Codex, 460bb3f): Delete all data kept the saved Google Calendar copy when the build has no Google
// client ID (the GitHub Pages build, or after the ID is removed). Unit tests run without the ID, like such a build.
const NOW = new Date('2026-10-19T08:00:00Z')
let app: App | undefined
let host: HTMLElement | undefined
let device: IDBFactory

beforeEach(() => {
  setActivePinia(createPinia())
  device = new IDBFactory()
  vi.stubGlobal('indexedDB', device)
})
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; vi.unstubAllGlobals() })

it('Delete all data erases the saved Google Calendar copy in a build without the Google client ID', async () => {
  expect(import.meta.env.VITE_GOOGLE_CLIENT_ID).toBeFalsy()
  const earlierBuild = new IndexedDbSavedGoogleEvents(device)
  const binding = { workspaceId: 'workspace-1', plannerGeneration: 0, timeZone: 'UTC' }
  await earlierBuild.loadMatching(binding)
  const coverage = { start: '2026-10-12', end: '2026-11-30', timeZone: 'UTC', fetchedAt: NOW.toISOString() }
  expect(await earlierBuild.save(savedCopyOf(binding, coverage, [{ sourceId: 'google:primary', uid: 'evt-1', title: 'Standup', start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T09:30:00.000Z', allDay: false, busy: true }]))).toBe('saved')
  expect((await device.databases()).map((info) => info.name)).toContain(SAVED_GOOGLE_DATABASE)

  const repositories = createTestRepositories()
  await repositories.planner.save({ ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), revision: 1 }, 0)
  configurePlannerStore({ repository: repositories.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  host = window.document.createElement('div')
  window.document.body.append(host)
  app = createApp(DataSettings).use(getActivePinia()!).use(i18n)
  app.mount(host)
  await nextTick()
  const button = (text: string) => [...window.document.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)
  button('Delete all data…')!.click()
  await vi.waitFor(() => expect(window.document.querySelector('form.confirm input')).not.toBeNull())
  const input = window.document.querySelector<HTMLInputElement>('form.confirm input')!
  input.value = 'DELETE'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  window.document.querySelector<HTMLFormElement>('form.confirm')!.requestSubmit()
  await vi.waitFor(() => expect(usePlannerStore().document?.workspaceId).not.toBe('workspace-1'))
  // Only a random marker is left, which fences off a write still pending in another tab.
  const left = async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const open = device.open(SAVED_GOOGLE_DATABASE); open.onsuccess = () => resolve(open.result) })
    try {
      const store = db.transaction('saved', 'readonly').objectStore('saved')
      return await new Promise<Record<string, unknown>>((resolve) => {
        const keys = store.getAllKeys(), values = store.getAll()
        values.onsuccess = () => resolve(Object.fromEntries(keys.result.map((key, index) => [String(key), values.result[index]])))
      })
    } finally { db.close() }
  }
  await vi.waitFor(async () => expect(Object.keys(await left())).toEqual(['epoch']))
  expect(JSON.stringify(await left())).not.toMatch(/Standup|evt-1|google:primary/u)
})

it('Delete all data creates no Google database on a device that never had one', async () => {
  const repositories = createTestRepositories()
  await repositories.planner.save({ ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), revision: 1 }, 0)
  configurePlannerStore({ repository: repositories.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  host = window.document.createElement('div')
  window.document.body.append(host)
  app = createApp(DataSettings).use(getActivePinia()!).use(i18n)
  app.mount(host)
  await nextTick()
  ;[...window.document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Delete all data…')!.click()
  await vi.waitFor(() => expect(window.document.querySelector('form.confirm input')).not.toBeNull())
  const input = window.document.querySelector<HTMLInputElement>('form.confirm input')!
  input.value = 'DELETE'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  window.document.querySelector<HTMLFormElement>('form.confirm')!.requestSubmit()
  await vi.waitFor(() => expect(usePlannerStore().document?.workspaceId).not.toBe('workspace-1'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect((await device.databases()).map((info) => info.name)).not.toContain(SAVED_GOOGLE_DATABASE)
})
