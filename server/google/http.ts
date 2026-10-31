// Request guards (D7), responses, cookies and the one-line outcome log (D12).
import type { Config } from './config'

export type Outcome =
  | 'ok' | 'noDevice' | 'notConnected' | 'reconnect' | 'notConfigured' | 'disabled' | 'serverConfig'
  | 'googleUnavailable' | 'storage' | 'forbidden' | 'notFound' | 'badRequest' | 'state' | 'cancelled' | 'denied'
  | 'auth' | 'exchange' | 'noRefreshToken' | 'missingScope' | 'canary' | 'connected' | 'confirmed' | 'unconfirmed'
  | 'forgotten' | 'none' | 'stale' | 'error'

export type ErrorClass = 'AbortError' | 'TimeoutError' | 'TypeError' | 'SyntaxError' | 'OperationError' | 'Other'

const NAMED_ERRORS: readonly ErrorClass[] = ['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError', 'OperationError']

// Only the error's class is ever logged: never its message, and a name outside the closed list becomes `Other`.
export function errorClass(error: unknown): ErrorClass {
  const name = error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException) ? error.name : ''
  return (NAMED_ERRORS as readonly string[]).includes(name) ? (name as ErrorClass) : 'Other'
}

export interface Reply {
  status: number
  outcome: Outcome
  body: string
  headers: [string, string][]
  error?: ErrorClass
}

const SECURITY_HEADERS: [string, string][] = [
  ['cache-control', 'no-store'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'no-referrer'],
]

export function json(status: number, outcome: Outcome, payload: unknown, extra: { cookies?: string[]; error?: ErrorClass } = {}): Reply {
  return {
    status,
    outcome,
    body: JSON.stringify(payload),
    headers: [['content-type', 'application/json; charset=utf-8'], ...SECURITY_HEADERS, ...(extra.cookies ?? []).map((c): [string, string] => ['set-cookie', c])],
    error: extra.error,
  }
}

export const failure = (status: number, outcome: Outcome, error?: ErrorClass): Reply => json(status, outcome, { code: outcome }, { error })

export function redirect(location: string, outcome: Outcome, error?: ErrorClass): Reply {
  return { status: 303, outcome, body: '', headers: [['location', location], ...SECURITY_HEADERS], error }
}

export function page(contentType: string, body: string, csp?: string): Reply {
  const headers: [string, string][] = [['content-type', contentType], ...SECURITY_HEADERS]
  if (csp) headers.push(['content-security-policy', csp])
  return { status: 200, outcome: 'ok', body, headers }
}

function toResponse(reply: Reply): Response {
  const headers = new Headers()
  for (const [name, value] of reply.headers) headers.append(name, value)
  return new Response(reply.status === 303 ? null : reply.body, { status: reply.status, headers })
}

export interface Runtime {
  config: Config
  now: () => number
  log: (line: string) => void
}

function logLine(runtime: Runtime, route: string, reply: Reply, started: number): void {
  const line: Record<string, string | number> = { r: route, o: reply.outcome, s: reply.status, ms: Math.max(0, Math.round(runtime.now() - started)) }
  if (reply.error) line.e = reply.error
  runtime.log(JSON.stringify(line))
}

// Runs a route, turns an escaped exception into `fallback` and writes exactly one log line.
export async function serve(runtime: Runtime, route: string, work: () => Promise<Reply>, fallback: (error: ErrorClass) => Reply): Promise<Response> {
  const started = runtime.now()
  let reply: Reply
  try {
    reply = await work()
  } catch (error) {
    reply = fallback(errorClass(error))
  }
  logLine(runtime, route, reply, started)
  return toResponse(reply)
}

export const jsonFallback = (error: ErrorClass): Reply => failure(500, 'error', error)

// --- Cookies -------------------------------------------------------------------------------------------------------

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return null
}

export function setCookie(name: string, value: string, maxAge: number, sameSite: 'Strict' | 'Lax'): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=${sameSite}`
}

// --- Guards (D7) ---------------------------------------------------------------------------------------------------

// Checks 1–2, shared by every route: the callback and the canary pages stop here.
export function guardHostAndSwitch(request: Request, config: Config): Reply | null {
  if (!config.appOrigin || new URL(request.url).origin !== config.appOrigin) return failure(404, 'notFound')
  if (!config.enabled) return failure(503, 'disabled')
  return null
}

// Checks 1–6 for every POST, in order; each failure stops before any storage or Google access.
export function guardPost(request: Request, config: Config, options: { requireJson: boolean }): Reply | null {
  const hostOrSwitch = guardHostAndSwitch(request, config)
  if (hostOrSwitch) return hostOrSwitch
  if (request.headers.get('x-weeklid') !== '1') return failure(403, 'forbidden')
  if (request.headers.get('origin') !== config.appOrigin) return failure(403, 'forbidden')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return failure(403, 'forbidden')
  if (options.requireJson && !/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return failure(400, 'badRequest')
  return null
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await request.text())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

// A GET-only page or script (the temporary canary): checks 1–2 only, then the fixed body.
export function servePage(runtime: Runtime, route: string, request: Request, contentType: string, body: string, csp?: string): Promise<Response> {
  return serve(runtime, route, async () => guardHostAndSwitch(request, runtime.config) ?? page(contentType, body, csp), jsonFallback)
}
