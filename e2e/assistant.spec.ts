import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openAdvanced, openTab, seedLegacy } from './fixtures'

// WebGPU is off for every test here: the planner and the always-on quick answers must keep working.
test.use({ launchOptions: { args: ['--disable-features=WebGPU'] } })

async function openAssistant(page: Page): Promise<void> {
  await seedLegacy(page)
  await page.goto('./#/assistant')
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
}

async function askSuggestion(page: Page, name: string): Promise<void> {
  await page.getByTestId('suggestions').getByRole('button', { name, exact: true }).click()
}

test.describe('assistant without WebGPU', () => {
  test('the browser gives the page no WebGPU adapter', async ({ page }) => {
    await page.goto('./')
    const adapter = await page.evaluate(async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
      return gpu ? (await gpu.requestAdapter()) !== null : false
    })
    expect(adapter).toBe(false)
  })

  test('the on-device model is unavailable, quick answers are ready, and the status lives in Advanced only', async ({ page }) => {
    await openAssistant(page)
    await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(3)
    await expect(page.getByTestId('assistant-status')).toHaveCount(0)
    await expect(page.locator('#main')).not.toContainText(/WebGPU|on-device model/i)
    await expect(page.getByRole('button', { name: /Download the model/ })).toHaveCount(0)
    await openAdvanced(page)
    await expect(page.getByTestId('status-webllm')).toHaveText('Not available')
    await expect(page.getByTestId('status-rules')).toHaveText('Ready')
    await expect(page.getByText('cannot run the on-device model')).toBeVisible()
  })

  test('without the model there is no question box that could not act, only the suggested questions', async ({ page }) => {
    await openAssistant(page)
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await askSuggestion(page, 'How many free hours do I have?')
    await expect(page.locator('[data-role=assistant]').last()).toContainText(/\d+ h/)
    await expect(page.getByTestId('proposal-card')).toHaveCount(0)
    // The suggestions stay: the screen never ends in a dead end.
    await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(3)
    await askSuggestion(page, "What's next?")
    await expect(page.locator('[data-role=assistant]')).toHaveCount(2)
  })

  test('the planner keeps working', async ({ page }) => {
    await openAssistant(page)
    await openTab(page, 'week')
    await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '3')
    await openTab(page, 'insights')
  })

  test('Advanced offers the on-device assistant section with the privacy promise', async ({ page }) => {
    await seedLegacy(page)
    await openAdvanced(page)
    const section = page.getByRole('region', { name: 'On-device assistant' })
    await expect(section.getByText('Runs on this device.')).toBeVisible()
    await expect(section.getByRole('radio', { name: 'Quick answers' })).toBeChecked()
    await expect(section.getByRole('button', { name: 'Delete the downloaded model' })).toHaveCount(0)
  })

  test('has no serious accessibility violations', async ({ page }) => {
    await openAssistant(page)
    await askSuggestion(page, 'How many free hours do I have?')
    await expect(page.locator('[data-role=assistant]')).toHaveCount(1)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
  })
})
