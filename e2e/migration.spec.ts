import { expect, test } from '@playwright/test'
import { LEGACY_BLOCK_COUNT, LEGACY_KEY, V2_KEY, legacyData, onlyProject, openTab, seedKey, seedLegacy, storedValue } from './fixtures'

test.beforeEach(onlyProject('desktop'))

test('v1 data is migrated, shown as a count, and the legacy bytes stay untouched', async ({ page }) => {
  const legacyBytes = JSON.stringify(legacyData)
  await seedLegacy(page, legacyBytes)
  await openTab(page, 'week')
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', String(LEGACY_BLOCK_COUNT))
  expect(await storedValue(page, LEGACY_KEY)).toBe(legacyBytes)

  const migrated = JSON.parse((await storedValue(page, V2_KEY))!)
  expect(migrated.schemaVersion).toBe(2)
  expect(migrated.blocks).toHaveLength(LEGACY_BLOCK_COUNT)
  const deepWork = migrated.blocks.find((block: { id: string }) => block.id === 'b-1')
  expect(deepWork).toMatchObject({ days: [1, 2, 3], start: 540, end: 780, notes: 'No meetings' })
  expect(migrated.categories.find((category: { id: string }) => category.id === 'c-work')).toMatchObject({ customColor: '#3b82f6', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } })
  expect(migrated.settings.onboardingDone).toBe(true)
})

test('corrupt v2 data shows the recovery screen and is never overwritten', async ({ page }) => {
  const corrupt = '{"schemaVersion":2,"workspaceId":'
  await seedKey(page, V2_KEY, corrupt)
  await seedLegacy(page)
  await page.goto('./')
  await expect(page.getByTestId('recovery')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download raw data' })).toBeVisible()
  expect(await storedValue(page, V2_KEY)).toBe(corrupt)
  await page.reload()
  await expect(page.getByTestId('recovery')).toBeVisible()
  expect(await storedValue(page, V2_KEY)).toBe(corrupt)

  await page.getByRole('button', { name: 'Start with an empty planner' }).click()
  expect(await storedValue(page, V2_KEY)).toBe(corrupt)
  await page.getByRole('button', { name: 'Yes, start empty' }).click()
  await expect(page.getByTestId('recovery')).toBeHidden()
  expect(await storedValue(page, 'next168-v2-backup')).toBe(corrupt)
})

test('data from a newer schema opens read-only and is left untouched', async ({ page }) => {
  const newer = JSON.stringify({ schemaVersion: 3, anything: true })
  await seedKey(page, V2_KEY, newer)
  await page.goto('./')
  await expect(page.getByText('saved by a newer version of Next168')).toBeVisible()
  expect(await storedValue(page, V2_KEY)).toBe(newer)
})

test('a write to the legacy key from an older tab raises a banner', async ({ page, context }) => {
  await seedLegacy(page)
  await openTab(page, 'week')
  const older = await context.newPage()
  await older.goto('./')
  await older.evaluate((key) => window.localStorage.setItem(key, '{"categories":[],"timeBlocks":[]}'), LEGACY_KEY)
  await expect(page.getByText('An older version of Next168 is open in another tab')).toBeVisible()
})
