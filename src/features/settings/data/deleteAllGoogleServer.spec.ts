import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createEmptyDocument } from '@/core/documents'
import { createTestRepositories } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import type { ForgetOutcome } from '@/features/calendars/google/serverConnection'
import DataSettings from './DataSettings.vue'

// A-13 (app half): in a server build Delete all data asks the server to forget this device before the wipe, whatever the
// labs flag and the saved-copy database say, and tells the person what remains when it could not.
const NOW = new Date('2026-10-19T08:00:00Z')
const order: string[] = []
let outcome: ForgetOutcome
let app: App | undefined
let host: HTMLElement | undefined
const forgetThisDevice = vi.fn(async (revoke: boolean, options?: { deadlineMs?: number }) => {
  order.push(`forget:${revoke}:${options?.deadlineMs}`)
  return outcome
})

vi.mock('@/features/calendars/google/serverConnection', () => ({ browserServerConnection: () => ({ forgetThisDevice }) }))

beforeEach(() => {
  setActivePinia(createPinia())
  order.length = 0
  forgetThisDevice.mockClear()
  outcome = 'forgotten'
  vi.stubEnv('VITE_GOOGLE_SERVER', '1')
})
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear() })

async function deleteAll(): Promise<void> {
  const repositories = createTestRepositories()
  await repositories.planner.save({ ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }), revision: 1 }, 0)
  const original = repositories.planner.deleteAll?.bind(repositories.planner)
  if (original) repositories.planner.deleteAll = async (...args) => { order.push('wipe'); return original(...args) }
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
  await nextTick()
}

const note = () => window.document.querySelector('[data-testid=google-delete-note]')

describe('A-13 Delete all data in a server build', () => {
  it('forgets this device first (revoke:false, 5 s), then wipes; no Google message when the server confirmed', async () => {
    expect(localStorage.getItem('next168-labs-google')).toBeNull()
    await deleteAll()
    expect(order.slice(0, 2)).toEqual(['forget:false:5000', 'wipe'])
    expect(note()).toBeNull()
  })

  it.each(['cleared'] as const)('%s → done, no Google message', async (result) => {
    outcome = result
    await deleteAll()
    expect(forgetThisDevice).toHaveBeenCalledTimes(1)
    expect(note()).toBeNull()
  })

  it('the server could not be reached → the wipe still runs, and the message names what remains with the link', async () => {
    outcome = 'failed'
    await deleteAll()
    expect(order).toContain('wipe')
    expect(note()?.textContent).toContain('Weeklid couldn\'t reach its server')
    expect(note()?.querySelector('a')?.getAttribute('href')).toBe('https://myaccount.google.com/connections')
  })

  it('offline → no request, the wipe runs, same message', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    await deleteAll()
    expect(forgetThisDevice).not.toHaveBeenCalled()
    expect(order).toContain('wipe')
    expect(note()?.textContent).toContain('myaccount.google.com/connections')
    expect(note()?.querySelector('a')?.getAttribute('href')).toBe('https://myaccount.google.com/connections')
  })

  it('no cookie (noDevice after none) → the wipe runs and the message says access may remain, with the link and no success claim', async () => {
    outcome = 'mayRemain'
    await deleteAll()
    expect(order).toContain('wipe')
    expect(note()?.textContent).toContain('couldn\'t confirm that its access')
    expect(note()?.textContent).not.toMatch(/was deleted|stays until/)
    expect(note()?.querySelector('a')?.getAttribute('href')).toBe('https://myaccount.google.com/connections')
  })

  it('a build without the server flag never loads or calls the server client', async () => {
    vi.stubEnv('VITE_GOOGLE_SERVER', '')
    await deleteAll()
    expect(forgetThisDevice).not.toHaveBeenCalled()
    expect(note()).toBeNull()
  })
})
