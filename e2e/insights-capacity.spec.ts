import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openTab, seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'

const MONDAY_MORNING = new Date('2026-10-26T08:00:00Z')

const sleep = { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } }
const work = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }
const study = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } }

const everyDay = [0, 1, 2, 3, 4, 5, 6]
const blocks = [
  { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: everyDay, start: 0, end: 5 * 60 },
  { id: 'b-work', categoryId: 'c-work', title: 'Work', days: [1, 2, 3, 4], start: 9 * 60, end: 17 * 60 },
  { id: 'b-study', categoryId: 'c-study', title: 'Study', days: [2], start: 19 * 60, end: 20 * 60 },
]

async function start(page: Page, overrides: Record<string, unknown>): Promise<void> {
  await page.clock.setFixedTime(MONDAY_MORNING)
  await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument(overrides)))
}

// No element inside the main content may be wider than its own box or stick out of the viewport.
async function expectNothingClipped(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = []
    const limit = document.documentElement.clientWidth
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const style = getComputedStyle(element)
      if (style.visibility === 'hidden' || style.display === 'none' || element.getClientRects().length === 0) continue
      const box = element.getBoundingClientRect()
      if (box.width === 0) continue
      const label = `${element.tagName.toLowerCase()}.${element.className}`
      if (box.left < -0.5 || box.right > limit + 0.5) found.push(`${label} outside viewport (${Math.round(box.left)}..${Math.round(box.right)} of ${limit})`)
      if (element.closest('[data-testid="week-bar"]') === null && element.scrollWidth > element.clientWidth + 1 && style.overflowX !== 'visible') found.push(`${label} clips horizontally`)
    }
    if (document.documentElement.scrollWidth > limit + 1) found.push('page scrolls horizontally')
    return found
  })
  expect(problems).toEqual([])
}

