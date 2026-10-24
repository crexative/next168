import { expect, test } from '@playwright/test'
import { changeProposalSchema } from '../src/core/model'
import { seedLegacy } from './fixtures'

// Real-model check, run by the coordinator on a machine with WebGPU:
//   NEXT168_WEBGPU=1 npx playwright test e2e/assistant-webgpu.spec.ts --project=desktop --headed
// It downloads Llama-3.2-1B-Instruct-q4f16_1-MLC (705 MB) from the network.
test.skip(!process.env.NEXT168_WEBGPU, 'set NEXT168_WEBGPU=1 on a WebGPU machine to run the real-model check')

const DOWNLOAD_TIMEOUT_MS = 20 * 60_000
const REPLY_TIMEOUT_MS = 5 * 60_000

test.describe('@webgpu real on-device model', () => {
  test.setTimeout(45 * 60_000)

  test('opt in, download, answer with the computed total and propose a valid change', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one real download is enough')
    // The E2E build prints each raw model reply; keep them as annotations so a failure shows what the model wrote.
    page.on('console', (message) => {
      if (message.text().startsWith('[next168-model-reply')) testInfo.annotations.push({ type: 'model-reply', description: message.text().slice(0, 600) })
    })
    await seedLegacy(page)
    await page.goto('./#/assistant')
    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()

    expect(await page.evaluate(() => 'gpu' in navigator)).toBe(true)
    await expect(page.getByTestId('status-webllm')).toHaveText('Download needed')
    await expect(page.getByText('one-time download of 705 MB')).toBeVisible()
    await expect(page.getByText(/Wi-Fi/)).toBeVisible()

    await page.getByRole('button', { name: 'Download the model (705 MB)' }).click()
    await expect(page.getByRole('progressbar')).toBeVisible()
    await expect(page.getByTestId('status-webllm')).toHaveText('Ready', { timeout: DOWNLOAD_TIMEOUT_MS })

    await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('How many hours of work this week?')
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const answer = page.locator('[data-role=assistant]').first()
    await expect(answer).toContainText('13 h', { timeout: REPLY_TIMEOUT_MS })
    testInfo.annotations.push({ type: 'answer', description: (await answer.innerText()).slice(0, 500) })

    await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Add a one hour Work block on Thursday at 18:00')
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const card = page.getByTestId('proposal-card')
    await expect(card).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
    await card.getByRole('button', { name: 'Review changes' }).click()
    const review = page.getByRole('dialog', { name: 'Review proposal' })
    await expect(review.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()

    const pending = await page.evaluate(() => (window as unknown as { __next168Test: { proposals: { list(status: string): Promise<unknown[]> } } }).__next168Test.proposals.list('pending'))
    expect(pending).toHaveLength(1)
    const proposal = changeProposalSchema.parse(pending[0])
    expect(proposal.source).toBe('assistant')
    // Thursday is day 4; 18:00-19:00 is minutes 1080-1140. The work category of the seeded plan is c-work.
    expect(proposal.ops).toMatchObject([{ op: 'add_block', block: { days: [4], start: 1080, end: 1140 } }])
    testInfo.annotations.push({ type: 'proposal', description: JSON.stringify(proposal.ops).slice(0, 500) })

    await review.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(card.getByText('The changes were applied.')).toBeVisible()
  })

  test('the downloaded model can be deleted from Settings', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one real download is enough')
    await seedLegacy(page)
    await page.goto('./#/assistant')
    await page.getByRole('button', { name: 'Download the model (705 MB)' }).click()
    await expect(page.getByTestId('status-webllm')).toHaveText('Ready', { timeout: DOWNLOAD_TIMEOUT_MS })
    await page.goto('./#/settings/advanced')
    await page.getByRole('button', { name: 'Delete the downloaded model' }).click()
    await expect(page.getByRole('button', { name: 'Delete the downloaded model' })).toHaveCount(0)
    await page.goto('./#/assistant')
    await expect(page.getByTestId('status-webllm')).toHaveText('Download needed')
  })
})
