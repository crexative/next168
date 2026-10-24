import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, openTab, seedKey, storedValue } from './fixtures'
import { installTransformRecorder } from './support/transformRecorder'

// Wednesday 2026-10-21 10:15 UTC; the browser and the document both use UTC.
const NOW = new Date('2026-10-21T10:15:00.000Z')
const WEDNESDAY = '2026-10-21'
const THURSDAY = '2026-10-22'

const seededDocument = {
  schemaVersion: 2,
  workspaceId: 'workspace-e2e',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
  ],
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [3], start: 1080, end: 1140 },
  ],
  tasks: [],
  checkIns: [],
  actuals: [],
  events: [],
  calendarSources: [],
  appliedProposalIds: [],
}

async function openSeeded(page: Page, tab: 'today' | 'week', now = NOW): Promise<void> {
  await page.clock.install({ time: now })
  await seedKey(page, V2_KEY, JSON.stringify(seededDocument))
  await openTab(page, tab)
}

function block(page: Page, date: string, blockId: string, startMinute?: number): Locator {
  const start = startMinute === undefined ? '' : `[data-start-minute="${startMinute}"]`
  return page.locator(`[data-date="${date}"] [data-block-id="${blockId}"]${start}`)
}

async function storedDocument(page: Page) {
  return JSON.parse((await storedValue(page, V2_KEY))!)
}

async function swipe(page: Page, distance: number, durationMs: number, steps = 6): Promise<void> {
  const box = (await page.locator('.pager-viewport').boundingBox())!
  const startX = box.x + box.width / 2 + (distance < 0 ? box.width / 4 : -box.width / 4)
  const y = 420
  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (distance * step) / steps, y)
    await page.waitForTimeout(durationMs / steps)
  }
}

async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.getByTestId('pager-track').evaluate((element) => element.style.transform)).toMatch(/\+ 0px\)\)$/)
}

// Starts now or at the next pointer release, before the page's own handlers run.
async function recordTrackTransforms(page: Page, from: 'now' | 'release' = 'now'): Promise<void> {
  await page.evaluate(installTransformRecorder, from)
}

async function distinctTransforms(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set((window as unknown as { __transforms: string[] }).__transforms)])
}

async function runningTransformAnimations(page: Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().filter((animation) => {
    const effect = animation.effect as KeyframeEffect | null
    return effect?.getKeyframes().some((keyframe) => 'transform' in keyframe && keyframe.transform !== 'none')
  }).length)
}

test.describe('today', () => {
  test('the Now card shows the current block, minutes left and the next block, and refreshes', async ({ page }) => {
    await openSeeded(page, 'today')
    await expect(page.getByTestId('today-date')).toHaveText('Wednesday, October 21')
    const card = page.getByTestId('now-card')
    await expect(card.getByTestId('now-title')).toHaveText('Deep work')
    await expect(card.getByTestId('now-left')).toHaveText('45 min left')
    await expect(card.getByTestId('now-next')).toContainText('Gym')
    await expect(card.getByTestId('now-next')).toContainText('6:00 PM')
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '63')
    const before = await card.boundingBox()

    await page.clock.runFor(5 * 60_000)
    await expect(card.getByTestId('now-left')).toHaveText('40 min left')
    expect(await card.boundingBox()).toEqual(before)
  })

  test('a status notice arriving late does not move the Now card', async ({ page }) => {
    await openSeeded(page, 'today')
    const card = page.getByTestId('now-card')
    const before = await card.boundingBox()
    await page.evaluate(() => {
      const channel = new BroadcastChannel('next168')
      channel.postMessage({ type: 'update-available' })
      channel.close()
    })
    await expect(page.getByTestId('update-banner')).toBeVisible()
    expect(await card.boundingBox()).toEqual(before)
  })

  test('the Next row names tomorrow during an overnight block', async ({ page }) => {
    await openSeeded(page, 'today', new Date('2026-10-21T23:00:00.000Z'))
    const card = page.getByTestId('now-card')
    await expect(card.getByTestId('now-title')).toHaveText('Sleep')
    await expect(card.getByTestId('now-left')).toHaveText('7 h left')
    await expect(card.getByTestId('now-next')).toContainText('Deep work')
    await expect(card.getByTestId('now-next')).toContainText('Tomorrow, 9:00 AM')
  })

  test('marking an occurrence done stores its snapshot and survives a reload', async ({ page }) => {
    await openSeeded(page, 'today')
    const choices = page.getByRole('group', { name: 'How did Deep work go?' })
    await choices.getByRole('button', { name: 'Done' }).click()
    await expect(choices.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await storedDocument(page)).actuals).toEqual([{
      date: WEDNESDAY,
      blockId: 'b-work',
      categoryId: 'c-work',
      plannedStartAt: '2026-10-21T09:00:00.000Z',
      plannedEndAt: '2026-10-21T11:00:00.000Z',
      plannedMinutes: 120,
      status: 'done',
    }])

    await page.reload()
    await expect(page.getByRole('group', { name: 'How did Deep work go?' }).getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    // Last night's sleep is past too and can be marked; Gym has not started yet.
    await expect(page.getByRole('group', { name: 'How did Sleep go?' })).toHaveCount(1)
    await expect(page.getByRole('group', { name: 'How did Gym go?' })).toHaveCount(0)
  })

  test('a partial actual records the minutes spent', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    await openSeeded(page, 'today')
    await page.getByRole('group', { name: 'How did Deep work go?' }).getByRole('button', { name: 'Partial' }).click()
    await page.getByLabel('Minutes spent (planned 120)').fill('50')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await storedDocument(page)).actuals[0]).toMatchObject({ status: 'partial', actualMinutes: 50, plannedMinutes: 120 })
  })

  test('the check-in entry links to the check-in route', async ({ page }) => {
    await openSeeded(page, 'today')
    await expect(page.getByRole('link', { name: /Evening check-in/ })).toHaveAttribute('href', '#/checkin')
  })
})

