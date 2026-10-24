import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, openAdvanced, openTab, seedKey } from './fixtures'

// Second verification (SHA eb95fb3): geometry regressions, not just visibility.
const NOW = new Date('2026-10-19T12:00:00Z')
const plan = {
  schemaVersion: 2, workspaceId: 'verify2-e2e', revision: 1, updatedAt: '2026-10-19T00:00:00.000Z',
  settings: { locale: 'en', timeZone: 'UTC', weekStartsOn: 1, onboardingDone: true, theme: 'system' },
  categories: [{ id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }],
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:vendor@e2e', 'DTSTART:20261023T093000Z', 'DTEND:20261023T100000Z', 'SUMMARY:Vendor call', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:sync@e2e', 'DTSTART:20261022T093000Z', 'DTEND:20261022T103000Z', 'SUMMARY:Team sync', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n')

async function seedWithConflicts(page: Page, document = plan, calendar = ics): Promise<void> {
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(document))
  await openAdvanced(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'conflicts.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar) })
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
  await openTab(page, 'week')
}

async function showDay(page: Page, weekday: string, date: string): Promise<Locator> {
  const strip = page.getByRole('button', { name: new RegExp(weekday) })
  if (await strip.count()) await strip.first().click()
  // The pager moves with scripted transforms: wait until the target column stops moving.
  const target = page.locator(`.day-column[data-date="${date}"]`)
  let last = ''
  await expect.poll(async () => { const now = JSON.stringify(await target.boundingBox()); const settled = now === last; last = now; return settled }, { intervals: [250] }).toBe(true)
  return target
}

// Columns under 9.5 rem stack events over blocks instead of sharing lanes (see verify3.spec.ts for that layout).
async function isStacked(column: Locator): Promise<boolean> {
  return column.evaluate((node) => node.getBoundingClientRect().width < 9.5 * 16)
}

// Box of `inner` relative to `outer`, and whether `inner` is what is painted at its own center.
async function paint(inner: Locator, outer: Locator) {
  const outerBox = await outer.evaluate((node) => { node.scrollIntoView({ block: 'center' }); const b = node.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom } })
  return inner.evaluate((node, box) => {
    const b = node.getBoundingClientRect()
    const hit = window.document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return {
      inside: b.left >= box.left - 0.5 && b.right <= box.right + 0.5 && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5,
      topmost: !!hit && (hit === node || node.contains(hit)),
      width: b.width, height: b.height,
    }
  }, outerBox)
}

for (const [weekday, date, minutes] of [['Friday', '2026-10-23', 30], ['Thursday', '2026-10-22', 60]] as const) {
  test(`a ${minutes}-minute conflict keeps the mark and both labels whole and on top`, async ({ page }) => {
    await seedWithConflicts(page)
    const column = await showDay(page, weekday, date)
    const busy = column.locator('.busy.is-conflict')
    const block = column.locator('.block')
    await expect(busy).toHaveCount(1)

    const stacked = await isStacked(column)
    const mark = await paint(busy.locator('[data-testid=calendar-conflict]'), busy)
    expect(mark, 'Conflict mark').toMatchObject({ inside: true, topmost: true })
    expect((await paint(busy.locator('.busy-title'), busy)), 'event title').toMatchObject({ inside: true, topmost: true })
    expect((await paint(block.locator('.block-title'), block)), 'block title').toMatchObject({ inside: true, topmost: true })
    if (!stacked) {
      expect((await paint(block.locator('.block-time'), block)), 'block time').toMatchObject({ inside: true, topmost: true })
      // The block time wraps instead of being cut off, and the block does not run over its own box.
      const clipped = await block.evaluate((node) => node.scrollHeight > node.clientHeight + 1 || node.querySelector<HTMLElement>('.block-time')!.scrollWidth > node.querySelector<HTMLElement>('.block-time')!.clientWidth + 1)
      expect(clipped, 'block content is cut off').toBe(false)
      // Side by side: the event does not sit over the block.
      const [blockBox, busyBox] = await Promise.all([block.boundingBox(), busy.boundingBox()])
      expect(blockBox!.x + blockBox!.width, 'block ends before the event starts').toBeLessThanOrEqual(busyBox!.x + 0.5)
    } else {
      // Stacked: the block keeps the whole width and only its title (the time stays in its accessible name).
      await expect(block.locator('.block-time')).toBeHidden()
    }
    // The mark is never clipped by the overlay (it keeps a non-colour cue: icon, text kept as the accessible name).
    expect(await busy.locator('[data-testid=calendar-conflict] svg').count()).toBe(1)
    await expect(busy.locator('[data-testid=calendar-conflict]')).toContainText('Conflict')
  })
}

