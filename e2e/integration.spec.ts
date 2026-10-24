import { expect, test, type Page } from '@playwright/test'
import { openTab } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { seedOnboarded } from './support/seed'

// WebGPU is off: only the always-on rules provider is available, so a proposal can only come from
// the mocked reply the E2E build lets a test install (a model would produce the same shape).
test.use({ launchOptions: { args: ['--disable-features=WebGPU'] } })

// Monday 2026-10-26 11:30 UTC; 11:30 is well inside a 900 px tall window only if the page scrolls to it.
const NOW = new Date('2026-10-26T11:30:00Z')
const GYM = { op: 'add_block', block: { categoryId: 'c-work', title: 'Gym', days: [4], start: 1080, end: 1140 } }
const planned = {
  categories: [{ id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 720 }],
  revision: 1,
}

async function storedBlocks(page: Page): Promise<{ title: string }[]> {
  return (await storedPlanner<{ blocks: { title: string }[] }>(page)).blocks
}

async function askForProposal(page: Page): Promise<void> {
  await page.clock.install({ time: NOW })
  await seedOnboarded(page, planned)
  await page.goto('./#/assistant')
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
  await page.evaluate((op) => (window as unknown as { __next168Test: { answerWithProposal(summary: string, ops: unknown[]): void } }).__next168Test.answerWithProposal('Add a gym block on Thursday', [op]), GYM)
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Add a gym block on Thursday')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.getByTestId('proposal-card').getByRole('button', { name: 'Review changes' }).click()
  await expect(page.getByRole('dialog', { name: 'Review proposal' })).toContainText('Gym')
}

test.describe('assistant proposals open the proposals review sheet', () => {
  test('Approve applies the change', async ({ page }) => {
    await askForProposal(page)
    expect(await storedBlocks(page)).toHaveLength(1)
    await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('proposal-card')).toContainText('The changes were applied.')
    expect((await storedBlocks(page)).map((block) => block.title)).toEqual(['Deep work', 'Gym'])
  })

  test('Reject leaves the plan unchanged', async ({ page }) => {
    await askForProposal(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('proposal-card')).toContainText('The proposal was discarded.')
    expect((await storedBlocks(page)).map((block) => block.title)).toEqual(['Deep work'])
  })
})

test.describe('entry points', () => {
  for (const tab of ['today', 'insights'] as const) {
    test(`${tab} offers “Ask the assistant”, which opens the assistant`, async ({ page }) => {
      await page.clock.install({ time: NOW })
      await seedOnboarded(page, planned)
      await openTab(page, tab)
      const entry = page.getByRole('link', { name: 'Ask the assistant' })
      await expect(entry).toBeVisible()
      await entry.click()
      await expect(page).toHaveURL(/#\/assistant$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
    })
  }
})

test.describe('Week and Today ergonomics', () => {
  test('Week opens with the now-line in the viewport', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-26T16:45:00Z') })
    await seedOnboarded(page, planned)
    await openTab(page, 'week')
    await expect(page.getByTestId('now-line')).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('Done / Partial / Skipped are compact pills that keep a 44 px hit target', async ({ page }) => {
    await page.clock.install({ time: NOW })
    await seedOnboarded(page, planned)
    await openTab(page, 'today')
    const buttons = page.getByRole('group', { name: /Deep work/ }).getByRole('button')
    await expect(buttons).toHaveCount(3)
    for (const button of await buttons.all()) {
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
      const pillHeight = await button.evaluate((element) => parseFloat(getComputedStyle(element, '::before').height))
      expect(pillHeight).toBeLessThan(44)
    }
  })
})
