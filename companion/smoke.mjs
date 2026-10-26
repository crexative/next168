import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = await mkdtemp(join(tmpdir(), 'next168-claude-smoke-'))
const privateReports = join(home, 'evidence')
await mkdir(privateReports, { mode: 0o700 })
const port = await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
})
const url = `http://127.0.0.1:${port}`
const env = { ...process.env, NEXT168_HOME: home, NEXT168_PORT: String(port) }
const server = spawn(process.execPath, [join(root, 'companion/dist/cli.js'), 'serve', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let claude
try {
  const code = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(Error('Companion startup timed out')), 15_000)
    server.stdout.on('data', chunk => {
      output += chunk.toString()
      const match = /Pairing code \(single use, 10 minutes\): ([\w-]+)/.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    server.once('error', error => { clearTimeout(timer); reject(error) })
    server.once('exit', status => { clearTimeout(timer); reject(Error(`Companion exited: ${status}`)) })
  })
  const pair = await fetch(`${url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!pair.ok) throw Error('Pairing failed')
  const cookie = pair.headers.get('set-cookie').split(';')[0]
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
  const { document } = await (await fetch(`${url}/api/document`, { headers })).json()
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  document.settings.onboardingDone = true; document.revision++
  const seeded = await fetch(`${url}/api/document`, { method: 'PUT', headers: { ...headers, 'If-Match': '0' }, body: JSON.stringify({ document }) })
  if (!seeded.ok) throw Error('Synthetic workspace could not be seeded')
  const config = { mcpServers: { next168: { command: process.execPath, args: [join(root, 'companion/dist/cli.js'), 'mcp'], env: { NEXT168_HOME: home, NEXT168_PORT: String(port) } } } }
  const configFile = join(home, 'mcp-config.json')
  await writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 })
  const prompt = 'Use only the Weeklid MCP tools (server next168). First call get_week to read the workspace and revision. Then call propose_changes exactly once to propose one block titled "MCP smoke focus", in category "focus", on Monday (days [1]), from minute 540 to 600. Use the actual workspaceId and revision you just read and contractVersion "1.0". Do not approve or apply anything. Report the proposal id and say that it is pending user review.'
  const args = ['-p', prompt, '--strict-mcp-config', '--mcp-config', configFile, '--allowedTools', 'mcp__next168__get_week,mcp__next168__propose_changes', '--output-format', 'stream-json', '--verbose']
  claude = spawn('claude', args, { env, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] })
  let transcript = '', errors = ''
  claude.stdout.on('data', chunk => { transcript += chunk.toString() })
  claude.stderr.on('data', chunk => { errors += chunk.toString() })
  const timer = setTimeout(() => claude.kill('SIGTERM'), 180_000)
  let status
  try { status = await new Promise((resolve, reject) => { claude.once('error', reject); claude.once('exit', resolve) }) }
  finally { clearTimeout(timer) }
  await writeFile(join(privateReports, 'claude-transcript.jsonl'), transcript, { mode: 0o600 })
  await writeFile(join(privateReports, 'claude-stderr.txt'), errors, { mode: 0o600 })
  const proposals = (await (await fetch(`${url}/api/proposals?status=pending`, { headers })).json()).proposals
  const current = (await (await fetch(`${url}/api/document`, { headers })).json()).document
  const valid = status === 0 && proposals.length === 1 && proposals[0].ops.length === 1 && proposals[0].ops[0].op === 'add_block' && proposals[0].ops[0].block.title === 'MCP smoke focus' && current.revision === 1 && current.blocks.length === 0 && transcript.includes('mcp__next168__get_week') && transcript.includes('mcp__next168__propose_changes')
  const cliVersion = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()
  const init = transcript.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return {} } }).find(entry => entry.type === 'system' && entry.subtype === 'init')
  const report = { cliVersion, model: init?.model ?? 'UNKNOWN: no init model receipt', timestamp: new Date().toISOString(), status: valid ? 'PASS' : 'FAIL', claudeExit: status, command: ['claude', ...args], home, proposals, revisionBeforeApproval: current.revision, blocksBeforeApproval: current.blocks.length, transcript: join(privateReports, 'claude-transcript.jsonl') }
  await writeFile(join(privateReports, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(`${report.status}: real Claude MCP session. Evidence: ${privateReports}`)
  console.log(`Preserved synthetic workspace: ${home}. Run NEXT168_HOME=${home} NEXT168_PORT=${port} npm run companion:start to review it.`)
  if (!valid) process.exitCode = 1
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally {
  if (claude && claude.exitCode === null) claude.kill('SIGTERM')
  server.kill('SIGTERM')
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
}