// The phone/tablet/desktop projects exercise this at 375/768/1440 px respectively.
test('staggered overlaps keep all item boxes disjoint and every label topmost', async ({ page }) => {
  const staggered = {
    ...plan,
    blocks: [
      { ...plan.blocks[0]!, id: 'block-a', title: 'Block A', days: [5], start: 540, end: 660 },
      { ...plan.blocks[0]!, id: 'block-b', title: 'Block B', days: [5], start: 600, end: 720 },
    ],
  }
  const calendar = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:staggered@e2e', 'DTSTART:20261023T110000Z', 'DTEND:20261023T120000Z', 'SUMMARY:External event', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n')
  await seedWithConflicts(page, staggered, calendar)
  const column = await showDay(page, 'Friday', '2026-10-23')
  const items = column.locator('.block, .busy')
  await expect(items).toHaveCount(3)
  await expect(column.locator('.block-title')).toHaveText(['Block A', 'Block B'])
  await expect(column.locator('.busy-title')).toHaveText('External event')

  const boxes = await Promise.all((await items.all()).map(async (item) => {
    const box = await item.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
    return box!
  }))
  const stacked = await isStacked(column)
  for (const [index, box] of boxes.entries()) {
    // Stacked columns put the event over a block on purpose; blocks still must not intersect each other.
    for (const other of boxes.slice(index + 1)) {
      if (stacked && index === 0) continue // the event is the first item in the DOM
      const intersects = box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height
      expect(intersects, `items ${index} and ${boxes.indexOf(other)} intersect`).toBe(false)
    }
  }
  for (const block of await column.locator('.block').all()) {
    for (const label of ['.block-title', '.block-time']) {
      if (!(await block.locator(label).isVisible())) continue
      expect(await paint(block.locator(label), block), label).toMatchObject({ inside: true, topmost: true })
    }
  }
  const busy = column.locator('.busy')
  expect(await paint(busy.locator('.busy-title'), busy), 'event title').toMatchObject({ inside: true, topmost: true })
  expect(await paint(busy.getByTestId('calendar-conflict'), busy), 'conflict mark').toMatchObject({ inside: true, topmost: true })
})

test('the Assistant screen keeps a 16 px side gutter', async ({ page }) => {
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(plan))
  await page.goto('./#/assistant')
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
  const edges = await page.evaluate(() => {
    const width = window.innerWidth
    return Array.from(window.document.querySelectorAll('main .list-card, main .composer, main .composer input, main .composer button, main section > p:last-child'))
      .map((node) => { const box = node.getBoundingClientRect(); return { name: `${node.tagName}.${node.className}`, left: box.left, right: width - box.right } })
  })
  expect(edges.length).toBeGreaterThan(3)
  const main = await page.locator('main').evaluate((node) => node.getBoundingClientRect().left)
  for (const edge of edges) {
    expect(edge.left - main, `${edge.name} left gutter`).toBeGreaterThanOrEqual(15.5)
    expect(edge.right, `${edge.name} right gutter`).toBeGreaterThanOrEqual(15.5)
  }
})

test('the update banner never covers the page title or the date line', async ({ page }) => {
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(plan))
  await openTab(page, 'today')
  await page.evaluate(() => { const channel = new BroadcastChannel('next168'); channel.postMessage({ type: 'update-available' }); channel.close() })
  const banner = page.getByTestId('update-banner')
  await expect(banner).toBeVisible()
  const bannerBox = (await banner.boundingBox())!
  for (const target of [page.getByRole('heading', { level: 1, name: 'Today' }), page.getByTestId('today-date')]) {
    const box = (await target.boundingBox())!
    const overlap = bannerBox.x < box.x + box.width && box.x < bannerBox.x + bannerBox.width && bannerBox.y < box.y + box.height && box.y < bannerBox.y + bannerBox.height
    expect(overlap, 'banner overlaps the title area').toBe(false)
  }
  const hit = await page.getByRole('heading', { level: 1, name: 'Today' }).evaluate((node) => {
    const b = node.getBoundingClientRect()
    const top = window.document.elementFromPoint(b.left + 4, b.top + b.height / 2)
    return !!top && (top === node || node.contains(top))
  })
  expect(hit).toBe(true)
})

test('block segments carry their visible text at the start of their accessible name', async ({ page }) => {
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify({
    ...plan,
    categories: [...plan.categories, { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } }],
    blocks: [...plan.blocks, { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 }],
  }))
  await openTab(page, 'week')
  const blocks = page.locator('.block')
  expect(await blocks.count()).toBeGreaterThan(3)
  const overnight = await blocks.evaluateAll((nodes) => nodes.filter((node) => /overnight/.test(node.getAttribute('aria-label') ?? '')).length)
  expect(overnight, 'overnight segments are rendered').toBeGreaterThan(0)
  for (const block of await blocks.all()) {
    const visible = (await block.innerText()).replace(/\s+/g, ' ').trim()
    const label = ((await block.getAttribute('aria-label')) ?? '').replace(/\s+/g, ' ').trim()
    expect(label.startsWith(visible), `"${label}" starts with "${visible}"`).toBe(true)
  }
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('.week-view').withRules(['label-content-name-mismatch']).analyze()
  expect(results.violations.map((violation) => `${violation.id} ${violation.nodes.map((node) => node.html.slice(0, 160)).join(' | ')}`)).toEqual([])
})
