import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, resolve, extname, sep } from 'node:path'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod'
import { changeProposalSchema, proposalInputSchema, type PlannerDocument } from '../../src/core/model'
import { parseExportBundle } from '../../src/core/exportBundle'
import { Workspace } from './workspace'
import { atomicWrite, readOptional } from './files'
import { BrowserSessions, equalSecret, mcpToken, newPairCode } from './auth'
import { createMcpServer } from './mcp'
import { fetchCalendar, MAX_CALENDAR_BYTES } from './calendarFetch'

interface Options { home: string; dist: string; port?: number; now?: () => number }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage, maxBytes: number): Promise<string> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); bytes += buffer.length
    if (bytes > maxBytes) throw new HttpError(413, 'body-too-large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
async function jsonBody(request: IncomingMessage, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'json-required')
  const value: unknown = JSON.parse(await body(request, maxBytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'object-required')
  return value as Record<string, unknown>
}
const collectionLimits: Record<string, number> = { categories: 100, blocks: 1000, tasks: 5000, checkIns: 3660, actuals: 50000, events: 5000, calendarSources: 20, appliedProposalIds: 200 }
function boundDocumentCollections(value: unknown) {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'invalid-document')
  for (const [key, limit] of Object.entries(collectionLimits)) {
    const collection = (value as Record<string, unknown>)[key]
    if (Array.isArray(collection) && collection.length > limit) throw new HttpError(413, 'collection-too-large')
  }
  for (const block of Array.isArray((value as Record<string, unknown>).blocks) ? (value as { blocks: unknown[] }).blocks : []) {
    if (block && typeof block === 'object' && 'days' in block && Array.isArray(block.days) && block.days.length > 7) throw new HttpError(413, 'days-too-large')
  }
  for (const event of Array.isArray((value as Record<string, unknown>).events) ? (value as { events: unknown[] }).events : []) {
    if (event && typeof event === 'object' && 'attendees' in event && Array.isArray(event.attendees) && event.attendees.length > 50) throw new HttpError(413, 'attendees-too-large')
  }
}
export async function startCompanion(options: Options) {
  const workspace = new Workspace(options.home, () => new Date(options.now?.() ?? Date.now()))
  await workspace.initialize()
  await mcpToken(options.home)
  const sessions = new BrowserSessions(options.home, options.now)
  const pairingCode = await newPairCode(options.home, options.now?.())
  const mcp = createMcpHandler(() => createMcpServer(workspace), { legacy: 'stateless', maxRequestBodySize: 256 * 1024 })
  const handleMcp = toNodeHandler(mcp)
  const calendarDirectory = join(options.home, 'calendars')
  await mkdir(calendarDirectory, { recursive: true, mode: 0o700 })
  let port = options.port ?? 1680
  const server = createServer((request, response) => { void handle(request, response).catch(error => {
    if (response.headersSent) { response.destroy(); return }
    const status = error instanceof HttpError ? error.status : error instanceof SyntaxError || error instanceof z.ZodError ? 400 : error instanceof Error && /staleRevision|revision-mismatch/.test(error.message) ? 409 : 422
    json(response, status, { error: error instanceof Error ? error.message : 'request-failed' })
  }) })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.maxHeadersCount = 40
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    if (!allowedHosts.includes(request.headers.host ?? '')) throw new HttpError(403, 'host-forbidden')
    if (request.headers.origin && !allowedHosts.map(host => `http://${host}`).includes(request.headers.origin)) throw new HttpError(403, 'origin-forbidden')
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'cross-site-forbidden')
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/mcp') {
      const expected = (await readOptional(join(options.home, 'mcp-token')))?.trim()
      if (!expected) throw new HttpError(401, 'mcp-token-unavailable')
      if (!equalSecret(request.headers.authorization ?? '', `Bearer ${expected}`)) throw new HttpError(401, 'mcp-token-required')
      await handleMcp(request, response); return
    }
    if (url.pathname === '/api/pair' && request.method === 'POST') {
      const payload = await jsonBody(request, 1024)
      const session = await sessions.pair(payload.code)
      if (!session) throw new HttpError(403, 'pairing-code-invalid-or-expired')
      response.setHeader('Set-Cookie', `next168_session=${session}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400`)
      json(response, 200, { paired: true }); return
    }
    if (url.pathname.startsWith('/api/')) {
      if (!sessions.valid(request.headers.cookie)) throw new HttpError(401, 'pairing-required')
      const method = request.method
      if (url.pathname === '/api/document' && method === 'GET') {
        const result = await workspace.load()
        json(response, 200, result.kind === 'ok' ? { document: result.document, warnings: [...workspace.warnings] } : result); return
      }
      if (url.pathname === '/api/import' && method === 'POST') {
        const payload = await jsonBody(request, 120 * 1024 * 1024)
        const envelope = z.object({ expectedRevision: z.number().int().min(0), bundle: z.object({ document: z.unknown() }).passthrough() }).parse(payload)
        boundDocumentCollections(envelope.bundle.document)
        const parsed = parseExportBundle(JSON.stringify(envelope.bundle))
        if (parsed.kind !== 'ok') throw new HttpError(400, 'invalid-export')
        const saved = await workspace.importBundle(parsed.bundle, envelope.expectedRevision)
        json(response, saved.kind === 'conflict' ? 409 : 200, { ...saved, warnings: [...workspace.warnings] }); return
      }
      if (url.pathname === '/api/document' && method === 'PUT') {
        const expected = request.headers['if-match']
        if (typeof expected !== 'string' || !/^\d+$/.test(expected)) throw new HttpError(400, 'if-match-required')
        const payload = await jsonBody(request, 16 * 1024 * 1024)
        boundDocumentCollections(payload.document)
        const saved = await workspace.save(payload.document as PlannerDocument, Number(expected))
        json(response, saved.kind === 'conflict' ? 409 : 200, { ...saved, warnings: [...workspace.warnings] }); return
      }
      if (url.pathname === '/api/backup' && method === 'GET') { json(response, 200, { document: await workspace.backup() ?? null }); return }
      if (url.pathname === '/api/backup/restore' && method === 'POST') { json(response, 200, await workspace.restoreBackup()); return }
      if (url.pathname === '/api/proposals' && method === 'GET') {
        const status = url.searchParams.get('status')
        const parsed = status ? changeProposalSchema.shape.status.parse(status) : undefined
        json(response, 200, { proposals: await workspace.list(parsed) }); return
      }
      if (url.pathname === '/api/proposals' && method === 'POST') {
        const payload = await jsonBody(request)
        if (payload.input && typeof payload.input === 'object' && 'ops' in payload.input && Array.isArray(payload.input.ops) && payload.input.ops.length > 50) throw new HttpError(413, 'ops-too-large')
        const source = z.enum(['assistant', 'import']).parse(payload.source)
        const proposal = await workspace.create(proposalInputSchema.parse(payload.input), source)
        json(response, 201, { proposal }); return
      }
      const proposalPath = /^\/api\/proposals\/([^/]+)\/(apply|approve|reject)$/.exec(url.pathname)
      if (proposalPath && method === 'POST') {
        const id = decodeURIComponent(proposalPath[1]!)
        let result
        if (proposalPath[2] === 'reject') result = await workspace.reject(id)
        else {
          const binding = z.object({ contentHash: changeProposalSchema.shape.contentHash, baseRevision: changeProposalSchema.shape.baseRevision }).parse(await jsonBody(request))
          result = await workspace.approve(id, binding.contentHash, binding.baseRevision)
        }
        json(response, result.kind === 'stale' ? 409 : result.kind === 'not-found' ? 404 : 200, { ...result, warnings: [...workspace.warnings] }); return
      }
      if (url.pathname === '/api/calendars' && method === 'GET') {
        const ids = (await readdir(calendarDirectory)).filter(file => file.endsWith('.ics')).map(file => decodeURIComponent(file.slice(0, -4)))
        json(response, 200, { ids }); return
      }
      const calendarPath = /^\/api\/calendars\/([^/]+)$/.exec(url.pathname)
      if (calendarPath) {
        const id = z.string().min(1).max(64).parse(decodeURIComponent(calendarPath[1]!))
        const file = join(calendarDirectory, `${encodeURIComponent(id).replace(/\./g, '%2E')}.ics`)
        if (method === 'GET') {
          const text = await readOptional(file)
          if (text === undefined) throw new HttpError(404, 'calendar-not-found')
          response.setHeader('Content-Type', 'text/calendar; charset=utf-8'); response.end(text); return
        }
        if (method === 'PUT') {
          const text = await body(request, MAX_CALENDAR_BYTES)
          await workspace.mutex.run(() => atomicWrite(file, text))
          json(response, 200, { ok: true }); return
        }
        if (method === 'DELETE') {
          await workspace.mutex.run(async () => { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error }) })
          json(response, 200, { ok: true }); return
        }
      }
      if (url.pathname === '/api/ics' && method === 'GET') {
        const text = await fetchCalendar(url.searchParams.get('url') ?? '')
        response.setHeader('Content-Type', 'text/calendar; charset=utf-8'); response.end(text); return
      }
      throw new HttpError(404, 'api-not-found')
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed')
    const root = await realpath(options.dist)
    const requested = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (requested !== root && !requested.startsWith(root + sep)) throw new HttpError(403, 'path-forbidden')
    let file: string
    try { file = await realpath(requested === root ? join(root, 'index.html') : requested) }
    catch { throw new HttpError(404, 'file-not-found') }
    if (!file.startsWith(root + sep)) throw new HttpError(403, 'path-forbidden')
    let bytes = await readFile(file)
    const extension = extname(file)
    const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon' }
    if (file === join(root, 'index.html')) bytes = Buffer.from(bytes.toString('utf8').replace('<head>', "<head><script>window.__NEXT168__ = { mode: 'companion' }</script>"))
    response.setHeader('Content-Type', mime[extension] ?? 'application/octet-stream')
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
  port = (server.address() as { port: number }).port
  return { server, workspace, pairingCode, port, url: `http://127.0.0.1:${port}`, close: async () => { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) } }
}
