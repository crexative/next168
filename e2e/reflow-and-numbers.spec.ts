import { expect, test, type Page } from '@playwright/test'
import { seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'

// Two guards that hold on every route, from the UX review: text enlarged to 200 % reflows without a sideways
// scroll (AN1), and no screen writes hours in tenths (O3), even when the data itself is fractional.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the viewport is set per test; one project is enough')
})

const NOW = new Date('2026-10-21T10:15:00.000Z')
const ROUTES = ['today', 'week', 'tasks', 'insights', 'settings', 'settings/calendars', 'settings/ai', 'settings/data', 'settings/advanced', 'checkin', 'assistant', 'proposals'] as const
const LOCALES = ['es', 'de', 'en'] as const
// A decimal separator followed by digits right before an hour unit, in any of the five languages.
const FRACTIONAL_HOURS = /\d[.,]\d+\s?(h|Std\.?|hrs?)\b/i

// 42.5 h of work against a 40 h goal, a 4.5 h goal for 3 h of exercise, 1 h 30 min of reading and an average stress of 3.5.
const fractionalDocument = (locale: string) => onboardedDocument({
  settings: { locale, weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo en proyectos de clientes', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Schlaf', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 4.5 } },
    { id: 'c-reading', name: 'Reading', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 1050 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
    { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [1, 3, 5], start: 1080, end: 1140 },
    { id: 'b-read', categoryId: 'c-reading', title: 'Reading', days: [2], start: 1200, end: 1290 },
  ],
  tasks: [{ id: 't-1', title: 'Write the quarterly report', categoryId: 'c-work', durationMin: 150, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
  checkIns: [
    { date: '2026-10-19', bedtime: 1410, wake: 405, workEnd: 1080, exercise: 'yes', stress: 3 },
    { date: '2026-10-20', bedtime: 1380, wake: 450, workEnd: 1140, exercise: 'no', stress: 4 },
  ],
})

async function start(page: Page, locale: string, textScale: number): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: NOW })
  await page.addInitScript((language) => window.localStorage.setItem('next168-language', language), locale)
  await seedKey(page, V2_KEY, JSON.stringify(fractionalDocument(locale)))
  if (textScale !== 100) {
    await page.addInitScript((scale) => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = `html { font-size: ${scale}% !important; }`
        document.head.append(style)
      })
    }, textScale)
  }
}

async function open(page: Page, route: string): Promise<void> {
  await page.goto(`./#/${route}`)
  await expect(page.locator('#main h1')).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

for (const locale of LOCALES) {
  test(`at 200 % text every route fits a 390 px screen without scrolling sideways or breaking words (${locale})`, async ({ page }) => {
    await start(page, locale, 200)
    for (const route of ROUTES) {
      await open(page, route)
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth }))
      expect.soft(widths.scroll, `${route}: the page is ${widths.scroll} px wide on a ${widths.inner} px screen`).toBeLessThanOrEqual(widths.inner)
      expect.soft(widths.body, `${route}: the body is ${widths.body} px wide on a ${widths.inner} px screen`).toBeLessThanOrEqual(widths.inner)
    }
  })

  test(`no route writes hours in tenths, even for fractional data (${locale})`, async ({ page }) => {
    await start(page, locale, 100)
    for (const route of ROUTES) {
      await open(page, route)
      const text = await page.locator('#main').innerText()
      expect.soft(text.match(FRACTIONAL_HOURS)?.[0] ?? null, `${route} shows a fractional hour`).toBeNull()
    }
  })
}

// Words of the Summary figures that the browser had to cut across two lines ("disponible/s", "Trab/ajo").
async function brokenWords(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((query) => {
    const broken: string[] = []
    for (const element of Array.from(document.querySelectorAll(query))) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(node, match.index!)
          range.setEnd(node, match.index! + match[0].length)
          if (new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size > 1) broken.push(match[0])
        }
      }
    }
    return broken
  }, selector)
}

for (const locale of ['es', 'de'] as const) {
  test(`the Summary figures wrap between words, never inside one, at 200 % text (${locale})`, async ({ page }) => {
    await start(page, locale, 200)
    await open(page, 'insights')
    await expect(page.getByTestId('capacity-available')).toHaveText(/^\d+ h .+ · \d+ h .+$/)
    expect(await brokenWords(page, '[data-testid="capacity-available"], [data-testid="goal-line"], [data-testid="free-hours-live"], .legend-item')).toEqual([])
  })
}
