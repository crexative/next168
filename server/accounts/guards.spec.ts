// @vitest-environment node
// The free-tier and flag-off guards: with the feature off, every route answers 404 and touches nothing; with it on but
// unconfigured, nothing starts; and the request guards (Origin, X-Weeklid, Fetch Metadata, JSON) stop each violation alone.
import { describe, expect, it } from 'vitest'
import type { AccountsEnv } from './config'
import { ALICE, APP, BOB, FAKE_ID, SYNC_KEY, server, type Browser, type Reply, type TestServer } from './testing/harness'
import { smallPlan } from './testing/plans'

const KEY = 'A'.repeat(43)
const plan = smallPlan()

interface Call {
  name: string
  send: (b: Browser) => Promise<Reply>
}

const ROUTES: Call[] = [
  { name: 'POST auth/start', send: (b) => b.call('auth/start', { consent: 1 }) },
  { name: 'POST auth/session', send: (b) => b.call('auth/session') },
  { name: 'POST auth/signout', send: (b) => b.call('auth/signout') },
  { name: 'POST auth/delete', send: (b) => b.call('auth/delete', { accountKey: KEY }) },
  { name: 'GET auth/callback', send: async (b) => (await b.callback({ state: 'x'.repeat(43), code: 'c' }, { flow: 'y'.repeat(43) })).reply },
  { name: 'GET sync', send: (b) => b.getPlan(KEY) },
  { name: 'PUT sync', send: (b) => b.putPlan({ accountKey: KEY, baseRevision: 0, epoch: 0, document: plan }) },
  { name: 'PUT sync/replace', send: (b) => b.replacePlan({ accountKey: KEY, document: plan }) },
]

function snapshot(s: TestServer): string {
  const tables = (s.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name)
  return JSON.stringify(Object.fromEntries(tables.map((name) => [name, s.rows(name)])))
}

function expectNoCors(reply: Reply): void {
  for (const [name] of reply.headers) expect(name.toLowerCase().startsWith('access-control-'), name).toBe(false)
}

describe('free tier: the feature is off', () => {
  const OFF: [string, Omit<Partial<AccountsEnv>, 'DB'>][] = [
    ['ACCOUNTS_ENABLED unset', { ACCOUNTS_ENABLED: undefined }],
    ['ACCOUNTS_ENABLED empty', { ACCOUNTS_ENABLED: '' }],
    ['ACCOUNTS_ENABLED=0', { ACCOUNTS_ENABLED: '0' }],
    ['ACCOUNTS_ENABLED=true', { ACCOUNTS_ENABLED: 'true' }],
    ['ACCOUNTS_ENABLED=2', { ACCOUNTS_ENABLED: '2' }],
    ['ACCOUNTS_ENABLED=" 1"', { ACCOUNTS_ENABLED: ' 1' }],
    ['only the Google calendar server switched on', { ACCOUNTS_ENABLED: undefined, ...({ GOOGLE_SERVER_ENABLED: '1', GOOGLE_TOKEN_KEY: SYNC_KEY } as object) }],
  ]
  for (const [label, env] of OFF) {
    it.each(ROUTES)(`${label}: $name → 404, nothing read, written, fetched or set`, async ({ send }) => {
      const s = server(env)
      s.invite(ALICE.email)
      const before = snapshot(s)
      const reply = await send(s.browser())
      expect(reply.status).toBe(404)
      expect(reply.body).toEqual({ code: 'notFound' })
      expect(reply.setCookies).toEqual([])
      expect(reply.headers.get('location')).toBeNull()
      expect(s.storeCalls).toEqual([])
      expect(s.identity.calls).toEqual([])
      expect(snapshot(s)).toBe(before)
      expectNoCors(reply)
    })
  }

  it('a deployment with no variables at all answers 404 on every route and has no store', async () => {
    const s = server({ APP_ORIGIN: undefined, VITE_GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, SYNC_KEY: undefined, ACCOUNTS_ENABLED: undefined }, { withoutDb: true })
    expect(s.deps.store).toBeNull()
    for (const { send } of ROUTES) expect((await send(s.browser())).status).toBe(404)
  })

  it.each([
    ['no APP_ORIGIN', { APP_ORIGIN: undefined }],
    ['an APP_ORIGIN that is not a bare https origin', { APP_ORIGIN: `${APP}/` }],
    ['an http APP_ORIGIN', { APP_ORIGIN: 'http://weeklid.crexative.com' }],
  ])('%s: every route answers 404 even with the switch on', async (_label, env) => {
    const s = server(env)
    for (const { send } of ROUTES) expect((await send(s.browser())).status).toBe(404)
    expect(s.storeCalls).toEqual([])
  })

  it('a request to another host answers 404 and touches nothing', async () => {
    const s = server()
    const reply = await s.send(new Request('https://next168.pages.dev/api/auth/session', {
      method: 'POST', headers: { 'x-weeklid': '1', origin: 'https://next168.pages.dev', 'sec-fetch-site': 'same-origin' },
    }))
    expect(reply.status).toBe(404)
    expect(s.storeCalls).toEqual([])
  })

  it('switching the flag off again returns every route to 404, and keeps the rows (the purge is a separate, ordered step)', async () => {
    const on = server()
    on.invite(ALICE.email)
    const b = on.browser()
    expect(await b.signIn(ALICE)).toBe('signedIn')
    const rowsBefore = snapshot(on)
    const off = server({ DB: on.db, ACCOUNTS_ENABLED: undefined })
    for (const { send } of ROUTES) expect((await send(off.browser())).status).toBe(404)
    expect(snapshot(off)).toBe(rowsBefore)
    expect(off.storeCalls).toEqual([])
  })
})

