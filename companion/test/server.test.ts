import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { PlannerDocument, ChangeProposal } from '../../src/core/model'
import { startCompanion } from '../src/server'
import { newPairCode } from '../src/auth'

let running: Awaited<ReturnType<typeof startCompanion>>
let home: string
let cookie: string
let time = Date.now()
let token: string
const clients: Client[] = []
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'next168-http-'))
  await writeFile(join(home, 'index.html'), '<html><head></head><body>Next168</body></html>')
  running = await startCompanion({ home, dist: home, port: 0, now: () => time })
  token = (await readFile(join(home, 'mcp-token'), 'utf8')).trim()
  const response = await fetch(`${running.url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: running.pairingCode }) })
  cookie = response.headers.get('set-cookie')!.split(';')[0]!
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict; Path=/api')
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
  await running?.close()
  if (home) await rm(home, { recursive: true, force: true })
})
async function payload(response: Response) { return JSON.parse(await response.text()) as { document: PlannerDocument; proposals: ChangeProposal[] } }
async function client(mode: 'legacy' | { pin: string } = { pin: '2026-07-28' }) {
  const instance = new Client({ name: 'integration-test', version: '1.0' }, { versionNegotiation: { mode } })
  clients.push(instance)
  await instance.connect(new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return instance
}
function api(path: string, method = 'GET', payload?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${running.url}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extra }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
}
describe('companion HTTP and official MCP SDK client', () => {
  it.each([{ pin: '2026-07-28' }, 'legacy'] as const)('lists eight tools, reads and proposes using %j protocol', async mode => {
    const sdk = await client(mode)
    const listing = await sdk.listTools()
    expect(listing.tools.map(tool => tool.name).sort()).toEqual(['get_week', 'list_categories', 'list_blocks', 'list_tasks', 'list_events', 'get_stats', 'propose_changes', 'get_proposal'].sort())
    expect(listing.tools.find(tool => tool.name === 'get_week')?.annotations?.readOnlyHint).toBe(true)
    const eventsTool = listing.tools.find(tool => tool.name === 'list_events')!
    expect(eventsTool.description).not.toMatch(/S3|until .* integrated/i)
    expect(eventsTool.description).toContain('external-calendar-expansion-unavailable')
    const { document } = await payload(await api('/api/document'))
    document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]; document.revision++
    expect((await api('/api/document', 'PUT', { document }, { 'If-Match': '0' })).status).toBe(200)
    const week = await sdk.callTool({ name: 'get_week', arguments: {} })
    expect(week.structuredContent).toMatchObject({ workspaceId: document.workspaceId, revision: 1 })
    const proposed = await sdk.callTool({ name: 'propose_changes', arguments: { contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 1, summary: 'Focus', ops: [{ op: 'add_block', block: { categoryId: 'focus', title: 'Deep focus', days: [1], start: 540, end: 600 } }] } })
    expect(proposed.isError).not.toBe(true)
    const proposal = (proposed.structuredContent as Record<string, unknown>).proposal as { id: string; contentHash: string }
    expect((await payload(await api('/api/proposals?status=pending'))).proposals).toHaveLength(1)
    expect((await payload(await api('/api/document'))).document.blocks).toHaveLength(0)
    expect((await sdk.callTool({ name: 'get_proposal', arguments: { id: proposal.id } })).structuredContent).toMatchObject({ proposal: { status: 'pending' } })
    const binding = { contentHash: proposal.contentHash, baseRevision: 1 }
    const approved = await api(`/api/proposals/${proposal.id}/apply`, 'POST', binding)
    expect(await approved.json()).toMatchObject({ kind: 'applied', revision: 2 })
    expect(await (await api(`/api/proposals/${proposal.id}/apply`, 'POST', binding)).json()).toMatchObject({ kind: 'applied', revision: 2 })
    expect((await payload(await api('/api/document'))).document.blocks).toHaveLength(1)
  })
  it('does not give document, calendar or approval authority to MCP tokens or anonymous requests', async () => {
    for (const path of ['/api/document', '/api/proposals/any/apply', '/api/proposals/any/reject', '/api/calendars/any']) {
      for (const auth of ['', `Bearer ${token}`]) {
        const result = await fetch(`${running.url}${path}`, { method: path === '/api/document' || path.includes('calendars') ? 'PUT' : 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' })
        expect([401, 403]).toContain(result.status)
      }
    }
    expect((await fetch(`${running.url}/mcp`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    const html = await (await fetch(running.url)).text()
    expect(html).toContain("window.__NEXT168__ = { mode: 'companion' }")
    expect(html).not.toContain(token); expect(html).not.toContain(cookie); expect(html).not.toContain(running.pairingCode)
    expect((await stat(join(home, 'mcp-token'))).mode & 0o777).toBe(0o600)
  })
  it('rejects reused and expired codes and does not mutate with GET', async () => {
    expect((await api('/api/pair', 'POST', { code: running.pairingCode })).status).toBe(403)
    const code = await newPairCode(home, time)
    time += 10 * 60_000
    expect((await api('/api/pair', 'POST', { code })).status).toBe(403)
    expect((await api('/api/proposals/any/apply')).status).toBe(404)
    expect((await api('/api/pair')).status).toBe(404)
  })
  it('rejects wrong Host, wrong Origin and cross-site browser requests', async () => {
    expect((await api('/api/document', 'GET', undefined, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await api('/api/document', 'GET', undefined, { Origin: `http://127.0.0.1:${running.port + 1}` })).status).toBe(403)
    expect((await api('/api/document', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(running.url, { headers: { Host: `evil.example:${running.port}` } }, response => { response.resume(); resolve(response.statusCode!) })
      req.on('error', reject); req.end()
    })
    expect(status).toBe(403)
  })
  it('persists calendar texts and rejects a loopback ICS URL', async () => {
    expect((await api('/api/calendars/one', 'PUT', undefined)).status).toBe(200)
    const feed = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'
    expect((await fetch(`${running.url}/api/calendars/one`, { method: 'PUT', headers: { Cookie: cookie }, body: feed })).status).toBe(200)
    expect(await (await api('/api/calendars/one')).text()).toBe(feed)
    expect(await (await api('/api/calendars')).json()).toEqual({ ids: ['one'] })
    expect((await api('/api/ics?url=http://127.0.0.1/private')).status).toBe(422)
    expect((await api('/api/calendars/one', 'DELETE')).status).toBe(200)
    expect((await api('/api/calendars/one')).status).toBe(404)
  })
  it.each(['both', 'primary-only', 'backup-only', 'neither'] as const)('deletes calendar primary and backup when %s exists', async state => {
    const file = join(home, 'calendars', 'one.ics')
    if (state === 'both' || state === 'primary-only') await writeFile(file, 'current calendar')
    if (state === 'both' || state === 'backup-only') await writeFile(`${file}.bak`, 'previous calendar')

    expect((await api('/api/calendars/one', 'DELETE')).status).toBe(200)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(`${file}.bak`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await api('/api/calendars/one')).status).toBe(404)
    expect(await (await api('/api/calendars')).json()).toEqual({ ids: [] })
  })
  it('returns 409 for a stale approval and enforces token rotation on the running server', async () => {
    const document = await running.workspace.document()
    const proposal = await running.workspace.create({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 0, summary: 'Meeting', ops: [{ op: 'add_event', event: { title: 'Meeting', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z', allDay: false, attendees: [] } }] }, 'mcp')
    document.revision++
    expect((await api('/api/document', 'PUT', { document }, { 'If-Match': '0' })).status).toBe(200)
    const stale = await api(`/api/proposals/${proposal.id}/apply`, 'POST', { contentHash: proposal.contentHash, baseRevision: 0 })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ kind: 'stale', currentRevision: 1 })
    await writeFile(join(home, 'mcp-token'), 'replacement-token')
    expect((await fetch(`${running.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    expect((await api('/api/document')).status).toBe(200)
  })

  it('rejects excessive tool input before schema validation', async () => {
    const sdk = await client()
    const response = await sdk.callTool({ name: 'get_week', arguments: { excess: Array(10_001).fill(null) } })
    expect(JSON.stringify(response)).toContain('maximum of 10000 elements')
  })

})
