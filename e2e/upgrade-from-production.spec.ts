// The first deploy of main replaces the old production app (05d781d, "Next168") at https://crexative.github.io/next168/.
// A person who used it keeps their planner: the real old build runs at /next168/, is used through its own UI, and is
// then replaced by the new build at the same origin and path, as the deploy does. Then a later deploy updates the
// new app's service worker through the update banner.
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { PRODUCTION_V1_BASE, PRODUCTION_V1_ENTRY, ensureProductionV1Build } from '../config/productionV1'
import { LEGACY_KEY, onlyProject } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { previewPorts } from './support/ports'
import { serveTwoBuilds, type TwoBuilds } from './support/twoBuilds'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MOUNT = PRODUCTION_V1_BASE.replace(/\/$/, '')

test.describe.configure({ mode: 'serial' })
test.beforeEach(onlyProject('desktop'))

let builds: TwoBuilds
let oldDist: string

test.beforeAll(async ({ browserName }, testInfo) => {
  if (testInfo.project.name !== 'desktop' || browserName !== 'chromium') return
  test.setTimeout(600_000)
  oldDist = ensureProductionV1Build(ROOT)
  // The exact bytes production serves, not an approximation of the old app.
  expect(readFileSync(join(oldDist, 'index.html'), 'utf8')).toContain(`${PRODUCTION_V1_BASE}${PRODUCTION_V1_ENTRY}`)
  builds = await serveTwoBuilds(previewPorts().root + 4, `${ROOT}dist`, oldDist, MOUNT)
})

test.afterAll(async () => { await builds?.close() })

interface OldBlock { title: string; description?: string; category: string; day: string; start: string; end: string; repeat?: string[] }

// The old app's own forms: the category modal and the block modal of 05d781d.
async function useOldApp(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByRole('button', { name: /Categories/ }).click()
  await page.getByRole('button', { name: /Add Category/ }).click()
  await page.locator('#category-name').fill('Guitar')
  await page.locator('.color-text-input').first().fill('#e11d48')
  await page.locator('#category-limit').fill('5')
  await page.getByRole('button', { name: 'Add', exact: true }).first().click()
  await expect(page.locator('#category-name')).toBeHidden()
  await page.locator('[class*=category-card], [class*=category-item]').filter({ hasText: 'Work' }).first().getByRole('button', { name: /✏️/ }).click()
  await page.locator('#category-limit').fill('45')
  await page.getByRole('button', { name: 'Update' }).first().click()
  await expect(page.locator('#category-limit')).toBeHidden()

  await page.getByRole('button', { name: /Calendar/ }).click()
  const blocks: OldBlock[] = [
    { title: 'Deep work', description: 'No meetings', category: 'Work', day: 'Monday', start: '09:00', end: '12:00', repeat: ['Tue', 'Wed', 'Thu', 'Fri'] },
    { title: 'Night sleep', category: 'Sleep', day: 'Sunday', start: '23:00', end: '07:00', repeat: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
    { title: 'Practice', description: 'Scales, then a song', category: 'Guitar', day: 'Saturday', start: '18:00', end: '19:30' },
  ]
  for (const block of blocks) {
    await page.getByRole('button', { name: 'Add Your First Block' }).or(page.locator('button[class*=add]').filter({ hasText: '+' })).first().click()
    await page.locator('#block-title').fill(block.title)
    if (block.description) await page.locator('#block-description').fill(block.description)
    const category = await page.locator('#block-category option').evaluateAll(
      (options, name) => options.find((option) => option.textContent?.includes(name))?.getAttribute('value'), block.category)
    await page.locator('#block-category').selectOption(category!)
    await page.locator('#block-day').selectOption({ label: block.day })
    await page.locator('#block-start').fill(block.start)
    await page.locator('#block-end').fill(block.end)
    for (const day of block.repeat ?? []) await page.locator('.day-chip', { hasText: day }).first().click()
    await page.getByRole('button', { name: 'Add', exact: true }).last().click()
    await expect(page.locator('#block-title')).toBeHidden()
  }
}

async function activeWorker(page: Page): Promise<{ scope?: string; controlled: boolean }> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (registration.active?.state !== 'activated') {
      await new Promise<void>((resolve) => registration.active!.addEventListener('statechange', () => registration.active!.state === 'activated' && resolve()))
    }
    return { scope: registration.scope, controlled: !!navigator.serviceWorker.controller }
  })
}

