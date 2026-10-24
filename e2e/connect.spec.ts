import { test as base, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startCompanion } from '../companion/src/server'
import { readFile } from 'node:fs/promises'
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
    await expect(page.getByTestId('proposal-badge')).toHaveText('1 pending proposals', { timeout: 10_000 })
    expect((await companion.workspace.document()).blocks).toHaveLength(0)
    await page.getByTestId('proposal-badge').click()
    await page.getByRole('button', { name: 'Add a focus hour' }).click()
    await expect(page.getByRole('dialog').getByText('Focused planning', { exact: false })).toBeVisible()
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
  await page.getByRole('button', { name: proposal.summary }).click()
  await expect(page.getByRole('alert')).toContainText('Ask for a fresh proposal')
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  expect((await companion.workspace.document()).events).toHaveLength(0)
})
