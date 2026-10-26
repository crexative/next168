// Tasks P1-5, P1-7 and P1-18 on the companion (design rev 2.1 §10–11, rev 4 §2.3, rev 5 §2.4, rev 6 §3), plus the
// companion half of P1-3 (replacing writes move the generation forward).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { ensureFencedV2Source } from '../../config/preFence'
import { buildExportBundle } from '../../src/core/exportBundle'
import type { PlannerDocument } from '../../src/core/model'
import { startCompanion } from '../src/server'
import { CONTRACT_RETIRED_MESSAGE } from '../src/mcp'
import { Workspace } from '../src/workspace'

const SENTINEL = 'SYNTHETIC_PRIVATE_NOTE'
const root = resolve(__dirname, '../..')
let fencedV2: string
beforeAll(() => { fencedV2 = ensureFencedV2Source(root) })

const homes: string[] = []
const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined)
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})
async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'next168-contract-')); homes.push(directory)
  return directory
}
async function companion(directory: string) {
  const running = await startCompanion({ home: directory, dist: directory, port: 0 })
  closers.push(() => running.close())
  const token = (await readFile(join(directory, 'mcp-token'), 'utf8')).trim()
  const client = new Client({ name: 'contract-test', version: '1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  closers.push(() => client.close())
  return { running, client }
}
const legacyInput = (workspaceId: string) => ({ contractVersion: '1.0', workspaceId, baseRevision: 0, summary: `${SENTINEL} summary`, ops: [{ op: 'delete_block', id: 'b' }] })

describe('P1-5: contract 1.0 over MCP', () => {
  it('gets one constant error that echoes nothing, and the server advertises tools.listChanged', async () => {
    const { running, client } = await companion(await home())
    const document = await running.workspace.document()
    const response = await client.callTool({ name: 'propose_changes', arguments: legacyInput(document.workspaceId) })
    expect(response.isError).toBe(true)
    expect(response.content).toEqual([{ type: 'text', text: CONTRACT_RETIRED_MESSAGE }])
    expect(CONTRACT_RETIRED_MESSAGE).toBe('contract 1.0 is retired; call tools/list and use contract 1.1')
    expect(await running.workspace.list()).toEqual([])
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true)
  })

  it('a stale stdio proxy (d325df4, with its static 1.0 schemas) relays the same error', async () => {
    const directory = await home()
    const { running } = await companion(directory)
    const outfile = join(directory, 'stale-cli.js')
    await build({
      entryPoints: [join(fencedV2, 'companion/src/cli.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent',
      nodePaths: [resolve(__dirname, '../node_modules')],
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    })
    const stale = new Client({ name: 'stale-proxy-client', version: '1.0' }, { versionNegotiation: { mode: 'legacy' } })
    await stale.connect(new StdioClientTransport({ command: process.execPath, args: [outfile, 'mcp'], env: { NEXT168_HOME: directory, NEXT168_PORT: String(running.port) }, stderr: 'pipe' }))
    closers.push(() => stale.close())
    const listed = (await stale.listTools()).tools.find(tool => tool.name === 'propose_changes')!
    expect(JSON.stringify(listed.inputSchema)).toContain('"1.0"')
    const document = await running.workspace.document()
    const response = await stale.callTool({ name: 'propose_changes', arguments: legacyInput(document.workspaceId) })
    expect(response.content).toEqual([{ type: 'text', text: CONTRACT_RETIRED_MESSAGE }])
    expect(await running.workspace.list()).toEqual([])
  }, 30_000)
})

describe('P1-7: no note leaves the app through any MCP tool', () => {
  it('a task, a routine, an event, a check-in and a note an AI wrote into a proposal stay out of every tool result', async () => {
    const { running, client } = await companion(await home())
    const document = await running.workspace.document()
    const seeded: PlannerDocument = {
      ...document, revision: 1,
      categories: [{ id: 'c', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
      blocks: [{ id: 'b', categoryId: 'c', title: 'Deep work', notes: `${SENTINEL} block`, days: [1, 2], start: 540, end: 600 }],
      tasks: [{ id: 't', title: 'Report', notes: `${SENTINEL} task`, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }],
      events: [{ id: 'e', title: 'Dentist', start: '2026-10-26T14:00:00Z', end: '2026-10-26T15:00:00Z', allDay: false, notes: `${SENTINEL} event`, attendees: ['someone@example.invalid'] }],
      checkIns: [{ date: '2026-10-23', stress: 2, note: `${SENTINEL} check-in` }],
    }
    expect(await running.workspace.save(seeded, 0)).toEqual({ kind: 'ok', revision: 1 })
    const results: unknown[] = []
    for (const name of ['get_week', 'list_categories', 'list_blocks', 'list_tasks', 'list_events', 'get_stats']) results.push(await client.callTool({ name, arguments: {} }))
    // An AI may write notes (it never reads them back), and the app copies a routine's notes when it splits one.
    const proposed = await client.callTool({ name: 'propose_changes', arguments: {
      contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Split',
      ops: [{ op: 'update_block', id: 'b', patch: { days: [1] } }, { op: 'add_block', block: { categoryId: 'c', title: 'Deep work', notes: `${SENTINEL} copied`, days: [4], start: 600, end: 660 } }],
    } })
    expect(proposed.isError).not.toBe(true)
    results.push(proposed)
    const { id } = (proposed.structuredContent as { proposal: { id: string } }).proposal
    results.push(await client.callTool({ name: 'get_proposal', arguments: { id } }))
    expect(JSON.stringify(await running.workspace.list())).toContain(`${SENTINEL} copied`)
    for (const result of results) {
      expect(JSON.stringify(result)).not.toContain(SENTINEL)
      expect(JSON.stringify(result)).not.toContain('someone@example.invalid')
    }
    expect(JSON.stringify(results[3])).toContain('"hasNotes":true')
  })

  it('a quarantined record is never sent: get_proposal answers null', async () => {
    const directory = await home()
    await writeFile(join(directory, 'proposals.v3.json'), JSON.stringify({ records: [], quarantine: [JSON.stringify({ id: 'q', contractVersion: '1.1', summary: SENTINEL })] }))
    const { client } = await companion(directory)
    const response = await client.callTool({ name: 'get_proposal', arguments: { id: 'q' } })
    expect(response.structuredContent).toEqual({ proposal: null })
  })
})

describe('P1-18: the companion keeps contract 1.1 proposals in proposals.v3.json', () => {
  async function legacyFile(directory: string, workspaceId: string, broken = true) {
    const legacy = (id: string, status: string) => ({ id, workspaceId, source: 'mcp', baseRevision: 0, contentHash: 'a'.repeat(64), summary: id, ops: [{ op: 'delete_block', id: 'b' }], status, createdAt: '2026-10-20T08:00:00.000Z' })
    const text = JSON.stringify([legacy('pending-1', 'pending'), legacy('applied-1', 'applied'), ...(broken ? [{ id: 'broken' }] : [])])
    await writeFile(join(directory, 'proposals.json'), text)
    return text
  }

  it('imports proposals.json once, read-only and per record, and never writes it again', async () => {
    const directory = await home()
    const first = new Workspace(directory)
    await first.initialize()
    const { workspaceId } = await first.document()
    const original = await legacyFile(directory, workspaceId)
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const history = await workspace.history()
    expect(history.legacy.map(item => [item.id, item.status])).toEqual([['pending-1', 'stale'], ['applied-1', 'applied']])
    expect(history.quarantine).toEqual(['{"id":"broken"}'])
    const document = await workspace.document()
    const proposal = await workspace.create({ contractVersion: '1.1', workspaceId, baseRevision: document.revision, summary: 'Read', ops: [{ op: 'add_task', task: { title: 'Read', priority: 1 } }] }, 'mcp')
    await workspace.reject(proposal.id)
    expect(await readFile(join(directory, 'proposals.json'), 'utf8')).toBe(original)
    expect(await workspace.approve('pending-1', 'a'.repeat(64), 0)).toMatchObject({ kind: 'stale' })
  })

  it("an old companion (d325df4) rejecting a proposal leaves proposals.v3.json byte-identical", async () => {
    const directory = await home()
    const specifier = join(fencedV2, 'companion/src/workspace.ts')
    const { Workspace: OldWorkspace } = await import(/* @vite-ignore */ specifier) as { Workspace: typeof Workspace }
    // The workspace an old companion made (planner.json at schema v2, its proposals in proposals.json).
    const old = new OldWorkspace(directory)
    await old.initialize()
    const document = await old.document()
    // d325df4 reads proposals.json as one array, so this one holds only records it can read.
    await legacyFile(directory, document.workspaceId, false)
    const workspace = new Workspace(directory)
    await workspace.initialize()
    // A 1.1 proposal with the fields d325df4 would strip (a fixed time and notes on a task).
    await workspace.create({ contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 0, summary: 'Dentist', ops: [{ op: 'add_task', task: { title: 'Dentist', dueDate: '2026-10-27', at: 540, notes: 'bring forms', priority: 2 } }] }, 'mcp')
    const before = await readFile(join(directory, 'proposals.v3.json'), 'utf8')
    expect(await old.reject('pending-1')).toEqual({ kind: 'rejected' })
    expect(await readFile(join(directory, 'proposals.json'), 'utf8')).toContain('"rejected"')
    expect(await readFile(join(directory, 'proposals.v3.json'), 'utf8')).toBe(before)
    expect(JSON.parse(before).records.at(-1).ops[0].task).toMatchObject({ at: 540, notes: 'bring forms' })
    // Once the planner is written as v3, the old companion cannot read it at all (it refuses newer documents).
    await workspace.save({ ...(await workspace.document()), revision: 1 }, 0)
    await expect(old.reject('applied-1')).rejects.toThrow('stored-document-unreadable')
    expect(await readFile(join(directory, 'proposals.v3.json'), 'utf8')).toBe(before)
  })
})

describe('P1-3 on the companion: replacing writes move the generation forward', () => {
  it('backup restore and import', async () => {
    const directory = await home()
    const workspace = new Workspace(directory)
    await workspace.initialize()
    const document = await workspace.document()
    expect(await workspace.save({ ...document, revision: 1, generation: 3 }, 0)).toEqual({ kind: 'ok', revision: 1 })
    expect(await workspace.save({ ...document, revision: 2, generation: 3 }, 1)).toEqual({ kind: 'ok', revision: 2 })
    await writeFile(join(directory, 'planner.json'), 'corrupt')
    expect(await workspace.restoreBackup()).toEqual({ kind: 'ok', revision: 1 })
    expect((await workspace.document()).generation).toBe(4)

    const empty = new Workspace(await home())
    await empty.initialize()
    const current = await empty.document()
    const bundle = buildExportBundle({ ...document, revision: 9, generation: 7 }, {}, { now: () => new Date() })
    expect((await empty.importBundle(bundle, current.revision)).kind).toBe('ok')
    expect((await empty.document()).generation).toBe(8)
  })
})
