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

async function ask(page: Page, question: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill(question)
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
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

  test('the on-device model is unavailable and quick answers are ready', async ({ page }) => {
    await openAssistant(page)
    await expect(page.getByTestId('status-webllm')).toHaveText('Not available')
    await expect(page.getByTestId('status-rules')).toHaveText('Ready')
    await expect(page.getByText('cannot run the on-device model')).toBeVisible()
    await expect(page.getByRole('button', { name: /Download the model/ })).toHaveCount(0)
  })

  test('quick answers quote the computed total of the week', async ({ page }) => {
    await openAssistant(page)
    await ask(page, 'How many hours of work this week?')
    await expect(page.locator('[data-role=assistant]').last()).toHaveText('Work: 13 h planned this week.')
    await ask(page, 'How many unassigned hours do I have?')
    await expect(page.locator('[data-role=assistant]').last()).toContainText('Your routine leaves 99 h of the 168 h unassigned (69 h planned).')
  })

  test('quick answers do not change the plan', async ({ page }) => {
    await openAssistant(page)
    await ask(page, 'Add a gym block on Thursday')
    await expect(page.locator('[data-role=assistant]').last()).toContainText('on-device model')
    // The model is "Not available" here, so the reply must not tell the user to turn it on.
    await expect(page.locator('[data-role=assistant]').last()).not.toContainText(/turn it on/i)
    await expect(page.locator('[data-role=assistant]').last()).toContainText('cannot run')
    await expect(page.getByTestId('proposal-card')).toHaveCount(0)
  })

  test('the planner keeps working', async ({ page }) => {
    await openAssistant(page)
    await openTab(page, 'week')
    await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', '3')
    await openTab(page, 'insights')
  })

  test('Integrations and advanced offers the on-device assistant section with the privacy promise', async ({ page }) => {
    await seedLegacy(page)
    await openAdvanced(page)
    const section = page.getByRole('region', { name: 'On-device assistant' })
    await expect(section.getByText('Runs on this device.')).toBeVisible()
    await expect(section.getByRole('radio', { name: 'Quick answers' })).toBeChecked()
    await expect(section.getByRole('button', { name: 'Delete the downloaded model' })).toHaveCount(0)
  })

  test('has no serious accessibility violations', async ({ page }) => {
    await openAssistant(page)
    await ask(page, 'How many hours of work this week?')
    await expect(page.locator('[data-role=assistant]')).toHaveCount(1)
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
  })
})
