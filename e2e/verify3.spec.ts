import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, openSettingsPage, openTab, seedKey } from './fixtures'
import { openClassicRoutine } from './support/week'

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

async function seed(page: Page, locale = 'en', at = NOW, checkIns: { date: string }[] = []): Promise<void> {
  await page.clock.install({ time: at })
  await seedKey(page, V2_KEY, JSON.stringify({ ...plan, checkIns, settings: { ...plan.settings, locale } }))
}

async function importEvents(page: Page, contents = ics): Promise<void> {
  await openSettingsPage(page, 'calendars')
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'conflicts.ics', mimeType: 'text/calendar', buffer: Buffer.from(contents) })
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
}

// Count painted characters, including wrapped text; an overlapping event must not count as visible block text.
async function visibleCharacters(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const button = node.closest('button')!
    const textBox = node.getBoundingClientRect()
    const buttonBox = button.getBoundingClientRect()
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let fits = 0
    while (walker.nextNode()) {
      const text = walker.currentNode
      for (let offset = 0; offset < (text.textContent?.length ?? 0); offset++) {
        if (!text.textContent![offset]!.trim()) continue
        range.setStart(text, offset)
        range.setEnd(text, offset + 1)
        const rect = range.getBoundingClientRect()
        if (rect.width <= 0 || rect.left < textBox.left - 0.5 || rect.right > textBox.right + 0.5 || rect.bottom > Math.min(textBox.bottom, buttonBox.bottom) + 0.5) continue
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (hit && button.contains(hit)) fits += 1
      }
    }
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
  test.use({ hasTouch: true })

  for (const [width, height] of [[768, 1024], [1024, 900]] as const) {
    test(`an event over a block stays readable and opens its details at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await seed(page)
      await importEvents(page)
      await openTab(page, 'week')

      for (const [date, title] of [['2026-10-22', 'Team sync'], ['2026-10-23', 'Vendor call']] as const) {
        const column = page.locator(`.day-column[data-date="${date}"]`)
        const event = column.locator('.busy')
        await event.scrollIntoViewIfNeeded()
        await expect(event).toHaveCount(1)

        // The event takes a lane beside the routine (docs/design/visual-design.md › Week items): neither is drawn over the
        // other, and each shows its whole title or none: every character it draws is painted inside its own box.
        const columnBox = (await column.boundingBox())!
        const eventBox = (await event.boundingBox())!
        const block = column.locator('.block')
        const blockBox = (await block.boundingBox())!
        expect(eventBox.x, `${title} sits beside the routine`).toBeGreaterThanOrEqual(blockBox.x + blockBox.width - 0.5)
        expect(eventBox.x + eventBox.width).toBeLessThanOrEqual(columnBox.x + columnBox.width + 0.5)
        for (const [label, locator] of [[title, event.locator('.busy-title:not(.visually-hidden)')], ['routine', block.locator('.block-title')]] as const) {
          if (await locator.count() === 0) continue
          const whole = await locator.evaluate((node) => (node.textContent ?? '').replace(/\s/g, '').length)
          expect(await visibleCharacters(locator), `${label} is whole`).toBe(whole)
          await expect(locator).toHaveCSS('overflow-wrap', 'normal')
        }
        // The conflict keeps its icon, and its word in the accessible name.
        await expect(event.getByTestId('calendar-conflict')).toContainText(/Conflict/)
        expect(await event.getByTestId('calendar-conflict').locator('svg').count()).toBe(1)
        // The word is drawn only where it fits whole beside the icon and the title.
        if (await event.locator('.conflict-text:not(.visually-hidden)').count()) {
          const textBox = (await event.locator('.conflict-text').boundingBox())!
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

    for (const kind of ['external', 'own'] as const) {
      test(`a fully overlapped block opens from its own lane and the ${kind} event conflict at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height })
        await page.clock.install({ time: NOW })
        const event = { id: 'exact', title: 'Team sync', start: '2026-10-21T09:00:00Z', end: '2026-10-21T10:00:00Z', allDay: false, attendees: [] }
        await seedKey(page, V2_KEY, JSON.stringify({
          ...plan,
          blocks: plan.blocks.map((block) => ({ ...block, end: 600 })),
          events: kind === 'own' ? [event] : [],
        }))
        if (kind === 'external') {
          await importEvents(page, [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:exact@e2e',
            'DTSTART:20261021T090000Z', 'DTEND:20261021T100000Z', 'SUMMARY:Team sync',
            'END:VEVENT', 'END:VCALENDAR', '',
          ].join('\r\n'))
        }
        await openTab(page, 'week')

        const column = page.locator('.day-column[data-date="2026-10-21"]')
        const block = column.locator('[data-block-id="b-work"]')
        const band = column.locator('.busy')
        await block.scrollIntoViewIfNeeded()
        const blockBox = (await block.boundingBox())!
        const bandBox = (await band.boundingBox())!
        expect((await column.boundingBox())!.width).toBeLessThan(9.5 * 16)
        // Same hour, side by side: the routine keeps its own lane, the event never covers it.
        expect(bandBox.y).toBeCloseTo(blockBox.y, 0)
        expect(bandBox.height).toBeCloseTo(blockBox.height, 0)
        expect(bandBox.x).toBeGreaterThanOrEqual(blockBox.x + blockBox.width - 0.5)
        for (const locator of [block.locator('.block-title'), band.locator('.busy-title:not(.visually-hidden)')]) {
          if (await locator.count() === 0) continue
          expect(await visibleCharacters(locator)).toBe(await locator.evaluate((node) => (node.textContent ?? '').replace(/\s/g, '').length))
        }

        const point = { x: blockBox.x + blockBox.width / 2, y: blockBox.y + blockBox.height / 2 }
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-block-id]')?.getAttribute('data-block-id'), point)).toBe('b-work')
        await page.touchscreen.tap(point.x, point.y)
        const editor = page.getByRole('dialog', { name: 'Edit routine', exact: true })
        await expect(editor).toBeVisible()
        await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Deep work')
        await expect(editor.getByLabel('Starts', { exact: true })).toHaveValue('09:00')
        await expect(editor.getByLabel('Ends', { exact: true })).toHaveValue('10:00')
        await editor.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(editor).toHaveCount(0)

        await band.scrollIntoViewIfNeeded()
        const tapBox = (await band.boundingBox())!
        await page.touchscreen.tap(tapBox.x + tapBox.width / 2, tapBox.y + tapBox.height / 2)
        const details = page.getByRole('dialog', { name: 'Team sync', exact: true })
        await expect(details).toBeVisible()
        const conflict = details.getByRole('button', { name: 'Conflicts with Deep work', exact: true })
        await conflict.tap()
        await expect(details).toHaveCount(0)
        await expect(editor).toBeVisible()
        await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('Deep work')
        await expect(editor.getByLabel('Starts', { exact: true })).toHaveValue('09:00')
        await expect(editor.getByLabel('Ends', { exact: true })).toHaveValue('10:00')
      })
    }
  }
})

