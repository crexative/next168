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
      test(`guided setup rows, time chips and the time editor fit the phone (${locale}, ${width}px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 915 })
        await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [LANGUAGE_KEY, locale])
        await page.goto('./')
        const setup = page.getByTestId('setup')
        const live = setup.locator('section.screen:not([aria-hidden=true])')
        await expect(setup).toHaveAttribute('data-screen', 'sleep')
        await live.getByTestId('setup-primary').click()
        await live.locator('[data-value=both]').click()
        await expect(setup).toHaveAttribute('data-screen', 'work')
        await page.waitForFunction(() => document.getAnimations().length === 0)

        // Every row, value and chip is whole inside the sheet, with each picker open in turn.
        const viewportWidth = page.viewportSize()!.width
        const check = async () => {
          const items = await live.locator('.row, .value, .label, .time, .pick, .step').evaluateAll((elements) => elements.map((element) => ({
            scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, right: element.getBoundingClientRect().right,
          })))
          expect(items.length).toBeGreaterThan(0)
          for (const item of items) {
            expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth)
            expect(item.right).toBeLessThanOrEqual(viewportWidth)
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewportWidth)
        }
        await check()
        await live.locator('[data-field=end]').click()
        await check()
        await live.getByTestId('other-time').click()
        await check()
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
    // Yesterday's tail is one quiet line; tonight's start keeps its two time rows.
    expect(texts[0]).toContain('Desde ayer · hasta 7:00')
    expect(texts[1]).toContain('Hasta mañana')
    await expect(rows.nth(0).getByTestId('timeline-start')).toHaveCount(0)
    await expect(rows.nth(1).getByTestId('timeline-start')).toHaveText(/^23:00$/)
    await expect(rows.nth(1).getByTestId('timeline-end')).toHaveText(/^0:00$/)
  })
})
