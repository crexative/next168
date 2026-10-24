import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openTab, seedKey, V2_KEY } from './fixtures'
import { storedPlanner } from './support/indexedDb'
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

test.describe('summary: your typical week and goals', () => {
  test('100 planned categories fit the bar on a 375 px phone @smoke', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const categories = Array.from({ length: 100 }, (_, index) => ({
      ...study, id: `c-${index}`, name: `Category ${index + 1}`,
    }))
    const blocks = categories.map((category, index) => ({
      id: `b-${index}`, categoryId: category.id, title: category.name,
      days: [Math.floor(index / 24)], start: (index % 24) * 60, end: ((index + 1) % 24) * 60,
    }))
    await start(page, { categories, blocks })
    await openTab(page, 'insights')

    await expect(page.getByTestId('capacity-available')).toHaveText('100 h assigned · 68 h unassigned')
    const bar = page.getByTestId('week-bar')
    await expect(bar.locator('[data-segment]')).toHaveCount(101)
    for (const category of categories) {
      await expect(bar.getByRole('img', { name: `${category.name}: 1 h`, exact: true })).toHaveCount(1)
      await expect(page.getByTestId(`legend-${category.id}`)).toHaveText(`${category.name}1 h`)
    }
    await expect(bar.getByRole('img', { name: 'Unassigned: 68 h', exact: true })).toBeVisible()
    await expect(page.getByTestId('legend-available')).toHaveText('Unassigned68 h')

    const geometry = await bar.evaluate((element) => {
      const barBox = element.getBoundingClientRect()
      return {
        left: barBox.left, right: barBox.right, width: barBox.width,
        segments: Array.from(element.querySelectorAll('[data-segment]'), (segment) => {
          const box = segment.getBoundingClientRect()
          return { id: segment.getAttribute('data-segment'), left: box.left, right: box.right, width: box.width }
        }),
      }
    })
    expect(geometry.width).toBeGreaterThan(0)
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(375)
    for (const segment of geometry.segments) {
      expect(segment.width, `${segment.id} has visible width`).toBeGreaterThan(0)
      expect(segment.left, `${segment.id} starts inside the bar`).toBeGreaterThanOrEqual(geometry.left - 0.5)
      expect(segment.right, `${segment.id} ends inside the bar`).toBeLessThanOrEqual(geometry.right + 0.5)
    }
    await expectNothingClipped(page)
  })

  test('shows your typical week as one bar with the legend, the unassigned hours and one line per goal, nothing clipped', async ({ page }) => {
    await start(page, { categories: [sleep, work, study], blocks })
    await openTab(page, 'insights')

    // 35 h sleep + 32 h work + 1 h study = 68 h planned, 100 h available.
    await expect(page.getByTestId('capacity-available')).toHaveText('68 h assigned · 100 h unassigned')
    const legend = page.getByTestId('capacity-legend')
    await expect(legend.getByTestId('legend-c-sleep')).toContainText('Sleep35 h')
    await expect(legend.getByTestId('legend-c-work')).toContainText('Work32 h')
    await expect(legend.getByTestId('legend-c-study')).toContainText('Study1 h')
    await expect(legend.getByTestId('legend-available')).toContainText('Unassigned100 h')

    const bar = page.getByTestId('week-bar')
    await expect(bar.getByRole('img', { name: 'Work: 32 h' })).toBeVisible()
    await expect(bar.getByRole('img', { name: 'Unassigned: 100 h' })).toBeVisible()
    const widths = await bar.locator('[data-segment]').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-segment'), node.getBoundingClientRect().width] as const))
    const widthOf = (id: string) => widths.find(([key]) => key === id)![1]
    expect(widthOf('available') / widthOf('c-work')).toBeCloseTo(100 / 32, 0)

    const sleepRow = page.getByTestId('goal-row-c-sleep')
    await expect(sleepRow.getByTestId('goal-line')).toHaveText('35 of at least 49 h · 14 h to go')
    await expect(sleepRow.getByTestId('goal-state')).toHaveText('!')
    const workRow = page.getByTestId('goal-row-c-work')
    await expect(workRow.getByTestId('goal-line')).toHaveText('32 of at most 40 h · 8 h left')
    await expect(workRow.getByTestId('goal-state')).toHaveText('✓')
    // A category without a goal has no row; the status is one line and one mark, never a chip as well.
    await expect(page.getByTestId('goal-row-c-study')).toHaveCount(0)
    await expect(page.getByTestId('goal-chip')).toHaveCount(0)
    await expect(page.getByTestId('capacity-overlap')).toHaveCount(0)

    await expectNothingClipped(page)
  })

  test('an empty plan is all unassigned and a min goal at 0 h says what is missing', async ({ page }) => {
    await start(page, { categories: [sleep, work], blocks: [] })
    await openTab(page, 'insights')
    await expect(page.getByTestId('capacity-available')).toHaveText('0 h assigned · 168 h unassigned')
    await expect(page.getByTestId('week-bar').locator('[data-segment]')).toHaveCount(1)
    await expect(page.getByTestId('week-bar').getByRole('img', { name: 'Unassigned: 168 h' })).toBeVisible()
    const row = page.getByTestId('goal-row-c-sleep')
    await expect(row.getByTestId('goal-line')).toHaveText('0 of at least 49 h · 49 h to go')
    await expect(row.getByTestId('goal-state')).toHaveText('!')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('0 of at most 40 h · 40 h left')
    await expectNothingClipped(page)
  })

  test('over the max and a met minimum are worded as such', async ({ page }) => {
    const overWork = { ...work, goal: { type: 'max', hoursPerWeek: 20 } }
    const easySleep = { ...sleep, goal: { type: 'min', hoursPerWeek: 20 } }
    await start(page, { categories: [easySleep, overWork, study], blocks })
    await openTab(page, 'insights')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('32 of at most 20 h · 12 h over')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-state')).toHaveText('!')
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-line')).toHaveText('35 of at least 20 h')
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-state')).toHaveText('✓')
    await expectNothingClipped(page)
  })

  test('overlapping blocks cap the bar at 168 h and say so', async ({ page }) => {
    const heavy = (id: string, categoryId: string) => ({ id, categoryId, title: id, days: everyDay, start: 0, end: 20 * 60 })
    await start(page, { categories: [sleep, work], blocks: [heavy('b1', 'c-sleep'), heavy('b2', 'c-work')] })
    await openTab(page, 'insights')
    // 2 × 140 h planned: the bar is capped, nothing is left.
    await expect(page.getByTestId('capacity-available')).toHaveText('168 h assigned · 0 h unassigned')
    await expect(page.getByTestId('week-bar').locator('[data-segment="available"]')).toHaveCount(0)
    await expect(page.getByTestId('capacity-overlap')).toContainText('capped at 168 h')
    await expectNothingClipped(page)
  })

  test('renders in Spanish with the owner wording', async ({ page }) => {
    await start(page, { settings: { ...onboardedDocument().settings, locale: 'es' }, categories: [sleep, work, study], blocks })
    await page.goto('./#/insights')
    await expect(page.getByTestId('capacity-available')).toHaveText('68 h asignadas · 100 h sin asignar')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-line')).toHaveText('32 de como máximo 40 h · quedan 8 h')
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-line')).toHaveText('35 de al menos 49 h · faltan 14 h')
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

    await dialog.getByRole('radio', { name: 'Blue' }).check()
    await expect(dialog.getByTestId('color-in-use')).toContainText('Sleep already uses this colour')

    await dialog.getByRole('textbox', { name: 'Name' }).fill('Reading')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const stored = await storedPlanner<{ categories: { name: string; colorKey: string }[] }>(page)
    expect(stored.categories.at(-1)).toMatchObject({ name: 'Reading', colorKey: 'blue' })
  })
})
