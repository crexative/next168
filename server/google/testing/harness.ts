// Shared server-test harness: a server over the in-memory SQLite store, a fake Google, a fixed clock, a seeded random
// source and a cookie-keeping browser. Every server it builds is checked after each test for S-9: one log line per
// request, closed vocabularies, and no secret or identifier in any line.
import { afterEach, expect } from 'vitest'
import { readConfig, type GoogleEnv } from '../config'
import { d1ConnectionStore } from '../connectionStore'
import type { RandomSource } from '../crypto'
import { DEVICE_COOKIE, FLOW_COOKIE, handleCallback, handleConnect, handleDisconnect, handleStatus, handleToken, type Deps } from '../handlers'
import { ControlledStore } from './controlledStore'
import { FAKE, FakeGoogle } from './fakeGoogle'
import { sqliteD1, type SqliteD1 } from './sqliteD1'

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error('Server specs run in the node environment: start the spec with `// @vitest-environment node`.')
}

export const APP = 'https://weeklid.crexative.com'
export const TOKEN_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString('base64')
export const OTHER_TOKEN_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff)).toString('base64')
export const EPOCH_A = 'AAAAAAAAAAAAAAAAAAAAAA'
export const EPOCH_B = 'BBBBBBBBBBBBBBBBBBBBBB'
export const START_MS = 1_800_000_000_000
export { FAKE }

/** A well-formed 22-character id for rows written directly in a test. */
export const id22 = (label: string): string => label.padEnd(22, '_').slice(0, 22)

export const OUTCOMES = [
  'ok', 'noDevice', 'notConnected', 'reconnect', 'notConfigured', 'disabled', 'serverConfig', 'googleUnavailable', 'storage',
  'forbidden', 'notFound', 'badRequest', 'state', 'cancelled', 'denied', 'auth', 'exchange', 'noRefreshToken', 'missingScope',
  'canary', 'connected', 'confirmed', 'unconfirmed', 'forgotten', 'none', 'stale', 'error',
]
export const ERROR_CLASSES = ['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError', 'OperationError', 'Other']

export function seededRandom(seed: number): RandomSource {
  let x = seed >>> 0 || 1
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      x ^= x << 13; x >>>= 0
      x ^= x >>> 17
      x ^= x << 5; x >>>= 0
      bytes[i] = x & 0xff
    }
    return bytes
  }
}

export interface Reply {
  status: number
  body: Record<string, unknown> | null
  headers: Headers
  setCookies: string[]
}

export interface TestServer {
  env: GoogleEnv
  deps: Deps
  store: ControlledStore
  db: SqliteD1
  google: FakeGoogle
  clock: { now: number }
  logs: string[]
  /** Values that must never appear in a log line. */
  secrets: Set<string>
  requests: number
  send(request: Request): Promise<Response>
  browser(): Browser
  advance(seconds: number): void
}

const servers: TestServer[] = []
let seed = 1

afterEach(() => {
  for (const s of servers.splice(0)) {
    expect(s.logs.length, 'one log line per request').toBe(s.requests)
    for (const line of s.logs) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(Object.keys(parsed).every((key) => ['r', 'o', 's', 'ms', 'e'].includes(key)), line).toBe(true)
      expect(OUTCOMES, line).toContain(parsed.o)
      if ('e' in parsed) expect(ERROR_CLASSES, line).toContain(parsed.e)
      for (const secret of s.secrets) if (secret.length >= 8) expect(line.includes(secret), `log leaks ${secret}`).toBe(false)
    }
  }
})

function collectRowSecrets(s: TestServer): void {
  for (const row of [...s.db.rows('google_pending'), ...s.db.rows('google_credentials')]) {
    for (const column of ['device_hash', 'connection_id', 'pending_id', 'state_hash', 'verifier', 'ciphertext']) {
      if (typeof row[column] === 'string') s.secrets.add(row[column] as string)
    }
  }
}

