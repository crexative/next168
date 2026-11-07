// Shared server-test harness for accounts and sync: the real handlers over the in-memory SQLite store with the real
// migration applied, a fake Google, a fixed clock, a seeded random source and a cookie-keeping browser. Every server it
// builds is checked after each test: one log line per request, closed vocabularies, no secret or identifier in any line.
import { readFileSync } from 'node:fs'
import { afterEach, expect } from 'vitest'
import type { RandomSource } from '../../google/crypto'
import { sha256b64url } from '../../google/crypto'
import { sqliteD1, type SqliteD1 } from '../../google/testing/sqliteD1'
import { d1AccountsStore, type AccountsStore } from '../accountsStore'
import { handleCallback, handleDeleteAccount, handleSession, handleSignOut, handleStart } from '../authHandlers'
import { readAccountsConfig, type AccountsEnv } from '../config'
import { FLOW_COOKIE, SESSION_COOKIE, type AccountsDeps } from '../session'
import { handleGetPlan, handlePutPlan, handleReplacePlan } from '../syncHandlers'
import { FAKE_ID, FakeIdentity, type IssuedIdentity } from './fakeIdentity'

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error('Server specs run in the node environment: start the spec with `// @vitest-environment node`.')
}

export const APP = 'https://weeklid.crexative.com'
export const SYNC_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 5 + 9) & 0xff)).toString('base64')
export const START_MS = 1_800_000_000_000
export const MIGRATION_SQL = readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8')
export const PURGE_SQL = readFileSync(new URL('../purge.sql', import.meta.url), 'utf8')
export { FAKE_ID }

export const OUTCOMES = [
  'ok', 'notConfigured', 'storage', 'forbidden', 'notFound', 'badRequest', 'state', 'denied', 'auth', 'exchange', 'serverConfig',
  'error', 'signedIn', 'signedOut', 'unauthorized', 'accountMismatch', 'accountDeleted', 'notInvited', 'noPlan', 'unchanged',
  'conflict', 'replaced', 'tooLarge', 'accountRemoved',
]
export const ERROR_CLASSES = ['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError', 'OperationError', 'Other']
export const LOG_ROUTES = ['auth.start', 'auth.callback', 'auth.session', 'auth.signout', 'auth.delete', 'sync.get', 'sync.put', 'sync.replace']

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

export function migrate(db: SqliteD1): void {
  db.sqlite.exec(MIGRATION_SQL)
}

/** Records every store call by name so a test can prove that a path touched nothing. */
function recording(inner: AccountsStore, calls: string[]): AccountsStore {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.push(String(property))
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
}

export interface TestServer {
  env: AccountsEnv
  deps: AccountsDeps
  db: SqliteD1
  identity: FakeIdentity
  clock: { now: number }
  logs: string[]
  storeCalls: string[]
  /** Fetches made through deps.fetch (the only network a handler has). */
  secrets: Set<string>
  requests: number
  send(request: Request): Promise<Response>
  browser(): Browser
  advance(seconds: number): void
  /** Adds a lowercase e-mail to the beta allowlist. */
  invite(email: string): void
  rows(table: string): Record<string, unknown>[]
}

const servers: TestServer[] = []
let seed = 1

afterEach(() => {
  for (const s of servers.splice(0)) {
    expect(s.logs.length, 'one log line per request').toBe(s.requests)
    for (const line of s.logs) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(Object.keys(parsed).every((key) => ['r', 'o', 's', 'ms', 'e'].includes(key)), line).toBe(true)
      expect(LOG_ROUTES, line).toContain(parsed.r)
      expect(OUTCOMES, line).toContain(parsed.o)
      if ('e' in parsed) expect(ERROR_CLASSES, line).toContain(parsed.e)
      for (const secret of s.secrets) if (secret.length >= 8) expect(line.includes(secret), `log leaks ${secret}`).toBe(false)
    }
  }
})