describe('the switch is on but the deployment is not complete', () => {
  const INCOMPLETE: [string, Omit<Partial<AccountsEnv>, 'DB'>][] = [
    ['no SYNC_KEY', { SYNC_KEY: undefined }],
    ['a SYNC_KEY of 31 bytes', { SYNC_KEY: Buffer.alloc(31, 1).toString('base64') }],
    ['a SYNC_KEY of 33 bytes', { SYNC_KEY: Buffer.alloc(33, 1).toString('base64') }],
    ['a SYNC_KEY that is not base64', { SYNC_KEY: '!!!not base64!!!' }],
    ['no GOOGLE_CLIENT_SECRET', { GOOGLE_CLIENT_SECRET: undefined }],
    ['no Google client id', { VITE_GOOGLE_CLIENT_ID: undefined }],
    ['a malformed Google client id', { VITE_GOOGLE_CLIENT_ID: 'not-a-client-id' }],
  ]
  for (const [label, env] of INCOMPLETE) {
    it.each(ROUTES.filter((route) => route.name !== 'GET auth/callback'))(`${label}: $name → 503 notConfigured, nothing touched`, async ({ send }) => {
      const s = server(env)
      const before = snapshot(s)
      const reply = await send(s.browser())
      expect(reply.status).toBe(503)
      expect(reply.body).toEqual({ code: 'notConfigured' })
      expect(s.storeCalls).toEqual([])
      expect(s.identity.calls).toEqual([])
      expect(reply.setCookies).toEqual([])
      expect(snapshot(s)).toBe(before)
    })

    it(`${label}: the callback redirects to notConfigured and signs nobody in`, async () => {
      const s = server(env)
      const { reply, result } = await s.browser().callback({ state: 'x'.repeat(43), code: 'c' }, { flow: 'y'.repeat(43) })
      expect(reply.status).toBe(303)
      expect(result).toBe('notConfigured')
      expect(s.identity.calls).toEqual([])
    })
  }

  it('no database binding: 503 notConfigured', async () => {
    const s = server({}, { withoutDb: true })
    for (const { send } of ROUTES.filter((route) => route.name !== 'GET auth/callback')) expect((await send(s.browser())).status).toBe(503)
  })

  it('migration 1 missing: 503 notConfigured, no table is created, and it works the moment the owner applies it', async () => {
    const s = server({}, { unmigrated: true })
    const before = snapshot(s)
    for (const { send } of ROUTES.filter((route) => route.name !== 'GET auth/callback')) {
      const reply = await send(s.browser())
      expect(reply.status).toBe(503)
      expect(reply.body).toEqual({ code: 'notConfigured' })
      expect(reply.setCookies).toEqual([])
    }
    expect(snapshot(s)).toBe(before)
    expect(s.db.sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get()).toEqual({ n: 0 })
    const { migrate } = await import('./testing/harness')
    migrate(s.db)
    expect((await s.browser().call('auth/session')).status).toBe(200)
  })

  it('a storage failure is a 503 storage with only an error class in the log', async () => {
    const s = server()
    s.db.sqlite.exec('DROP TABLE sessions')
    const reply = await s.browser().call('auth/session', undefined, { headers: { cookie: `__Host-wl_ses=${'a'.repeat(43)}` } })
    expect(reply.status).toBe(503)
    expect(reply.body).toEqual({ code: 'storage' })
    expect(JSON.parse(s.logs.at(-1)!)).toMatchObject({ o: 'storage', s: 503 })
  })
})

