import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, openTab, seedKey } from './fixtures'

// Third verification: tablet Week lanes, the New block default category and the update notice on a phone.
const NOW = new Date('2026-10-21T10:15:00.000Z')
const plan = {
  schemaVersion: 2, workspaceId: 'verify3-e2e', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'en', timeZone: 'UTC', weekStartsOn: 1, onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
  ],
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:sync@e2e', 'DTSTART:20261022T093000Z', 'DTEND:20261022T103000Z', 'SUMMARY:Team sync', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:vendor@e2e', 'DTSTART:20261023T093000Z', 'DTEND:20261023T100000Z', 'SUMMARY:Vendor call', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n')

async function seed(page: Page, locale = 'en'): Promise<void> {
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify({ ...plan, settings: { ...plan.settings, locale } }))
}

async function importEvents(page: Page): Promise<void> {
  await openTab(page, 'settings')
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'conflicts.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) })
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
}

// Characters of the element's text that fit its box, measured with the element's own font.
async function visibleCharacters(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const style = window.getComputedStyle(node)
    const probe = window.document.createElement('canvas').getContext('2d')!
    probe.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const text = node.textContent ?? ''
    if (node.scrollWidth <= node.clientWidth) return text.length
    let fits = 0
    while (fits < text.length && probe.measureText(`${text.slice(0, fits + 1)}…`).width <= node.clientWidth) fits += 1
    return fits
  })
}

async function isTopmost(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const hit = window.document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return !!hit && (hit === node || node.contains(hit))
  })
}

test.describe('Week at tablet widths', () => {
  test.beforeEach(onlyProject('desktop'))

  for (const [width, height] of [[768, 1024], [1024, 900]] as const) {
    test(`an event over a block stays readable and opens its details at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await seed(page)
      await importEvents(page)
      await openTab(page, 'week')

      for (const [date, title, minutes] of [['2026-10-22', 'Team sync', 60], ['2026-10-23', 'Vendor call', 30]] as const) {
        const column = page.locator(`.day-column[data-date="${date}"]`)
        const event = column.locator('.busy')
        await event.scrollIntoViewIfNeeded()
        await expect(event).toHaveCount(1)

        // The event is a band over the block, not a sliver beside it, and keeps a readable title.
        const columnBox = (await column.boundingBox())!
        expect((await event.boundingBox())!.width, `${title} width`).toBeGreaterThan(columnBox.width - 8)
        expect(await visibleCharacters(event.locator('.busy-title')), `${title} visible characters`).toBeGreaterThanOrEqual(6)
        const block = column.locator('.block')
        expect(await visibleCharacters(block.locator('.block-title')), 'block title visible characters').toBeGreaterThanOrEqual(6)
        expect((await block.boundingBox())!.width).toBeGreaterThan(columnBox.width - 8)
        await expect(event.getByTestId('calendar-conflict')).toBeVisible()

        // A longer event also keeps the word "Conflict" readable, inside the band.
        if (minutes >= 45) {
          const eventBox = (await event.boundingBox())!
          const textBox = (await event.locator('.conflict-text').boundingBox())!
          expect(textBox.width).toBeGreaterThan(20)
          expect(textBox.x + textBox.width).toBeLessThanOrEqual(eventBox.x + eventBox.width + 0.5)
        }

        expect(await isTopmost(event), `${title} is hit-testable`).toBe(true)
        await event.click()
        const dialog = page.getByRole('dialog', { name: title })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByTestId('busy-details')).toContainText('9:30 AM')
        await expect(dialog.getByTestId('busy-details-conflict')).toHaveText('Conflicts with Deep work')
        await dialog.getByRole('button', { name: 'Close' }).click()
        await expect(dialog).toHaveCount(0)
      }
    })
  }
})

test('the New block sheet from Week "+" preselects the first category that is not Sleep', async ({ page }) => {
  await seed(page)
  await openTab(page, 'week')
  await page.getByRole('button', { name: 'Add block' }).click()
  const dialog = page.getByRole('dialog', { name: 'New block' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Category')).toHaveValue('c-work')
})

test.describe('update notice on a phone', () => {
  test.beforeEach(onlyProject('phone'))

  test("the first row's buttons end up clear of a tall notice, and the notice can be dismissed", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    // French wraps the notice onto three lines, the tallest case; the page must still end clear of it.
    await seed(page, 'fr')
    await page.goto('./#/today')
    await expect(page.getByTestId('timeline-item').first()).toBeVisible()
    await page.waitForFunction(() => window.document.getAnimations().length === 0)
    await page.evaluate(() => { const channel = new BroadcastChannel('next168'); channel.postMessage({ type: 'update-available' }); channel.close() })
    const banner = page.getByTestId('update-banner')
    await expect(banner).toBeVisible()

    // Scroll as far as the page allows: nothing interactive in the first row may remain under the notice.
    await page.evaluate(() => window.scrollTo(0, window.document.documentElement.scrollHeight))
    const buttons = page.getByTestId('timeline-item').first().locator('button')
    expect(await buttons.count()).toBeGreaterThanOrEqual(3)
    for (const button of await buttons.all()) {
      expect(await isTopmost(button), `${await button.innerText()} is under the notice`).toBe(true)
    }

    const close = banner.getByTestId('update-banner-close')
    const closeBox = (await close.boundingBox())!
    expect(closeBox.width).toBeGreaterThanOrEqual(44)
    expect(closeBox.height).toBeGreaterThanOrEqual(44)
    await close.click()
    await expect(banner).toHaveCount(0)
  })
})