const ROUTES: Record<string, (request: Request, deps: AccountsDeps) => Promise<Response>> = {
  'auth/start': handleStart, 'auth/callback': handleCallback, 'auth/session': handleSession, 'auth/signout': handleSignOut,
  'auth/delete': handleDeleteAccount, 'sync': handleGetPlan, 'sync/replace': handleReplacePlan,
}

export interface ServerOptions {
  withoutDb?: boolean
  /** Skips applying the migration (an owner who has not run it yet). */
  unmigrated?: boolean
}

export function server(overrides: Omit<Partial<AccountsEnv>, 'DB'> & { DB?: SqliteD1 } = {}, options: ServerOptions = {}): TestServer {
  const fresh = overrides.DB === undefined
  const db = overrides.DB ?? sqliteD1()
  if (fresh) {
    if (!options.unmigrated) migrate(db)
  }
  const env: AccountsEnv = {
    APP_ORIGIN: APP,
    VITE_GOOGLE_CLIENT_ID: FAKE_ID.clientId,
    GOOGLE_CLIENT_SECRET: FAKE_ID.clientSecret,
    ACCOUNTS_ENABLED: '1',
    SYNC_KEY,
    ...(options.withoutDb ? {} : { DB: db }),
    ...overrides,
  }
  const config = readAccountsConfig(env)
  const storeCalls: string[] = []
  const clock = { now: START_MS }
  const identity = new FakeIdentity(config.googleOrigin ?? 'https://oauth2.googleapis.com', `${APP}/api/auth/callback`, () => Math.floor(clock.now / 1000))
  const logs: string[] = []
  const deps: AccountsDeps = {
    config,
    store: config.base ? recording(d1AccountsStore(db), storeCalls) : null,
    fetch: identity.fetch,
    random: seededRandom(seed++ * 7919),
    now: () => clock.now,
    log: (line) => logs.push(line),
    deadlineMs: 150,
  }
  const s: TestServer = {
    env, deps, db, identity, clock, logs, storeCalls, requests: 0,
    secrets: new Set<string>([FAKE_ID.clientSecret, 'at-SECRET-123', SYNC_KEY]),
    async send(request) {
      const path = new URL(request.url).pathname.replace(/^\/api\//, '')
      const handler = path === 'sync' ? (request.method === 'PUT' ? handlePutPlan : handleGetPlan) : ROUTES[path]
      if (!handler) throw new Error(`no route ${path}`)
      s.requests++
      return handler(request, deps)
    },
    browser: () => new Browser(s),
    advance(secondsToAdvance) {
      clock.now += secondsToAdvance * 1000
    },
    invite(email) {
      db.sqlite.prepare('INSERT INTO beta_access (email, created_at) VALUES (?, ?)').run(email, 0)
    },
    rows: (table) => db.rows(table),
  }
  servers.push(s)
  return s
}

export interface Reply {
  status: number
  body: Record<string, unknown> | null
  headers: Headers
  setCookies: string[]
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

export interface CallOptions {
  /** Header overrides; null removes a default header. */
  headers?: Record<string, string | null>
  rawBody?: string | ReadableStream<Uint8Array>
  method?: string
}

/** One browser profile on the app's origin: it keeps the cookies the server sets, as a browser would. */
export class Browser {
  readonly jar = new Map<string, string>()

  constructor(readonly server: TestServer) {}

  get session(): string | undefined {
    return this.jar.get(SESSION_COOKIE)
  }

  get flow(): string | undefined {
    return this.jar.get(FLOW_COOKIE)
  }

  private keep(setCookies: string[]): void {
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';')
      const index = pair!.indexOf('=')
      const name = pair!.slice(0, index)
      const value = pair!.slice(index + 1)
      if (/Max-Age=0\b/.test(cookie) || value === '') this.jar.delete(name)
      else this.jar.set(name, value)
      if (value) this.server.secrets.add(value)
    }
  }

  async call(path: string, body?: unknown, options: CallOptions = {}): Promise<Reply> {
    const method = options.method ?? (body === undefined && options.rawBody === undefined ? 'POST' : 'POST')
    const headers: Record<string, string> = {}
    const hasBody = body !== undefined || options.rawBody !== undefined
    const defaults: Record<string, string | null> = {
      'x-weeklid': '1',
      origin: APP,
      'sec-fetch-site': 'same-origin',
      'content-type': hasBody ? 'application/json' : null,
      cookie: this.jar.size ? [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ') : null,
      ...options.headers,
    }
    for (const [name, value] of Object.entries(defaults)) if (value !== null) headers[name] = value
    const raw = options.rawBody
    const init: RequestInit & { duplex?: 'half' } = { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }
    if (raw instanceof ReadableStream) init.duplex = 'half'
    const reply = await toReply(await this.server.send(new Request(`${APP}/api/${path}`, init)))
    this.keep(reply.setCookies)
    return reply
  }

  /** GET /api/sync with the account header, as the client sends it. */
  getPlan(accountKey: string, ifNoneMatch?: string, options: CallOptions = {}): Promise<Reply> {
    return this.call('sync', undefined, {
      method: 'GET',
      ...options,
      headers: { 'x-weeklid-account': accountKey, 'if-none-match': ifNoneMatch ?? null, origin: null, ...options.headers },
    })
  }

  putPlan(body: unknown, options: CallOptions = {}): Promise<Reply> {
    return this.call('sync', body, { method: 'PUT', ...options })
  }

  replacePlan(body: unknown, options: CallOptions = {}): Promise<Reply> {
    return this.call('sync/replace', body, { method: 'PUT', ...options })
  }

  async start(consent = 1): Promise<{ reply: Reply; url: URL; state: string; nonce: string; challenge: string }> {
    const reply = await this.call('auth/start', { consent })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    const url = new URL(String(reply.body!.url))
    return { reply, url, state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')! }
  }

  /** Google's redirect back: a cross-site top-level GET, which carries the Lax flow cookie. */
  async callback(query: Record<string, string>, options: { flow?: string | null } = {}): Promise<{ reply: Reply; location: string; result: string | null }> {
    const flow = options.flow === undefined ? this.flow : options.flow
    const headers: Record<string, string> = {}
    const cookies = [...this.jar].filter(([name]) => name !== FLOW_COOKIE).map(([name, value]) => `${name}=${value}`)
    if (flow) cookies.push(`${FLOW_COOKIE}=${flow}`)
    if (cookies.length) headers.cookie = cookies.join('; ')
    const reply = await toReply(await this.server.send(new Request(`${APP}/api/auth/callback?${new URLSearchParams(query)}`, { headers })))
    this.keep(reply.setCookies)
    const location = reply.headers.get('location') ?? ''
    let result: string | null = null
    try {
      result = new URL(location).searchParams.get('account')
    } catch {
      result = null
    }
    return { reply, location, result }
  }

  /** Start, consent at the fake Google as `who`, and come back: returns the callback's result. */
  async signIn(who: IssuedIdentity): Promise<string | null> {
    this.server.secrets.add(who.sub)
    this.server.secrets.add(who.email)
    const { state, nonce, challenge } = await this.start()
    const code = this.server.identity.issueCode(who, { challenge, nonce })
    return (await this.callback({ state, code })).result
  }

  sessionStatus(): Promise<Reply> {
    return this.call('auth/session')
  }

  signOut(): Promise<Reply> {
    return this.call('auth/signout')
  }

  deleteAccount(accountKey: string): Promise<Reply> {
    return this.call('auth/delete', { accountKey })
  }
}

export const accountKeyOf = (sub: string): Promise<string> => sha256b64url(sub)

export const ALICE: IssuedIdentity = { sub: '100000000000000000001', email: 'alice@example.com' }
export const BOB: IssuedIdentity = { sub: '100000000000000000002', email: 'bob@example.com' }