/** A server; pass another server's `db` as `DB` to run a second configuration over the same rows. */
export function server(overrides: Omit<Partial<GoogleEnv>, 'DB'> & { DB?: SqliteD1 } = {}, options: { withoutDb?: boolean } = {}): TestServer {
  const db = overrides.DB ?? sqliteD1()
  const env: GoogleEnv = {
    APP_ORIGIN: APP,
    VITE_GOOGLE_CLIENT_ID: FAKE.clientId,
    GOOGLE_TOKEN_KEY: TOKEN_KEY,
    GOOGLE_SERVER_ENABLED: '1',
    GOOGLE_CLIENT_SECRET: FAKE.clientSecret,
    ...(options.withoutDb ? {} : { DB: db }),
    ...overrides,
  }
  const config = readConfig(env)
  const store = new ControlledStore(d1ConnectionStore(db))
  const testOrigin = config.googleOrigin
  const google = new FakeGoogle(testOrigin ?? 'https://oauth2.googleapis.com', `${APP}/api/google/callback`)
  const clock = { now: START_MS }
  const logs: string[] = []
  const deps: Deps = {
    config,
    store: config.base ? store : null,
    fetch: google.fetch,
    random: seededRandom(seed++ * 7919),
    now: () => clock.now,
    log: (line) => logs.push(line),
    deadlines: { googleMs: 150, revokeMs: 150 },
  }
  const routes: Record<string, (request: Request, deps: Deps) => Promise<Response>> = {
    connect: handleConnect, callback: handleCallback, token: handleToken, status: handleStatus, disconnect: handleDisconnect,
  }
  const s: TestServer = {
    env, deps, store, db, google, clock, logs, requests: 0,
    secrets: new Set<string>([FAKE.clientSecret, FAKE.refreshToken, FAKE.accessToken, TOKEN_KEY]),
    async send(request) {
      const route = new URL(request.url).pathname.replace(/^\/api\/google\//, '')
      const handler = routes[route]
      if (!handler) throw new Error(`no route ${route}`)
      s.requests++
      const response = await handler(request, deps)
      collectRowSecrets(s)
      for (const call of google.calls) for (const value of Object.values(call.form)) if (value !== FAKE.clientId) s.secrets.add(value)
      return response
    },
    browser: () => new Browser(s),
    advance(seconds) {
      clock.now += seconds * 1000
    },
  }
  servers.push(s)
  return s
}

async function toReply(response: Response): Promise<Reply> {
  const text = await response.text()
  let body: Record<string, unknown> | null = null
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    body = null
  }
  return { status: response.status, body, headers: response.headers, setCookies: response.headers.getSetCookie() }
}

export interface PostOptions {
  /** Header overrides; null removes a default header. */
  headers?: Record<string, string | null>
  rawBody?: string
  url?: string
}

/** One browser profile on the app's origin: it keeps the cookies the server sets, as a browser would. */
export class Browser {
  readonly jar = new Map<string, string>()
  readonly states: string[] = []

  constructor(readonly server: TestServer) {}

  get deviceId(): string | undefined {
    return this.jar.get(DEVICE_COOKIE)
  }

  private keep(setCookies: string[]): void {
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';')
      const index = pair!.indexOf('=')
      this.jar.set(pair!.slice(0, index), pair!.slice(index + 1))
      this.server.secrets.add(pair!.slice(index + 1))
    }
  }

  async post(route: string, body?: unknown, options: PostOptions = {}): Promise<Reply> {
    const headers: Record<string, string> = {}
    const defaults: Record<string, string | null> = {
      'x-weeklid': '1',
      origin: APP,
      'sec-fetch-site': 'same-origin',
      'content-type': body === undefined && options.rawBody === undefined ? null : 'application/json',
      cookie: this.jar.size ? [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ') : null,
      ...options.headers,
    }
    for (const [name, value] of Object.entries(defaults)) if (value !== null) headers[name] = value
    const request = new Request(options.url ?? `${APP}/api/google/${route}`, {
      method: 'POST',
      headers,
      body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    const reply = await toReply(await this.server.send(request))
    this.keep(reply.setCookies)
    return reply
  }

  async connect(epoch = EPOCH_A, from: 'app' | 'canary' = 'app'): Promise<{ reply: Reply; url: URL; state: string; challenge: string }> {
    const reply = await this.post('connect', { from, epoch })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    const url = new URL(String(reply.body!.url))
    const state = url.searchParams.get('state')!
    this.states.push(state)
    return { reply, url, state, challenge: url.searchParams.get('code_challenge')! }
  }

  /** Google's redirect back: a cross-site top-level GET, which carries the Lax flow cookie and not the Strict device one. */
  async callback(query: Record<string, string>, options: { flow?: string | null; url?: string } = {}): Promise<{ reply: Reply; location: string; result: string | null }> {
    const flow = options.flow === undefined ? this.jar.get(FLOW_COOKIE) : options.flow
    const headers: Record<string, string> = {}
    if (flow) headers.cookie = `${FLOW_COOKIE}=${flow}`
    const request = new Request(options.url ?? `${APP}/api/google/callback?${new URLSearchParams(query)}`, { headers })
    const reply = await toReply(await this.server.send(request))
    const location = reply.headers.get('location') ?? ''
    let result: string | null = null
    try {
      result = new URL(location).searchParams.get('google')
    } catch {
      result = null
    }
    return { reply, location, result }
  }

  /** Connect, consent at the fake Google, and come back: returns the callback's result. */
  async consent(options: { epoch?: string; refreshToken?: string | null; scope?: string; from?: 'app' | 'canary' } = {}): Promise<string | null> {
    const { state, challenge } = await this.connect(options.epoch, options.from)
    const code = this.server.google.issueCode({ refreshToken: options.refreshToken, scope: options.scope, challenge })
    return (await this.callback({ state, code })).result
  }

  mint(): Promise<Reply> {
    return this.post('token')
  }

  status(): Promise<Reply> {
    return this.post('status')
  }

  disconnect(gen: string, revoke = true): Promise<Reply> {
    return this.post('disconnect', { revoke, gen })
  }
}
