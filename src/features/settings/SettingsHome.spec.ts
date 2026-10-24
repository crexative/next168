// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { testDocument } from '@/repositories/testSupport'
import { SUPPORTED_LOCALES } from '@/i18n'
import { displayLocale, formatClock, setHourCycle } from '@/ui/format'
import { FIRST_SEEN_KEY } from './data/exportReminder'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from './testSupport'
import SettingsHome from './SettingsHome.vue'
import { settingsPageOf } from './route'

const done = { settings: { ...testDocument().settings, onboardingDone: true }, categories: [WORK, SLEEP] }
let mounted: Mounted | undefined
const headings = () => [...mounted!.host.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())
beforeEach(() => { localStorage.clear(); window.location.hash = '#/settings'; Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false }, configurable: true }) })
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

const links = () => [...mounted!.host.querySelectorAll('[data-testid=settings-more] a')].map((link) => [link.getAttribute('href'), link.querySelector('.t-body')?.textContent?.trim()])
const filled = () => [...mounted!.host.querySelectorAll('.ui-button.is-filled')].map((button) => button.textContent?.trim())
const JARGON = /MCP|JSON|WebGPU|snapshot|prompt|workspace-1|Workspace/i

it('orders the list as Categories and goals, General, then Calendars, Your data and Advanced, with no filled button', async () => {
  mounted = await mountWithPlanner(SettingsHome, done)
  expect(headings()).toEqual(['Categories and goals', 'General'])
  expect(links()).toEqual([
    ['#/settings/calendars', 'Calendars'],
    ['#/settings/ai', 'Use with your AI (ChatGPT, Claude, Gemini…)'],
    ['#/settings/data', 'Your data'],
    ['#/settings/advanced', 'Advanced'],
  ])
  const general = mounted.host.querySelector('[data-testid=general-settings]')!
  expect(general.querySelector('[data-testid=preference-language]')).not.toBeNull()
  expect([...general.querySelectorAll('[role=radiogroup]')].map((group) => group.getAttribute('aria-label'))).toEqual(['Week starts on', 'Time format', 'Appearance'])
  // Destructive and technical things live one level down.
  expect(mounted.host.textContent).not.toContain('Delete all data')
  expect(mounted.host.textContent).not.toContain('Export backup')
  expect(mounted.host.textContent).not.toMatch(JARGON)
  expect(mounted.host.querySelector('.calendar-section, .connect-settings, .assistant-settings, .data')).toBeNull()
  expect(filled()).toEqual([])
})

it('keeps export, import and delete together under Your data, with a way back and no filled button', async () => {
  window.location.hash = '#/settings/data'
  mounted = await mountWithPlanner(SettingsHome, done)
  const page = mounted.host.querySelector('[data-testid=settings-data]')!
  expect(page.querySelector('h2')!.textContent).toBe('Your data')
  const actions = [...page.querySelectorAll('.ui-button')].map((button) => button.textContent?.trim())
  expect(actions).toEqual(['Export backup', 'Import file…', 'Delete all data…'])
  expect(page.querySelector<HTMLAnchorElement>('[data-testid=back-button]')!.getAttribute('href')).toBe('#/settings')
  expect(page.textContent).not.toMatch(JARGON)
  expect(filled()).toEqual([])
})

it('gives calendars their own page, named once, with no filled button', async () => {
  window.location.hash = '#/settings/calendars'
  mounted = await mountWithPlanner(SettingsHome, done)
  const page = mounted.host.querySelector('[data-testid=settings-calendars]')!
  expect(page.querySelector('.calendar-section')).not.toBeNull()
  expect([...page.querySelectorAll('h2')].map((heading) => heading.textContent?.trim())).toEqual(['Calendars'])
  expect(page.textContent).not.toMatch(JARGON)
  expect(filled()).toEqual([])
})

it('puts everything technical under Advanced › Technical details, with a way back', async () => {
  window.location.hash = '#/settings/advanced'
  mounted = await mountWithPlanner(SettingsHome, done)
  const page = mounted.host.querySelector('[data-testid=settings-advanced]')!
  expect(page.querySelector('h2')!.textContent).toBe('Advanced')
  expect(page.querySelector('.assistant-settings [data-testid=assistant-status]')).not.toBeNull()
  expect(page.querySelector('[data-testid=persistence-status]')).not.toBeNull()
  const technical = page.querySelector('[data-testid=technical-details]')!
  expect(technical.getAttribute('aria-label')).toBe('Technical details')
  expect(technical.querySelector('.connect-settings')).not.toBeNull()
  expect(technical.querySelector('[data-testid=data-origin]')).not.toBeNull()
  expect(technical.querySelector('[data-testid=data-workspace]')!.textContent).toBe('workspace-1')
  // The MCP and JSON-proposal copy sits inside Technical details, nowhere else on the page.
  const outside = [...page.children].filter((child) => !child.contains(technical)).map((child) => child.textContent).join(' ')
  expect(outside).not.toMatch(/MCP|JSON/)
  expect(technical.textContent).toMatch(/MCP/)
  expect(technical.textContent).toMatch(/JSON/)
  expect(page.querySelector('.calendar-section, .data, [data-testid=general-settings]')).toBeNull()
  expect(page.querySelector<HTMLAnchorElement>('[data-testid=back-button]')!.getAttribute('href')).toBe('#/settings')
  expect(filled()).toEqual([])
})

it('follows the hash between the list and its sub-pages', async () => {
  mounted = await mountWithPlanner(SettingsHome, done)
  for (const [hash, page] of [['#/settings/advanced', 'settings-advanced'], ['#/settings/data', 'settings-data'], ['#/settings/calendars', 'settings-calendars']] as const) {
    window.location.hash = hash
    await vi.waitFor(() => expect(mounted!.host.querySelector(`[data-testid=${page}]`)).not.toBeNull())
  }
  window.location.hash = '#/settings'
  await vi.waitFor(() => expect(mounted!.host.querySelector('[data-testid=settings-more]')).not.toBeNull())
  expect(settingsPageOf('#/settings/advanced')).toBe('advanced')
  expect(settingsPageOf('#/settings/data')).toBe('data')
  expect(settingsPageOf('#/settings/calendars')).toBe('calendars')
  expect(settingsPageOf('#/settings/other')).toBe('home')
  expect(settingsPageOf('#/settings')).toBe('home')
  expect(settingsPageOf('#/week/advanced')).toBe('home')
})

it.each(SUPPORTED_LOCALES)('%s ends the General footer on the 12 h clock example, with no period added after "p. m."', async (locale) => {
  setHourCycle('h12')
  try {
    mounted = await mountWithPlanner(SettingsHome, { ...done, settings: { ...done.settings, locale } }, locale)
    const footer = mounted.host.querySelector('[data-testid=general-settings] .list-footer')!.textContent!.trim()
    const example = formatClock(Date.UTC(2000, 0, 1, 14, 30), displayLocale.value, 'UTC')
    expect(footer.endsWith(example)).toBe(true)
    expect(footer).not.toMatch(/\.\s*\./)
  } finally {
    setHourCycle('auto')
  }
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
