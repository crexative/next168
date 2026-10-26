// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, h, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { Workspace } from '../../companion/src/workspace'
import Root from '@/App.vue'
import PreferencesSettings from '@/app/settings/PreferencesSettings.vue'
import { CompanionRepository, pairCompanion } from '@/repositories/CompanionRepository'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { detectLocale, i18n, setLocale } from './index'

vi.mock('@/app/AppShell.vue', () => ({ default: { render: () => h(PreferencesSettings) } }))
vi.mock('@/app/updates', () => ({ listenForUpdates: () => () => undefined }))
vi.mock('@/ui/appearance', async (original) => ({ ...(await original<object>()), installAppearance: () => undefined }))

let app: App | undefined
let home: string | undefined
let stop = () => undefined as void
afterEach(async () => {
  app?.unmount(); stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''
  if (home) await rm(home, { recursive: true, force: true })
})

it.each([
  ['pairing', null, 'es'], ['proposal', null, 'es'], ['pairing', 'de', 'de'], ['proposal', 'de', 'de'],
] as const)('keeps an es-CO device with preference %s / %s in %s', async (path, preference, expected) => {
  home = await mkdtemp(join(tmpdir(), 'next168-locale-ui-'))
  const workspace = new Workspace(home)
  await workspace.initialize()
  if (path === 'proposal') {
    const document = await workspace.document()
    const proposal = await workspace.create({ contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 0, summary: 'Read', ops: [{ op: 'add_task', task: { title: 'Read', durationMin: 15, priority: 1 } }] }, 'mcp')
    await workspace.approve(proposal.id, proposal.contentHash, 0)
  }
  localStorage.clear()
  if (preference) localStorage.setItem('next168-language', preference)
  vi.stubGlobal('navigator', { ...navigator, language: 'es-CO', languages: ['es-CO'] })
  setLocale(detectLocale())
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/pair' ? { paired: true } : { document: await workspace.document() }), { status: 200 })))
  await pairCompanion('synthetic-code')
  const repository = new CompanionRepository()
  const subscribe = repository.subscribe.bind(repository)
  vi.spyOn(repository, 'subscribe').mockImplementation((listener) => { stop = subscribe(listener); return stop })
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository, now: () => new Date(), newId: () => 'unused', locale: () => i18n.global.locale.value, timeZone: () => 'UTC' })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(Root).use(pinia).use(i18n)
  app.mount(host)
  await vi.waitFor(() => expect(usePlannerStore().status).toBe('ready'))
  expect(i18n.global.locale.value).toBe(expected)
  expect(document.documentElement.lang).toBe(expected)
  expect(host.querySelector<HTMLSelectElement>('[data-testid=preference-language]')!.value).toBe(expected)
})
