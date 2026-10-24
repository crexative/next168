import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { IDBFactory } from 'fake-indexeddb'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { configureCalendarServices } from './calendarStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import common from '@/i18n/en/common.json'
import CalendarsSection from '@/features/settings/calendars/CalendarsSection.vue'

const catalogs = import.meta.glob<{ default: Record<string, unknown> }>('../../i18n/*/calendars.json', { eager: true })
let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); vi.restoreAllMocks() })

it('renders translated Settings and creates a meeting through the actual sheet form', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const repositories = createTestRepositories()
  configurePlannerStore({ repository: repositories.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'America/Bogota' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()) })
  const planner = usePlannerStore()
  await planner.load()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common, calendars: catalogs['../../i18n/en/calendars.json']!.default } } })
  host = document.createElement('div'); document.body.append(host)
  app = createApp(CalendarsSection).use(pinia).use(i18n)
  app.mount(host)
  const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === 'New event')!
  button.click(); await nextTick(); await nextTick()
  const dialog = document.querySelector('[role=dialog]')!
  expect(dialog).not.toBeNull()
  const fill = (label: string, value: string) => {
    const input = [...dialog.querySelectorAll('label')].find(node => node.textContent?.trim() === label)?.querySelector('input')
    expect(input).toBeTruthy()
    input!.value = value; input!.dispatchEvent(new Event('input', { bubbles: true }))
  }
  fill('Title', 'UI meeting'); fill('Date', '2026-10-20'); fill('Time', '09:30')
  fill('Attendees (email addresses)', 'one@example.invalid, two@example.invalid')
  await nextTick()
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
  expect(planner.document!.events[0]).toMatchObject({ title: 'UI meeting', start: '2026-10-20T14:30:00.000Z', attendees: ['one@example.invalid', 'two@example.invalid'] })
  await nextTick()
  expect(host.textContent).toContain('UI meeting')
  expect(host.querySelector('a[href^="https://calendar.google.com"]')).not.toBeNull()
})

it.each(['en', 'es', 'fr', 'pt', 'de'])('compiles every %s calendar message without syntax errors', (locale) => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const catalog = catalogs[`../../i18n/${locale}/calendars.json`]!.default
  const i18n = createI18n({ legacy: false, locale, messages: { [locale]: { calendars: catalog } } })
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === 'string') expect(i18n.global.t(`calendars.${key}`, { name: 'Calendar', time: '09:00', zone: 'UTC' })).not.toBe(`calendars.${key}`)
  }
  expect(errors).not.toHaveBeenCalled()
})
