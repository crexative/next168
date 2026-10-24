import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import type { PlannerDocument } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import DataSettings from './DataSettings.vue'
import { buildExportFile } from './dataTransfer'

// Bug family 2 at the UI layer: the Data import awaits the file read before it previews; the preview is bound to
// the document shown when the file was chosen, so a delete-all during the read refuses the import.
const NOW = new Date('2026-10-19T08:00:00Z')
let app: App | undefined
let host: HTMLElement | undefined
beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; vi.restoreAllMocks() })

it('a file chosen before a delete-all, whose read finishes after it, does not replace the fresh planner', async () => {
  const repositories = createTestRepositories()
  const shown: PlannerDocument = { ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), revision: 1 }
  await repositories.planner.save(shown, 0)
  configurePlannerStore({ repository: repositories.planner, now: () => NOW, newId: () => crypto.randomUUID(), locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  const imported = { ...shown, workspaceId: 'workspace-imported', checkIns: [{ date: '2026-10-19', note: 'imported' }] }
  const bundle = await buildExportFile(imported, undefined, { now: () => NOW })
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp(DataSettings).use(getActivePinia()!).use(i18n)
  app.mount(host)
  await nextTick()
  let finishRead!: (text: string) => void
  const file = new File([bundle.json], bundle.fileName, { type: 'application/json' })
  vi.spyOn(file, 'text').mockReturnValue(new Promise((resolve) => { finishRead = resolve }))
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  expect(await planner.deleteAll((draft) => { Object.assign(draft, createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-2' }), { revision: draft.revision }) })).toEqual({ ok: true })
  finishRead(bundle.json)
  await vi.waitFor(() => expect(host!.querySelector('[data-testid=import-preview]')).not.toBeNull())
  ;[...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Replace my data')!.click()
  await vi.waitFor(() => expect(host!.querySelector('[data-testid=data-notice]')?.textContent).toContain('changed in the meantime'))
  expect(planner.document?.workspaceId).toBe('workspace-2')
  expect(planner.document?.checkIns).toEqual([])
})
