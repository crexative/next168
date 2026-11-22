import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { onboardedDocument } from './support/seed'

// Settings → Apariencia: Automático (follows the system), Claro, Oscuro; a preference of this device. Since the redesign
// (R_Ajustes) it is a value row with a pop-up menu, like the other three preferences.
test.use({ locale: 'es-CO' })
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop' && testInfo.project.name !== 'phone', 'one wide and one narrow project')
})

const LIGHT = { bg: 'rgb(242, 242, 247)', label: 'rgb(0, 0, 0)', bar: '#F2F2F7' }
const DARK = { bg: 'rgb(0, 0, 0)', label: 'rgb(255, 255, 255)', bar: '#000000' }

async function start(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' } })))
  await page.goto('./#/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
}

async function look(page: Page) {
  return page.evaluate(() => ({
    // The grouped background token, read through a probe: on a phone Settings is a sheet over a dimmed backdrop.
    bg: (() => { const probe = document.createElement('div'); probe.style.background = 'var(--bg-grouped)'; document.body.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value })(),
    label: getComputedStyle(document.body).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    bars: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((meta) => meta.content),
  }))
}

const appearance = (page: Page) => page.getByRole('combobox', { name: 'Apariencia' })
const choose = (page: Page, name: string) => appearance(page).selectOption({ label: name })
const chosen = async (page: Page, name: string) => expect(appearance(page).locator('option:checked')).toHaveText(name)

test('Oscuro while the system is light: dark tokens, bar colour and color-scheme, kept after a reload with no light frame', async ({ page }) => {
  await start(page, 'light')
  await chosen(page, 'Automático')
  expect(await look(page)).toMatchObject({ bg: LIGHT.bg, label: LIGHT.label })

  await choose(page, 'Oscuro')
  await chosen(page, 'Oscuro')
  await expect.poll(() => look(page)).toEqual({ bg: DARK.bg, label: DARK.label, scheme: 'dark', bars: [DARK.bar, DARK.bar] })

  // Record the theme the moment <body> starts, before the app's (deferred) module script has run.
  await page.addInitScript(() => {
    const record = () => {
      if (!document.body) return false
      ;(window as unknown as { themeAtBody: unknown }).themeAtBody = {
        theme: document.documentElement.dataset.theme ?? null,
        bars: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((meta) => meta.content),
      }
      return true
    }
    const observer = new MutationObserver(() => { if (record()) observer.disconnect() })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { themeAtBody: unknown }).themeAtBody)).toEqual({ theme: 'dark', bars: [DARK.bar, DARK.bar] })
  expect(await look(page)).toMatchObject({ bg: DARK.bg, label: DARK.label })
  await chosen(page, 'Oscuro')
})

test('Claro while the system is dark', async ({ page }) => {
  await start(page, 'dark')
  expect(await look(page)).toMatchObject({ bg: DARK.bg, label: DARK.label })
  await choose(page, 'Claro')
  await expect.poll(() => look(page)).toEqual({ bg: LIGHT.bg, label: LIGHT.label, scheme: 'light', bars: [LIGHT.bar, LIGHT.bar] })
})

test('Automático follows the system as it changes', async ({ page }) => {
  await start(page, 'light')
  await choose(page, 'Oscuro')
  await choose(page, 'Automático')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
  expect(await page.evaluate(() => window.localStorage.getItem('next168-appearance'))).toBeNull()
  await expect.poll(() => look(page)).toMatchObject({ bg: LIGHT.bg, bars: [LIGHT.bar, DARK.bar] })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => look(page)).toMatchObject({ bg: DARK.bg, label: DARK.label })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => look(page)).toMatchObject({ bg: LIGHT.bg, label: LIGHT.label })
})

test('forced colours still win over a chosen theme', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await start(page, 'light')
  const forced = await look(page)
  await choose(page, 'Oscuro')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect((await look(page)).bg).toBe(forced.bg)
})

test('a second tab follows the choice made in the first', async ({ page, context }) => {
  await start(page, 'light')
  const second = await context.newPage()
  await second.emulateMedia({ colorScheme: 'light' })
  await second.goto('./#/today')
  await expect(second.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
  await choose(page, 'Oscuro')
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => look(second)).toMatchObject({ bg: DARK.bg })
  await choose(page, 'Automático')
  await expect(second.locator('html')).not.toHaveAttribute('data-theme', /./)
})

test('the choice has a 44 px target and a name', async ({ page }) => {
  await start(page, 'light')
  const box = (await appearance(page).boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect((await appearance(page).locator('option').allTextContents()).map((text) => text.trim())).toEqual(['Automático', 'Claro', 'Oscuro'])
})