test.describe('insights capacity', () => {
  test('shows the disk-usage bar with the legend, the Available value and per-category goals, nothing clipped', async ({ page }) => {
    await start(page, { categories: [sleep, work, study], blocks })
    await openTab(page, 'insights')

    // 35 h sleep + 32 h work + 1 h study = 68 h planned, 100 h available.
    await expect(page.getByTestId('capacity-available')).toHaveText('100 h available of 168')
    const legend = page.getByTestId('capacity-legend')
    await expect(legend.getByTestId('legend-c-sleep')).toContainText('Sleep35 h')
    await expect(legend.getByTestId('legend-c-work')).toContainText('Work32 h')
    await expect(legend.getByTestId('legend-c-study')).toContainText('Study1 h')
    await expect(legend.getByTestId('legend-available')).toContainText('Available100 h')

    const bar = page.getByTestId('week-bar')
    await expect(bar.getByRole('img', { name: 'Work: 32 h planned' })).toBeVisible()
    await expect(bar.getByRole('img', { name: 'Available: 100 h' })).toBeVisible()
    const widths = await bar.locator('[data-segment]').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-segment'), node.getBoundingClientRect().width] as const))
    const widthOf = (id: string) => widths.find(([key]) => key === id)![1]
    expect(widthOf('available') / widthOf('c-work')).toBeCloseTo(100 / 32, 0)

    const sleepRow = page.getByTestId('goal-row-c-sleep')
    await expect(sleepRow.getByTestId('goal-line')).toHaveText('35 h of min 49 h · 14 h to go')
    await expect(sleepRow.getByTestId('goal-chip')).toContainText('14 h to go')
    await expect(sleepRow.getByTestId('goal-marker')).toHaveText('min 49 h')
    const workRow = page.getByTestId('goal-row-c-work')
    await expect(workRow.getByTestId('goal-line')).toHaveText('32 h of max 40 h · 8 h left')
    await expect(workRow.getByTestId('goal-marker')).toHaveText('max 40 h')
    await expect(page.getByTestId('goal-row-c-study').getByTestId('goal-line')).toHaveText('No goal')
    await expect(page.getByTestId('capacity-overlap')).toHaveCount(0)

    await expectNothingClipped(page)
  })

  test('an empty plan is all available and a min goal at 0 h says what is missing', async ({ page }) => {
    await start(page, { categories: [sleep, work], blocks: [] })
    await openTab(page, 'insights')
    await expect(page.getByTestId('capacity-available')).toHaveText('168 h available of 168')
    await expect(page.getByTestId('week-bar').locator('[data-segment]')).toHaveCount(1)
    await expect(page.getByTestId('week-bar').getByRole('img', { name: 'Available: 168 h' })).toBeVisible()
    const row = page.getByTestId('goal-row-c-sleep')
    await expect(row.getByTestId('goal-chip')).toHaveText(/49 h to go/)
    await expect(row.getByTestId('goal-chip')).not.toContainText('On track')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('0 min of max 40 h · 40 h left')
    await expectNothingClipped(page)
  })

  test('over the max and a met minimum are worded as such', async ({ page }) => {
    const overWork = { ...work, goal: { type: 'max', hoursPerWeek: 20 } }
    const easySleep = { ...sleep, goal: { type: 'min', hoursPerWeek: 20 } }
    await start(page, { categories: [easySleep, overWork, study], blocks })
    await openTab(page, 'insights')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('Over the max by 12 h')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-chip')).toHaveText(/Over cap/)
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-line')).toHaveText('Minimum met')
    await expectNothingClipped(page)
  })

  test('overlapping blocks cap the bar at 168 h and say so', async ({ page }) => {
    const heavy = (id: string, categoryId: string) => ({ id, categoryId, title: id, days: everyDay, start: 0, end: 20 * 60 })
    await start(page, { categories: [sleep, work], blocks: [heavy('b1', 'c-sleep'), heavy('b2', 'c-work')] })
    await openTab(page, 'insights')
    // 2 × 140 h planned: the bar is capped, nothing is left.
    await expect(page.getByTestId('capacity-available')).toHaveText('0 min available of 168')
    await expect(page.getByTestId('week-bar').locator('[data-segment="available"]')).toHaveCount(0)
    await expect(page.getByTestId('capacity-overlap')).toContainText('capped at 168 h')
    await expectNothingClipped(page)
  })

  test('renders in Spanish with the owner wording', async ({ page }) => {
    await start(page, { settings: { ...onboardedDocument().settings, locale: 'es' }, categories: [sleep, work, study], blocks })
    await page.goto('./#/insights')
    await expect(page.getByTestId('capacity-available')).toHaveText('100 h disponibles de 168')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('32 h de máx. 40 h · quedan 8 h')
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-line')).toHaveText('35 h de mín. 49 h · faltan 14 h')
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations in ${scheme} mode, including reduced motion`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await start(page, { categories: [sleep, work, study], blocks })
      await openTab(page, 'insights')
      const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }

  test('long category names wrap instead of being clipped', async ({ page }) => {
    const longName = { ...study, id: 'c-study', name: 'Extraordinarily long category name that must wrap, not clip' }
    await start(page, { categories: [sleep, work, longName], blocks })
    await openTab(page, 'insights')
    await expectNothingClipped(page)
  })
})

test.describe('category colours', () => {
  test('a new category preselects the first unused colour and a repeated colour only shows a hint', async ({ page }) => {
    await start(page, { categories: [{ ...sleep, colorKey: 'blue' }, { ...work, colorKey: 'green' }], blocks: [] })
    await openTab(page, 'settings')
    await page.getByRole('button', { name: 'Add category' }).click()
    const dialog = page.getByRole('dialog', { name: 'New category' })
    await expect(dialog.getByRole('radio', { name: 'Orange' })).toBeChecked()
    await expect(dialog.getByTestId('color-in-use')).toHaveCount(0)

    await dialog.getByRole('radio', { name: 'Blue' }).check({ force: true })
    await expect(dialog.getByTestId('color-in-use')).toContainText('Sleep already uses this colour')

    await dialog.getByRole('textbox', { name: 'Name' }).fill('Reading')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), V2_KEY)
    expect(stored.categories.at(-1)).toMatchObject({ name: 'Reading', colorKey: 'blue' })
  })
})
