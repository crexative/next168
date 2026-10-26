import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { LEGACY_KEY, legacyData, onlyProject, openTab, seedLegacy } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { addFromMenu } from './support/week'
import { seedOnboarded } from './support/seed'

// A8: IndexedDB failing never falls back to localStorage; the app blocks with a clear screen instead.
test.beforeEach(onlyProject('desktop'))

const planned = {
  categories: [{ id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5, 6, 0], start: 540, end: 600 }],
}

test('(a) IndexedDB cannot be opened: blocking screen, no export, nothing written to localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () { throw new DOMException('disabled by policy', 'UnknownError') }
  })
  const legacyBytes = JSON.stringify(legacyData)
  await seedLegacy(page, legacyBytes)
  await page.goto('./')
  await expect(page.getByTestId('storage-error')).toBeVisible()
  await expect(page.getByText("Weeklid can't use this browser's storage")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export a copy' })).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem('next168-v2'))).toBeNull()
  expect(await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)).toBe(legacyBytes)
})

test('(b) a write that hits the quota blocks editing and exports the last committed document', async ({ page }) => {
  await seedOnboarded(page, planned)
  await openTab(page, 'week')
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '1')
  const committed = await storedPlanner(page)

  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError') }
  })
  await addFromMenu(page, 'Routine')
  const dialog = page.getByRole('dialog', { name: 'New routine' })
  await dialog.getByLabel('Name').fill('Unsaved block')
  await dialog.getByLabel('Starts').fill('12:00')
  await dialog.getByLabel('Ends').fill('12:30')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByTestId('storage-error')).toBeVisible()
  await expect(page.getByTestId('last-change-not-saved')).toHaveText('Your last change was not saved. Everything before it is safe.')
  await page.getByRole('link', { name: 'Tasks' }).first().click()
  await expect(page.getByTestId('storage-error')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveCount(0)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export a copy' }).click()
  const bundle = JSON.parse(readFileSync(await (await download).path(), 'utf8'))
  expect(bundle.format).toBe('next168-export')
  // The stored planner is still the version-2 bytes it was seeded as (nothing was committed since); the export is it,
  // widened to schema v3 as every load reads it.
  const widened = (committed as { schemaVersion: number }).schemaVersion === 2 ? { ...committed, schemaVersion: 3, generation: 0, appliedCaptureIds: [] } : committed
  expect(bundle.document).toEqual(widened)
  expect(JSON.stringify(bundle.document)).not.toContain('Unsaved block')
})

test('(c) a failing read during the focus re-check shows the screen with the document still exportable', async ({ page }) => {
  await seedOnboarded(page, planned)
  await openTab(page, 'week')
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '1')
  await page.evaluate(() => {
    IDBFactory.prototype.open = function () { throw new DOMException('gone', 'UnknownError') }
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.getByTestId('storage-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export a copy' })).toBeVisible()
  await expect(page.getByTestId('last-change-not-saved')).toHaveCount(0)
})

test('the blocking screen fits a 320 px phone in German at 200 % text, without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.addInitScript(() => {
    window.localStorage.setItem('next168-language', 'de')
    IDBFactory.prototype.open = function () { throw new DOMException('disabled by policy', 'UnknownError') }
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' })
  })
  await page.goto('./')
  await expect(page.getByTestId('storage-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible()
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const button = await page.getByRole('button', { name: 'Erneut versuchen' }).boundingBox()
  expect(button!.x).toBeGreaterThanOrEqual(0)
  expect(button!.x + button!.width).toBeLessThanOrEqual(320)
})
