// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { testDocument } from '@/repositories/testSupport'
import { SUPPORTED_LOCALES } from '@/i18n'
import { FIRST_SEEN_KEY } from './data/exportReminder'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from './testSupport'
import SettingsHome from './SettingsHome.vue'
import { settingsPageOf } from './route'

const done = { settings: { ...testDocument().settings, onboardingDone: true }, categories: [WORK, SLEEP] }
let mounted: Mounted | undefined
const headings = () => [...mounted!.host.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())
beforeEach(() => { localStorage.clear(); window.location.hash = '#/settings'; Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false }, configurable: true }) })
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

it('lists Categories, Appearance (the owner’s one exception) and Data at the top level, with one row to Integrations and advanced', async () => {
  mounted = await mountWithPlanner(SettingsHome, done)
  expect(headings()).toEqual(['Categories', 'Appearance', 'Data', 'Delete all data'])
  expect(mounted.host.querySelector('[role=radiogroup][aria-label=Appearance]')).not.toBeNull()
  expect(mounted.host.querySelector('.calendar-section, .connect-settings, .assistant-settings')).toBeNull()
  expect(mounted.host.textContent).not.toContain('Where your data lives')
  const link = mounted.host.querySelector<HTMLAnchorElement>('[data-testid=advanced-link]')!
  expect(link.getAttribute('href')).toBe('#/settings/advanced')
  expect(link.textContent).toContain('Integrations and advanced')
})

it('keeps every integration reachable on the advanced page, with a way back and no duplicate data card', async () => {
  window.location.hash = '#/settings/advanced'
  mounted = await mountWithPlanner(SettingsHome, done)
  const page = mounted.host.querySelector('[data-testid=settings-advanced]')!
  expect(page.querySelector('.calendar-section')).not.toBeNull()
  expect(page.querySelector('.connect-settings')).not.toBeNull()
  expect(page.querySelector('.assistant-settings')).not.toBeNull()
  expect(page.querySelector('[data-testid=persistence-status]')).not.toBeNull()
  expect(page.querySelector('[data-testid=data-origin]')).not.toBeNull()
  expect(page.querySelector('[data-testid=data-workspace]')!.textContent).toBe('workspace-1')
  expect(page.textContent).toContain('Technical details')
  expect(page.textContent).not.toContain('Where your data lives')
  expect(page.textContent).not.toMatch(/\bLLM\b/)
  expect(page.querySelector<HTMLAnchorElement>('[data-testid=back-button]')!.getAttribute('href')).toBe('#/settings')
})

it('follows the hash between the list and the sub-page', async () => {
  mounted = await mountWithPlanner(SettingsHome, done)
  window.location.hash = '#/settings/advanced'
  await vi.waitFor(() => expect(mounted!.host.querySelector('[data-testid=settings-advanced]')).not.toBeNull())
  window.location.hash = '#/settings'
  await vi.waitFor(() => expect(mounted!.host.querySelector('[data-testid=settings-advanced]')).toBeNull())
  expect(settingsPageOf('#/settings/advanced')).toBe('advanced')
  expect(settingsPageOf('#/settings')).toBe('home')
  expect(settingsPageOf('#/week/advanced')).toBe('home')
})

it('nudges for a weekly backup, exports from the nudge and then goes quiet', async () => {
  localStorage.setItem(FIRST_SEEN_KEY, new Date(Date.now() - 10 * 86_400_000).toISOString())
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  HTMLAnchorElement.prototype.click = vi.fn()
  mounted = await mountWithPlanner(SettingsHome, done)
  await nextTick()
  const nudge = () => mounted!.host.querySelector('[data-testid=export-nudge]')
  expect(nudge()!.textContent).toContain("You haven't exported a backup yet.")
  nudge()!.querySelector<HTMLButtonElement>('button')!.click()
  await vi.waitFor(() => expect(nudge()).toBeNull())
})

it.each(SUPPORTED_LOCALES)('%s renders a localized reminder dismiss button and snoozes across visits', async (locale) => {
  const labels = { en: 'Dismiss', es: 'Descartar', fr: 'Ignorer', pt: 'Dispensar', de: 'Ausblenden' }
  localStorage.setItem(FIRST_SEEN_KEY, new Date(Date.now() - 10 * 86_400_000).toISOString())
  mounted = await mountWithPlanner(SettingsHome, done, locale)
  const nudge = mounted.host.querySelector('[data-testid=export-nudge]')!
  const dismiss = nudge.querySelector<HTMLButtonElement>('button:last-child')!
  expect(dismiss.textContent?.trim()).toBe(labels[locale])
  dismiss.click()
  await nextTick()
  expect(mounted.host.querySelector('[data-testid=export-nudge]')).toBeNull()
  mounted.unmount()
  mounted = await mountWithPlanner(SettingsHome, done, locale)
  expect(mounted.host.querySelector('[data-testid=export-nudge]')).toBeNull()
})
