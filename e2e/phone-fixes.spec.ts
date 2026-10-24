import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, seedKey } from './fixtures'

test.beforeEach(onlyProject('phone'))

const LOCALES = ['en', 'es', 'fr', 'pt', 'de'] as const
const PHONE_WIDTHS = [375, 412] as const
const LANGUAGE_KEY = 'next168-language'

const sleepDocument = {
  schemaVersion: 2,
  workspaceId: 'workspace-phone',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [{ id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } }],
  blocks: [{ id: 'b-sleep', categoryId: 'c-sleep', title: 'Sueño', days: [0, 1, 2, 3, 4, 5, 6], start: 23 * 60, end: 7 * 60 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}

async function openSleepDocument(page: Page, tab: 'today' | 'week', time: string): Promise<void> {
  await page.clock.install({ time: new Date(time) })
  await page.addInitScript((key) => window.localStorage.setItem(key, 'es'), LANGUAGE_KEY)
  await seedKey(page, V2_KEY, JSON.stringify(sleepDocument))
  await page.goto(`./#/${tab}`)
  await expect(page.getByRole('heading', { level: 1, name: tab === 'today' ? 'Hoy' : 'Semana' })).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

test.describe('phone fixes', () => {
  for (const locale of LOCALES) {
    for (const width of PHONE_WIDTHS) {
      test(`onboarding colour selects show their whole label (${locale}, ${width}px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 915 })
        await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [LANGUAGE_KEY, locale])
        await page.goto('./')
        const onboarding = page.getByTestId('onboarding')
        await expect(onboarding).toBeVisible()
        await page.waitForFunction(() => document.getAnimations().length === 0)

        const measures = await onboarding.locator('select.color').evaluateAll((selects) => selects.map((select) => {
          const element = select as HTMLSelectElement
          const { scrollWidth, clientWidth } = element
          // The width the browser itself gives this select when it is sized to its longest option.
          const { width, maxInlineSize, minWidth } = element.style
          Object.assign(element.style, { width: 'auto', maxInlineSize: 'none', minWidth: '0' })
          const natural = element.clientWidth
          Object.assign(element.style, { width, maxInlineSize, minWidth })
          return { scrollWidth, clientWidth, natural }
        }))
        expect(measures.length).toBeGreaterThan(0)
        for (const measure of measures) {
          expect(measure.scrollWidth).toBeLessThanOrEqual(measure.clientWidth)
          expect(measure.clientWidth).toBeGreaterThanOrEqual(measure.natural)
        }
        const viewportWidth = page.viewportSize()!.width
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth)
      })
    }
  }

  test('the collapsed week toolbar is translucent unless reduced transparency or increased contrast is preferred', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 })
    await openSleepDocument(page, 'week', '2026-10-24T09:00:00Z')
    await page.evaluate(() => window.scrollTo(0, 150))
    await expect(page.locator('.toolbar')).toHaveAttribute('data-collapsed', 'true')
    await page.waitForFunction(() => document.getAnimations().length === 0)

    const toolbar = page.locator('.toolbar')
    // Playwright 1.63 lacks reduced-transparency emulation; the phone project uses Chromium.
    const session = await page.context().newCDPSession(page)
    for (const preference of ['no-preference', 'reduce', 'no-preference'] as const) {
      await session.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-transparency', value: preference },
          { name: 'prefers-contrast', value: 'no-preference' },
        ],
      })
      expect(await page.evaluate((value) => matchMedia(`(prefers-reduced-transparency: ${value})`).matches, preference)).toBe(true)
      if (preference === 'reduce') {
        await expect(toolbar).toHaveCSS('backdrop-filter', 'none')
      } else {
        await expect(toolbar).not.toHaveCSS('backdrop-filter', 'none')
      }
    }
    await session.detach()

    await page.emulateMedia({ contrast: 'more' })
    await expect(toolbar).toHaveCSS('backdrop-filter', 'none')
  })

  test('the overnight block shows distinct spans for yesterday\'s tail and tonight\'s start', async ({ page }) => {
    await openSleepDocument(page, 'today', '2026-10-21T06:49:00Z')
    const rows = page.getByTestId('timeline-item').filter({ hasText: 'Sueño' })
    await expect(rows).toHaveCount(2)
    const texts = await rows.allInnerTexts()
    expect(texts[0]).not.toBe(texts[1])
    expect(texts[0]).toContain('Desde ayer')
    expect(texts[1]).toContain('Hasta mañana')
    await expect(rows.nth(0).getByTestId('timeline-start')).toHaveText(/^0:00$/)
    await expect(rows.nth(0).getByTestId('timeline-end')).toHaveText(/^7:00$/)
    await expect(rows.nth(1).getByTestId('timeline-start')).toHaveText(/^23:00$/)
    await expect(rows.nth(1).getByTestId('timeline-end')).toHaveText(/^0:00$/)
  })
})
