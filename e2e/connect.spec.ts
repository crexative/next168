import { test as base, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startCompanion } from '../companion/src/server'
import { readFile, writeFile } from 'node:fs/promises'
import { Client, StreamableHTTPClientTransport } from '../companion/node_modules/@modelcontextprotocol/client/dist/index.mjs'

const test = base.extend<{ companion: Awaited<ReturnType<typeof startCompanion>> }>({
  companion: async ({}, use) => {
    const home = await mkdtemp(join(tmpdir(), 'next168-e2e-connect-'))
    const companion = await startCompanion({ home, dist: resolve('dist'), port: 0 })
    try { await use(companion) }
    finally { await companion.close(); await rm(home, { recursive: true, force: true }) }
  },
})
test('MCP proposal appears, user approves, block is visible and revision increments @smoke', async ({ page, companion }) => {
  const document = await companion.workspace.document()
  document.settings.onboardingDone = true
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  document.revision++
  await companion.workspace.save(document, 0)
  await page.goto(`${companion.url}/#pair=${companion.pairingCode}`)
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeHidden()
  const sdk = new Client({ name: 'next168-playwright', version: '1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  try {
    const token = (await readFile(join(companion.workspace.home, 'mcp-token'), 'utf8')).trim()
    await sdk.connect(new StreamableHTTPClientTransport(new URL(`${companion.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const result = await sdk.callTool({ name: 'propose_changes', arguments: { contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Add a focus hour', ops: [{ op: 'add_block', block: { categoryId: 'focus', title: 'Focused planning', days: [1], start: 540, end: 600 } }] } })
    expect(result.isError).not.toBe(true)
    await expect(page.getByTestId('proposal-badge')).toHaveText('1 pending proposal', { timeout: 10_000 })
    expect((await companion.workspace.document()).blocks).toHaveLength(0)
    await page.getByTestId('proposal-badge').click()
    await page.getByRole('button', { name: 'Add a focus hour' }).click()
    await expect(page.getByTestId('change-after').getByText('Focused planning', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByTestId('applied-blocks').getByText('Focused planning', { exact: true })).toBeVisible()
    await expect(page.getByTestId('proposal-badge')).toBeHidden()
    const applied = await companion.workspace.document()
    expect(applied.revision).toBe(2)
    expect(applied.blocks).toHaveLength(1)
  } finally { await sdk.close() }
})
test('a stale proposal cannot be approved', async ({ page, companion }) => {
  const document = await companion.workspace.document()
  document.settings.onboardingDone = true
  const proposal = await companion.workspace.create({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 0, summary: 'A stale meeting', ops: [{ op: 'add_event', event: { title: 'Stale meeting', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z', allDay: false, attendees: [] } }] }, 'mcp')
  document.revision++
  await companion.workspace.save(document, 0)
  await page.goto(`${companion.url}/#pair=${companion.pairingCode}`)
  await page.getByTestId('proposal-badge').click()
  await expect(page.getByText('From Assistant via MCP', { exact: true })).toBeVisible()
  await expect(page.getByText('From mcp', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: proposal.summary }).click()
  await expect(page.getByRole('alert')).toContainText('Ask for a fresh proposal')
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  expect((await companion.workspace.document()).events).toHaveLength(0)
})
test('Use with your AI in companion mode: a pasted reply becomes a companion proposal, and the local option keeps its heading', async ({ page, companion }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough to prove the companion path')
  const document = await companion.workspace.document()
  document.settings.onboardingDone = true
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  document.revision++
  await companion.workspace.save(document, 0)
  await page.goto(`${companion.url}/#pair=${companion.pairingCode}`)
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeHidden()
  await page.goto(`${companion.url}/#/settings/advanced`)
  await expect(page.getByRole('heading', { name: 'Claude Desktop or Claude Code (on this computer)' })).toBeVisible()
  const proposal = { contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Add a focus hour', ops: [{ op: 'add_block', block: { categoryId: 'focus', title: 'Pasted focus', days: [2], start: 600, end: 660 } }] }
  await page.getByTestId('any-ai-paste').fill(`Here you go!\n\n\`\`\`next168\n${JSON.stringify(proposal)}\n\`\`\`\n`)
  await page.getByTestId('any-ai-review').click()
  await expect(page.getByTestId('proposal-review')).toContainText('Add a focus hour')
  expect((await companion.workspace.document()).blocks).toHaveLength(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click()
  await expect.poll(async () => (await companion.workspace.document()).blocks.map((block) => block.title)).toEqual(['Pasted focus'])
})
test('companion mode never opens the browser planner database (A11)', async ({ page, companion }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one browser is enough to prove the storage boundary')
  const document = await companion.workspace.document()
  document.settings.onboardingDone = true
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  document.revision++
  await companion.workspace.save(document, 0)
  await page.goto(`${companion.url}/#pair=${companion.pairingCode}`)
  await expect(page.getByRole('heading', { name: 'Pair this browser' })).toBeHidden()

  // An assistant proposal created through the card goes to the companion, and approving it changes the companion document.
  await page.goto(`${companion.url}/#/assistant`)
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
  const op = { op: 'add_block', block: { categoryId: 'focus', title: 'Card block', days: [2], start: 600, end: 660 } }
  // globalThis, not window: the companion type-checks this file without the DOM library.
  await page.evaluate((change) => (globalThis as unknown as { __next168Test: { answerWithProposal(summary: string, ops: unknown[]): void } }).__next168Test.answerWithProposal('Add a card block', [change]), op)
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Add a card block')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await page.getByTestId('proposal-card').getByRole('button', { name: 'Review changes' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByTestId('proposal-card')).toContainText('The changes were applied.')
  expect((await companion.workspace.document()).blocks.map((block) => block.title)).toEqual(['Card block'])

  // Settings > Data import reads back through the companion, not the browser store.
  const imported = { ...(await companion.workspace.document()), blocks: [{ id: 'b-imported', categoryId: 'focus', title: 'Imported block', days: [3], start: 600, end: 660 }] }
  const bundlePath = testInfo.outputPath('companion-import.json')
  await writeFile(bundlePath, JSON.stringify({ format: 'next168-export', bundleVersion: 1, exportedAt: '2026-10-24T12:00:00.000Z', document: imported, calendarSourceTexts: {} }))
  await page.goto(`${companion.url}/#/settings/advanced`)
  await expect(page.getByTestId('data-mode')).toContainText('companion', { ignoreCase: true })
  await page.goto(`${companion.url}/#/settings`)
  await page.getByLabel('Choose a Next168 export file').setInputFiles(bundlePath)
  await page.getByRole('button', { name: 'Replace my data' }).click()
  await expect(page.getByTestId('data-notice')).toContainText('Imported and verified')
  expect((await companion.workspace.document()).blocks.map((block) => block.title)).toEqual(['Imported block'])

  const databases = await page.evaluate(async () => {
    const factory = (globalThis as unknown as { indexedDB: { databases(): Promise<{ name?: string }[]> } }).indexedDB
    return (await factory.databases()).map((database) => database.name)
  })
  expect(databases).not.toContain('next168')
})
