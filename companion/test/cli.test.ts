import { expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

async function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
}
it('runs the built serve CLI as the only writer and serves authenticated review APIs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'next168-cli-'))
  const dist = join(home, 'app'); await mkdir(dist)
  await writeFile(join(dist, 'index.html'), '<html><head></head><body>Weeklid fixture</body></html>')
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer(); probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as { port: number }).port; probe.close(() => resolve(port)) })
  })
  const env = { ...process.env, NEXT168_HOME: home, NEXT168_PORT: String(port), NEXT168_DIST: dist }
  const child = spawn(process.execPath, [resolve('dist/cli.js'), 'serve', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const client = new Client({ name: 'built-cli-test', version: '1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  let duplicate: ChildProcess | undefined
  try {
    const code = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(Error('CLI startup timeout')), 10_000)
      child.stdout!.on('data', chunk => {
        output += chunk.toString()
        const match = /Pairing code \(single use, 10 minutes\): ([\w-]+)/.exec(output)
        if (match) { clearTimeout(timer); resolve(match[1]!) }
      })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', status => { clearTimeout(timer); reject(Error(`CLI exited before readiness: ${status}`)) })
    })
    duplicate = spawn(process.execPath, [resolve('dist/cli.js'), 'serve', '--no-open'], { env, stdio: 'pipe' })
    expect(await waitForExit(duplicate)).toBe(1)
    const url = `http://127.0.0.1:${port}`
    const html = await (await fetch(url)).text()
    expect(html).toContain("window.__NEXT168__ = { mode: 'companion' }")
    const token = (await readFile(join(home, 'mcp-token'), 'utf8')).trim()
    expect(html).not.toContain(token)
    const pair = await fetch(`${url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    expect(pair.status).toBe(200)
    const cookie = pair.headers.get('set-cookie')!.split(';')[0]!
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const week = (await client.callTool({ name: 'get_week', arguments: {} })).structuredContent as { workspaceId: string; revision: number }
    const proposed = await client.callTool({ name: 'propose_changes', arguments: { contractVersion: '1.0', workspaceId: week.workspaceId, baseRevision: week.revision, summary: 'CLI meeting', ops: [{ op: 'add_event', event: { title: 'CLI meeting', start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z', allDay: false, attendees: [] } }] } })
    expect(proposed.isError).not.toBe(true)
    const proposal = (proposed.structuredContent as { proposal: { id: string; contentHash: string } }).proposal
    const result = await fetch(`${url}/api/proposals/${proposal.id}/apply`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentHash: proposal.contentHash, baseRevision: week.revision }) })
    expect(await result.json()).toMatchObject({ kind: 'applied', revision: 1 })
    const persisted = JSON.parse(await readFile(join(home, 'planner.json'), 'utf8'))
    expect(persisted.events).toHaveLength(1)
    expect(persisted.revision).toBe(1)
  } finally {
    await client.close()
    if (duplicate && duplicate.exitCode === null && duplicate.signalCode === null) { duplicate.kill('SIGTERM'); await waitForExit(duplicate) }
    child.kill('SIGTERM'); await waitForExit(child)
    await expect(readFile(join(home, 'companion.lock'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(home, { recursive: true, force: true })
  }
}, 20_000)
