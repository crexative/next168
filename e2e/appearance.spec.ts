import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { onboardedDocument } from './support/seed'

// Settings → Apariencia: Automático (follows the system), Claro, Oscuro; a preference of this device.
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
    bg: getComputedStyle(document.body).backgroundColor,
    label: getComputedStyle(document.body).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    bars: Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((meta) => meta.content),
  }))
}

const choice = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Apariencia' }).getByRole('radio', { name, exact: true })

test('Oscuro while the system is light: dark tokens, bar colour and color-scheme, kept after a reload with no light frame', async ({ page }) => {
  await start(page, 'light')
  await expect(choice(page, 'Automático')).toHaveAttribute('aria-checked', 'true')
  expect(await look(page)).toMatchObject({ bg: LIGHT.bg, label: LIGHT.label })

  await choice(page, 'Oscuro').click()
  await expect(choice(page, 'Oscuro')).toHaveAttribute('aria-checked', 'true')
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
  await expect(choice(page, 'Oscuro')).toHaveAttribute('aria-checked', 'true')
})

test('Claro while the system is dark', async ({ page }) => {
  await start(page, 'dark')
  expect(await look(page)).toMatchObject({ bg: DARK.bg, label: DARK.label })
  await choice(page, 'Claro').click()
  await expect.poll(() => look(page)).toEqual({ bg: LIGHT.bg, label: LIGHT.label, scheme: 'light', bars: [LIGHT.bar, LIGHT.bar] })
})

test('Automático follows the system as it changes', async ({ page }) => {
  await start(page, 'light')
  await choice(page, 'Oscuro').click()
  await choice(page, 'Automático').click()
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
  await choice(page, 'Oscuro').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect((await look(page)).bg).toBe(forced.bg)
})

test('a second tab follows the choice made in the first', async ({ page, context }) => {
  await start(page, 'light')
  const second = await context.newPage()
  await second.emulateMedia({ colorScheme: 'light' })
  await second.goto('./#/today')
  await expect(second.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
  await choice(page, 'Oscuro').click()
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => look(second)).toMatchObject({ bg: DARK.bg })
  await choice(page, 'Automático').click()
  await expect(second.locator('html')).not.toHaveAttribute('data-theme', /./)
})

test('the choice has 44 px targets and a named group', async ({ page }) => {
  await start(page, 'light')
  for (const name of ['Automático', 'Claro', 'Oscuro']) {
    const box = (await choice(page, name).boundingBox())!
    expect(box.height, name).toBeGreaterThanOrEqual(44)
    expect(box.width, name).toBeGreaterThanOrEqual(44)
  }
})
