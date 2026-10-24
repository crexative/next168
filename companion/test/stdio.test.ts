import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { startCompanion } from '../src/server'

let running: Awaited<ReturnType<typeof startCompanion>> | undefined
let home: string | undefined
let client: Client | undefined
afterEach(async () => { await client?.close(); await running?.close(); if (home) await rm(home, { recursive: true, force: true }); client = undefined; running = undefined; home = undefined })
it.each(['legacy', { pin: '2026-07-28' }] as const)('proxies real stdio discovery, read and proposal to the single writer (%j)', async mode => {
  home = await mkdtemp(join(tmpdir(), 'next168-stdio-'))
  running = await startCompanion({ home, dist: home, port: 0 })
  client = new Client({ name: 'stdio-integration', version: '1.0' }, { versionNegotiation: { mode } })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp'], env: { NEXT168_HOME: home, NEXT168_PORT: String(running.port) }, stderr: 'pipe' }))
  expect((await client.listTools()).tools).toHaveLength(8)
  const week = await client.callTool({ name: 'get_week', arguments: {} })
  const document = await running.workspace.document()
  expect(week.structuredContent).toMatchObject({ workspaceId: document.workspaceId, revision: 0 })
  const response = await client.callTool({ name: 'propose_changes', arguments: { contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 0, summary: 'Meeting', ops: [{ op: 'add_event', event: { title: 'Proposed meeting', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z', allDay: false, attendees: [] } }] } })
  expect(response.isError).not.toBe(true)
  expect(await running.workspace.list('pending')).toHaveLength(1)
  expect((await running.workspace.document()).revision).toBe(0)
  expect(await readFile(join(home, 'proposals.json'), 'utf8')).toContain('Proposed meeting')
}, 15_000)