describe('request guards, each violation alone', () => {
  const WRITES = ROUTES.filter((route) => route.name.startsWith('POST') || route.name.startsWith('PUT'))
  const hostileOrigins = [
    'https://weeklid.crexative.com.evil.test',
    'https://evil.test/https://weeklid.crexative.com',
    'null',
    'https://other.crexative.com',
    'https://next168.pages.dev',
    'http://weeklid.crexative.com',
    'https://weeklid.crexative.com:444',
  ]

  function body(route: Call): { call: (b: Browser, headers: Record<string, string | null>) => Promise<Reply> } {
    const path = route.name.split(' ')[1]!
    const payloads: Record<string, unknown> = {
      'auth/start': { consent: 1 }, 'auth/session': undefined, 'auth/signout': undefined, 'auth/delete': { accountKey: KEY },
      'sync': { accountKey: KEY, baseRevision: 0, epoch: 0, document: plan }, 'sync/replace': { accountKey: KEY, document: plan },
    }
    return { call: (b, headers) => b.call(path, payloads[path], { method: route.name.startsWith('PUT') ? 'PUT' : 'POST', headers }) }
  }

  for (const route of WRITES) {
    const { call } = body(route)
    it(`${route.name}: a request satisfying every guard gets past them`, async () => {
      const s = server()
      s.invite(ALICE.email)
      const reply = await call(s.browser(), {})
      expect([403, 404].includes(reply.status)).toBe(false)
      expectNoCors(reply)
    })

    it.each(hostileOrigins)(`${route.name}: Origin %s → 403`, async (origin) => {
      const s = server()
      const reply = await call(s.browser(), { origin })
      expect(reply.status).toBe(403)
      expect(reply.body).toEqual({ code: 'forbidden' })
      expect(s.storeCalls).toEqual([])
      expectNoCors(reply)
    })

    it(`${route.name}: a missing Origin → 403`, async () => {
      const s = server()
      expect((await call(s.browser(), { origin: null })).status).toBe(403)
      expect(s.storeCalls).toEqual([])
    })

    it(`${route.name}: a missing X-Weeklid → 403`, async () => {
      const s = server()
      expect((await call(s.browser(), { 'x-weeklid': null })).status).toBe(403)
      expect((await call(s.browser(), { 'x-weeklid': '0' })).status).toBe(403)
      expect(s.storeCalls).toEqual([])
    })

    it(`${route.name}: Sec-Fetch-Site cross-site or same-site → 403, absent is allowed`, async () => {
      const s = server()
      expect((await call(s.browser(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      expect((await call(s.browser(), { 'sec-fetch-site': 'same-site' })).status).toBe(403)
      expect(s.storeCalls).toEqual([])
      expect((await call(s.browser(), { 'sec-fetch-site': null })).status).not.toBe(403)
    })
  }

  it.each(['auth/start', 'auth/delete', 'sync', 'sync/replace'])('%s: a body that is not JSON-typed → 400', async (path) => {
    const s = server()
    const reply = await s.browser().call(path, undefined, {
      method: path.startsWith('sync') ? 'PUT' : 'POST', rawBody: '{}', headers: { 'content-type': 'text/plain' },
    })
    expect(reply.status).toBe(400)
    expect(s.storeCalls).toEqual([])
  })

  it('GET /api/sync: no X-Weeklid header, a cross-site fetch or a foreign Origin → 403', async () => {
    const s = server()
    const b = s.browser()
    expect((await b.getPlan(KEY, undefined, { headers: { 'x-weeklid': null } })).status).toBe(403)
    expect((await b.getPlan(KEY, undefined, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await b.getPlan(KEY, undefined, { headers: { origin: 'https://evil.test' } })).status).toBe(403)
    expect(s.storeCalls).toEqual([])
  })

  it('every reply carries no-store, nosniff and no referrer, and none carries CORS headers', async () => {
    const s = server()
    s.invite(BOB.email)
    const b = s.browser()
    for (const reply of [await b.call('auth/session'), await b.call('auth/start', { consent: 1 }), await b.getPlan(KEY)]) {
      expect(reply.headers.get('cache-control')).toBe('no-store')
      expect(reply.headers.get('x-content-type-options')).toBe('nosniff')
      expect(reply.headers.get('referrer-policy')).toBe('no-referrer')
      expectNoCors(reply)
    }
  })

  it('the sign-in redirect never reflects a request parameter', async () => {
    const s = server()
    const { reply } = await s.browser().callback({ state: 'https://evil.test/<script>', code: 'c', error: '<b>x</b>' }, { flow: 'y'.repeat(43) })
    expect(reply.status).toBe(303)
    expect(reply.headers.get('location')).toBe(`${APP}/?account=state#/settings/account`)
  })

  it('uses the Google client of the deployment and the sign-in redirect URI', async () => {
    const s = server()
    const { url } = await s.browser().start()
    expect(url.searchParams.get('client_id')).toBe(FAKE_ID.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/callback`)
  })
})
