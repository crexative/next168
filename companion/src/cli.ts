import { mkdir, open, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { startCompanion } from './server'
import { mcpToken, newPairCode, secret } from './auth'
import { atomicWrite, readOptional } from './files'
import { sdkSchema, toolDefinitions, MAX_TOOL_INPUT_ELEMENTS } from './mcp'

const home = resolve(process.env.NEXT168_HOME ?? join(homedir(), '.next168'))
const portOption = process.argv.indexOf('--port')
const port = Number(portOption >= 0 ? process.argv[portOption + 1] : process.env.NEXT168_PORT ?? 1680)
const command = process.argv[2] ?? 'serve'
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Port must be an integer between 1 and 65535')
const url = `http://127.0.0.1:${port}`
async function run() {
  if (command === 'mcp') {
    const token = await readOptional(join(home, 'mcp-token'))
    if (!token) throw Error('Companion is not running. Run next168-companion serve first.')
    const remote = new Client({ name: 'next168-stdio-proxy', version: '0.1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    try { await remote.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token.trim()}` } } })) }
    catch { await remote.close(); throw Error('Companion unavailable or token rotated. Run next168-companion serve and reconnect.') }
    serveStdio(() => {
      const server = new McpServer({ name: 'next168', version: '0.1.0' }, { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS })
      for (const definition of toolDefinitions) server.registerTool(definition.name, {
        description: definition.description, inputSchema: sdkSchema(definition.input), outputSchema: sdkSchema(definition.output),
        annotations: { readOnlyHint: definition.name !== 'propose_changes', destructiveHint: false, openWorldHint: false },
      }, async args => {
        try { return await remote.callTool({ name: definition.name, arguments: args as Record<string, unknown> }) }
        catch { return { isError: true, content: [{ type: 'text' as const, text: 'Companion unavailable. Start serve and reconnect; no changes were applied.' }] } }
      })
      return server
    }, { onerror: () => { console.error('MCP stdio request failed') } })
    process.stdin.once('end', () => { void remote.close() })
    return
  }
  await mkdir(home, { recursive: true, mode: 0o700 })
  if (command === 'token') {
    if (process.argv[3] === 'rotate') await atomicWrite(join(home, 'mcp-token'), secret())
    else await mcpToken(home)
    console.log(`MCP token file: ${join(home, 'mcp-token')}. Read it only when configuring an HTTP client. Restart clients after rotation.`)
    return
  }
  if (command === 'pair') {
    const code = await newPairCode(home)
    console.log(`Pairing code (single use, 10 minutes): ${code}\nOpen ${url}/#pair=${code}`)
    return
  }
  if (command !== 'serve') throw Error('Usage: next168-companion [serve|mcp|pair|token [rotate]] [--port PORT]')
  const lockFile = join(home, 'companion.lock')
  let lock
  try { lock = await open(lockFile, 'wx', 0o600) }
  catch {
    const pid = Number((await readOptional(lockFile))?.trim())
    if (!Number.isInteger(pid) || pid < 1) throw Error('Companion lock is unreadable. Preserve the data and inspect companion.lock before restarting.')
    try { process.kill(pid, 0); throw Error('A companion already owns this workspace') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    await unlink(lockFile)
    lock = await open(lockFile, 'wx', 0o600)
  }
  await lock.writeFile(String(process.pid)); await lock.close()
  let running: Awaited<ReturnType<typeof startCompanion>> | undefined
  const cleanup = async () => { await running?.close(); await unlink(lockFile).catch(() => undefined) }
  try {
    const dist = process.env.NEXT168_DIST ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
    running = await startCompanion({ home, dist, port })
    const loaded = await running.workspace.load()
    console.log(`Next168 companion: ${url}\nWorkspace: ${home}`)
    if (loaded.kind !== 'ok') console.error('Planner is unreadable; writes are blocked. Pair and use the recovery screen to restore a validated .bak. Original bytes are preserved.')
    const pairUrl = `${url}/#pair=${running.pairingCode}`
    console.log(`Pairing code (single use, 10 minutes): ${running.pairingCode}\nOpen ${pairUrl}`)
    if (!process.argv.includes('--no-open')) {
      const browser = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [pairUrl], { stdio: 'ignore' })
      browser.on('error', () => { console.error('Open the pairing URL above in your browser.') })
      browser.unref()
    }
    process.once('SIGINT', () => { void cleanup().then(() => process.exit(0)) })
    process.once('SIGTERM', () => { void cleanup().then(() => process.exit(0)) })
  } catch (error) { await cleanup(); throw error }
}
run().catch(error => { console.error(error instanceof Error ? error.message : 'Companion failed'); process.exitCode = 1 })