test.describe('week', () => {
  test('an overnight block is visible on both days', async ({ page }, testInfo) => {
    await openSeeded(page, 'week')
    const evening = block(page, WEDNESDAY, 'b-sleep', 1320)
    const morning = block(page, THURSDAY, 'b-sleep', 0)
    await expect(evening).toHaveAttribute('data-end-minute', '1440')
    await expect(morning).toHaveAttribute('data-end-minute', '360')
    await expect(evening).toHaveAccessibleName(/^Sleep 10:00\sPM – 6:00\sAM \(overnight\)$/)

    await evening.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await expect(evening).toBeInViewport()
    if (testInfo.project.name === 'phone') {
      await expect(morning).not.toBeInViewport()
      await page.getByRole('button', { name: 'Thursday, October 22' }).click()
      await expect(page.locator('.pager')).toHaveAttribute('data-active-date', THURSDAY)
    }
    await morning.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await expect(morning).toBeInViewport()
  })

  test('the grid honours the week start and marks today with the now line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone')
    await openSeeded(page, 'week')
    const columns = page.locator('.grid-body [data-date]')
    await expect(columns).toHaveCount(7)
    await expect(columns.first()).toHaveAttribute('data-date', '2026-10-19')
    await expect(page.locator(`[data-date="${WEDNESDAY}"] [data-testid="now-line"]`)).toHaveCount(1)
    await expect(page.getByTestId('now-line')).toHaveCount(1)
  })

  test('an overlapping block shows an inline error and cannot be saved', async ({ page }) => {
    await openSeeded(page, 'week')
    await page.getByRole('button', { name: 'Add block' }).click()
    const dialog = page.getByRole('dialog', { name: 'New block' })
    await dialog.getByLabel('Title').fill('Standup')
    await dialog.getByLabel('Starts').fill('09:30')
    await dialog.getByLabel('Ends').fill('10:30')
    await expect(dialog.getByTestId('editor-error')).toHaveText('Overlaps “Deep work”. Change the time or the days.')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()

    await dialog.getByLabel('Starts').fill('12:00')
    await dialog.getByLabel('Ends').fill('12:30')
    await expect(dialog.getByTestId('editor-error')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await storedDocument(page)).blocks.map((item: { title: string }) => item.title)).toContain('Standup')
  })

  test('an overnight end is shown as +1 day and a goal overrun only warns', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    await openSeeded(page, 'week')
    await page.getByRole('button', { name: 'Add block' }).click()
    const dialog = page.getByRole('dialog', { name: 'New block' })
    await dialog.getByLabel('Title').fill('Long ride')
    await dialog.getByLabel('Category').selectOption({ label: 'Exercise' })
    await dialog.getByLabel('Starts').fill('12:00')
    await dialog.getByLabel('Ends').fill('17:00')
    await expect(dialog.getByTestId('editor-warning')).toContainText('Exercise would be 3 h over its weekly cap')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
    await dialog.getByLabel('Starts').fill('23:00')
    await dialog.getByLabel('Ends').fill('23:30')
    await expect(dialog.getByTestId('next-day')).toHaveCount(0)
    await dialog.getByLabel('Ends').fill('00:30')
    await expect(dialog.getByTestId('next-day')).toHaveText('+1 day')
  })

  test('tapping an empty slot opens the editor at that time', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    await openSeeded(page, 'week')
    const column = page.locator(`.grid-body [data-date="${THURSDAY}"]`)
    await column.click({ position: { x: 20, y: 14.5 * 48 + 10 } })
    const dialog = page.getByRole('dialog', { name: 'New block' })
    await expect(dialog.getByLabel('Starts')).toHaveValue('14:30')
    await expect(dialog.getByLabel('Ends')).toHaveValue('15:30')
    await expect(dialog.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('deleting a block shows an undo toast that restores it', async ({ page }) => {
    await openSeeded(page, 'week')
    await block(page, WEDNESDAY, 'b-gym').click()
    const dialog = page.getByRole('dialog', { name: 'Edit block' })
    await dialog.getByRole('button', { name: 'Delete block' }).click()
    await expect(block(page, WEDNESDAY, 'b-gym')).toHaveCount(0)
    await expect.poll(async () => (await storedDocument(page)).blocks.some((item: { id: string }) => item.id === 'b-gym')).toBe(false)

    await expect(page.getByText('Deleted “Gym”')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(block(page, WEDNESDAY, 'b-gym')).toHaveCount(1)
    await expect.poll(async () => (await storedDocument(page)).blocks.find((item: { id: string }) => item.id === 'b-gym'))
      .toEqual(seededDocument.blocks[2])
  })

  test('a horizontal swipe changes the day and springs into place', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openSeeded(page, 'week')
    const pager = page.locator('.pager')
    await expect(pager).toHaveAttribute('data-active-date', WEDNESDAY)

    await recordTrackTransforms(page, 'release')
    await swipe(page, -230, 90)
    await page.mouse.up()
    await expect(pager).toHaveAttribute('data-active-date', THURSDAY)
    await expect.poll(() => page.getByTestId('pager-track').evaluate((element) => element.style.transform)).toBe('translateX(calc(-300% + 0px))')
    expect((await distinctTransforms(page)).length).toBeGreaterThan(2)

    await swipe(page, 230, 90)
    await page.mouse.up()
    await expect(pager).toHaveAttribute('data-active-date', WEDNESDAY)
    await settled(page)
    await swipe(page, 230, 90)
    await page.mouse.up()
    await expect(pager).toHaveAttribute('data-active-date', '2026-10-20')
  })

  test('a slow short drag snaps back and the week ends resist', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openSeeded(page, 'week')
    const pager = page.locator('.pager')
    await swipe(page, -60, 900, 12)
    await page.mouse.up()
    await expect(pager).toHaveAttribute('data-active-date', WEDNESDAY)

    await page.getByRole('button', { name: 'Monday, October 19' }).click()
    await expect(pager).toHaveAttribute('data-active-date', '2026-10-19')
    await settled(page)
    await swipe(page, 200, 600, 12)
    const offset = await page.getByTestId('pager-track').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)
    expect(offset).toBeGreaterThan(0)
    expect(offset).toBeLessThan(120)
    await page.mouse.up()
    await expect(pager).toHaveAttribute('data-active-date', '2026-10-19')
  })

  test('with reduced motion the day change runs no transform animation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openSeeded(page, 'week')
    await recordTrackTransforms(page, 'release')
    await swipe(page, -230, 90)
    await page.mouse.up()
    await expect(page.locator('.pager')).toHaveAttribute('data-active-date', THURSDAY)
    expect(await runningTransformAnimations(page)).toBe(0)
    await page.waitForTimeout(400)
    expect(await distinctTransforms(page)).toEqual(['translateX(calc(-300% + 0px))'])

    await recordTrackTransforms(page)
    await page.getByRole('button', { name: 'Friday, October 23' }).click()
    await expect(page.locator('.pager')).toHaveAttribute('data-active-date', '2026-10-23')
    expect(await runningTransformAnimations(page)).toBe(0)
    await page.waitForTimeout(400)
    expect(await distinctTransforms(page)).toEqual(['translateX(calc(-400% + 0px))'])
  })
})

test('axe finds no serious or critical issues on seeded Today and Week', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop' && testInfo.project.name !== 'phone')
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(seededDocument))
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    for (const tab of ['today', 'week'] as const) {
      await openTab(page, tab)
      const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
      const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      expect(blocking.map((violation) => `${theme}/${tab}: ${violation.id} ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)).toEqual([])
    }
  }
})

test('day-strip buttons carry their visible text in their accessible name', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone')
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(seededDocument))
  await openTab(page, 'week')
  const days = page.locator('.strip-day')
  await expect(days).toHaveCount(7)
  for (const day of await days.all()) {
    const visible = (await day.innerText()).replace(/\s+/g, ' ').trim()
    expect(await day.getAttribute('aria-label')).toContain(visible)
  }
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('.day-strip').withRules(['label-content-name-mismatch']).analyze()
  expect(results.violations.map((violation) => `${violation.id} ${violation.nodes.map((node) => node.html.slice(0, 160)).join(' | ')}`)).toEqual([])
})