test('the New routine sheet from an empty hour preselects the first category that is not Sleep', async ({ page }) => {
  await seed(page)
  await openTab(page, 'week')
  await openClassicRoutine(page)
  const dialog = page.getByRole('dialog', { name: 'New routine' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Work' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: 'Sleep' })).toHaveAttribute('aria-checked', 'false')
})

test.describe('update notice on a phone', () => {
  test.beforeEach(onlyProject('phone'))

  test("the first row's circle ends up clear of a tall notice, and the notice can be dismissed", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    // French wraps the notice onto three lines, the tallest case; the page must still end clear of it.
    // After Deep work ended, with an earlier check-in showing the plan existed, its row carries the status circle.
    await seed(page, 'fr', new Date('2026-10-21T12:00:00.000Z'), [{ date: '2026-10-20' }])
    await page.goto('./#/today')
    await expect(page.getByTestId('timeline-item').first()).toBeVisible()
    await page.waitForFunction(() => window.document.getAnimations().length === 0)
    await page.evaluate(() => { const channel = new BroadcastChannel('next168'); channel.postMessage({ type: 'update-available' }); channel.close() })
    const banner = page.getByTestId('update-banner')
    await expect(banner).toBeVisible()

    // Scroll as far as the page allows: nothing interactive in the first row may remain under the notice.
    await page.evaluate(() => window.scrollTo(0, window.document.documentElement.scrollHeight))
    const buttons = page.getByTestId('timeline-item').first().locator('button')
    expect(await buttons.count()).toBe(1)
    for (const button of await buttons.all()) {
      expect(await isTopmost(button), `${await button.getAttribute('aria-label')} is under the notice`).toBe(true)
    }

    const close = banner.getByTestId('update-banner-close')
    const closeBox = (await close.boundingBox())!
    expect(closeBox.width).toBeGreaterThanOrEqual(44)
    expect(closeBox.height).toBeGreaterThanOrEqual(44)
    await close.click()
    await expect(banner).toHaveCount(0)
  })
})