test('a person of the old production app keeps their planner after the deploy and the next update', async ({ page }, testInfo) => {
  const base = `${builds.origin()}${PRODUCTION_V1_BASE}`
  await page.goto(base)
  await expect(page).toHaveTitle('Next168 - Master your next 168 hours')
  await useOldApp(page)
  const legacy = await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)
  const old = JSON.parse(legacy!) as { categories: { id: string; name: string }[]; timeBlocks: { id: string; title: string }[] }
  expect(old.timeBlocks.map((block) => block.title)).toEqual(['Deep work', 'Night sleep', 'Practice'])
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)

  builds.serveAtOld(`${ROOT}dist`)
  await page.reload()
  await expect(page).toHaveTitle(/Weeklid/)
  await page.goto(`${base}#/week`)
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '3')
  for (const title of ['Deep work', 'Night sleep', 'Practice']) await expect(page.getByText(title).first()).toBeVisible()

  const id = (list: { id: string; name?: string; title?: string }[], label: string) => list.find((item) => (item.name ?? item.title) === label)!.id
  const migrated = await storedPlanner(page)
  expect(migrated.categories).toHaveLength(old.categories.length)
  expect(migrated.categories.find((category: { name: string }) => category.name === 'Guitar')).toMatchObject({ customColor: '#e11d48', goal: { type: 'max', hoursPerWeek: 5 } })
  expect(migrated.categories.find((category: { name: string }) => category.name === 'Work')).toMatchObject({ goal: { type: 'max', hoursPerWeek: 45 } })
  expect(migrated.blocks).toEqual([
    { id: id(old.timeBlocks, 'Deep work'), categoryId: id(old.categories, 'Work'), title: 'Deep work', notes: 'No meetings', days: [1, 2, 3, 4, 5], start: 540, end: 720 },
    { id: id(old.timeBlocks, 'Night sleep'), categoryId: id(old.categories, 'Sleep'), title: 'Night sleep', notes: '', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
    { id: id(old.timeBlocks, 'Practice'), categoryId: id(old.categories, 'Guitar'), title: 'Practice', notes: 'Scales, then a song', days: [6], start: 1080, end: 1170 },
  ])
  expect(migrated.settings.onboardingDone).toBe(true)
  expect(await page.evaluate((key) => window.localStorage.getItem(key), LEGACY_KEY)).toBe(legacy)

  for (const tab of ['today', 'tasks'] as const) {
    await page.goto(`${base}#/${tab}`)
    await expect(page.getByRole('heading', { level: 1, name: tab === 'today' ? 'Today' : 'Tasks' })).toBeVisible()
    await expect(page.getByTestId('recovery')).toHaveCount(0)
  }

  expect(await activeWorker(page)).toMatchObject({ scope: base })
  await page.reload()
  expect(await activeWorker(page)).toEqual({ scope: base, controlled: true })
  const revision = (await storedPlanner(page)).revision
  await page.reload()
  await page.goto(`${base}#/week`)
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '3')
  expect(await storedPlanner(page)).toMatchObject({ revision, blocks: migrated.blocks })

  // The next deploy: a byte-different service worker at the same path is offered through the banner.
  const next = testInfo.outputPath('next-deploy')
  cpSync(`${ROOT}dist`, next, { recursive: true })
  writeFileSync(join(next, 'sw.js'), `${readFileSync(join(next, 'sw.js'), 'utf8')}\n// next deploy\n`)
  builds.serveAtOld(next)
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
  const banner = page.getByTestId('update-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(true)
  await Promise.all([page.waitForEvent('framenavigated'), banner.getByRole('button', { name: 'Reload' }).click()])
  await page.goto(`${base}#/week`)
  await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '3')
  expect((await storedPlanner(page)).blocks).toEqual(migrated.blocks)
  // The new worker is the one in control: nothing waits, and the reloaded page offers no further update.
  expect(await activeWorker(page)).toEqual({ scope: base, controlled: true })
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting)).toBeNull()
  await expect(banner).toHaveCount(0)
})
