// @vitest-environment node
// S-1 (guards, each alone) and S-2 (configuration).
import { describe, expect, it, vi } from 'vitest'
import { onRequestGet as canaryPage } from '../../functions/api/google/canary/index'
import { onRequestGet as canaryScript } from '../../functions/api/google/canary/script'
import { readConfig } from './config'
import { APP, EPOCH_A, FAKE, OTHER_TOKEN_KEY, TOKEN_KEY, server, type Reply } from './testing/harness'

type Route = 'connect' | 'token' | 'status' | 'disconnect'
const ROUTES: Route[] = ['connect', 'token', 'status', 'disconnect']
const validBody: Record<Route, unknown> = {
  connect: { from: 'app', epoch: EPOCH_A },
  token: undefined,
  status: undefined,
  disconnect: { revoke: true, gen: '-.-' },
}

function expectNoCors(reply: Reply): void {
  for (const [name] of reply.headers) expect(name.toLowerCase().startsWith('access-control-'), name).toBe(false)
}

function expectUntouched(s: ReturnType<typeof server>): void {
  expect(s.store.calls).toEqual([])
  expect(s.google.calls).toEqual([])
}

describe('S-1 guards, each violation alone', () => {
  it.each(ROUTES)('%s: a request satisfying every guard gets past them', async (route) => {
    const reply = await server().browser().post(route, validBody[route])
    expect([403, 404, 503].includes(reply.status) && ['forbidden', 'notFound', 'disabled'].includes(String(reply.body?.code))).toBe(false)
    expectNoCors(reply)
  })

  const hostileOrigins = [
    'https://weeklid.crexative.com.evil.test',
    'https://evil.test/https://weeklid.crexative.com',
    'null',
    'https://other.crexative.com',
    'https://next168.pages.dev',
    'http://weeklid.crexative.com',
    'https://weeklid.crexative.com:444',
  ]
  for (const route of ROUTES) {
    it.each(hostileOrigins)(`${route}: Origin %s → 403`, async (origin) => {
      const s = server()
      const reply = await s.browser().post(route, validBody[route], { headers: { origin } })
      expect(reply.status).toBe(403)
      expect(reply.body).toEqual({ code: 'forbidden' })
      expectNoCors(reply)
      expectUntouched(s)
    })

    it(`${route}: a missing Origin → 403`, async () => {
      const s = server()
      expect((await s.browser().post(route, validBody[route], { headers: { origin: null } })).status).toBe(403)
      expectUntouched(s)
    })

    it(`${route}: a missing X-Weeklid header → 403`, async () => {
      const s = server()
      const reply = await s.browser().post(route, validBody[route], { headers: { 'x-weeklid': null } })
      expect(reply.status).toBe(403)
      expectUntouched(s)
    })

    it(`${route}: X-Weeklid other than 1 → 403`, async () => {
      const s = server()
      expect((await s.browser().post(route, validBody[route], { headers: { 'x-weeklid': 'true' } })).status).toBe(403)
      expectUntouched(s)
    })

    it.each(['cross-site', 'same-site', 'none'])(`${route}: Sec-Fetch-Site %s → 403`, async (site) => {
      const s = server()
      const reply = await s.browser().post(route, validBody[route], { headers: { 'sec-fetch-site': site } })
      expect(reply.status).toBe(403)
      expectNoCors(reply)
      expectUntouched(s)
    })

    it(`${route}: without Sec-Fetch-Site (older browsers) the other guards decide`, async () => {
      const reply = await server().browser().post(route, validBody[route], { headers: { 'sec-fetch-site': null } })
      expect(reply.status).not.toBe(403)
    })

    it.each(['https://next168.pages.dev', 'https://evil.test', 'https://weeklid.crexative.com:8443'])(`${route}: request host %s ≠ APP_ORIGIN → 404`, async (host) => {
      const s = server()
      const reply = await s.browser().post(route, validBody[route], { url: `${host}/api/google/${route}` })
      expect(reply.status).toBe(404)
      expect(reply.body).toEqual({ code: 'notFound' })
      expectUntouched(s)
    })

    it(`${route}: GOOGLE_SERVER_ENABLED unset → 503 disabled`, async () => {
      for (const enabled of [undefined, '', '0', 'true', 'yes']) {
        const s = server({ GOOGLE_SERVER_ENABLED: enabled })
        const reply = await s.browser().post(route, validBody[route])
        expect(reply.status).toBe(503)
        expect(reply.body).toEqual({ code: 'disabled' })
        expectUntouched(s)
      }
    })

    it(`${route}: APP_ORIGIN unset or not a bare HTTPS origin → 404 (dormant)`, async () => {
      for (const appOrigin of [undefined, '', 'http://weeklid.crexative.com', `${APP}/`, `${APP}/app`]) {
        const s = server({ APP_ORIGIN: appOrigin })
        expect((await s.browser().post(route, validBody[route])).status).toBe(404)
        expectUntouched(s)
      }
    })
  }

  it.each([null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx'])(
    'disconnect with Content-Type %s → 400', async (type) => {
      const s = server()
      const reply = await s.browser().post('disconnect', validBody.disconnect, { headers: { 'content-type': type } })
      expect(reply.status).toBe(400)
      expect(reply.body).toEqual({ code: 'badRequest' })
      expectUntouched(s)
    })

  it('disconnect accepts application/json with a charset', async () => {
    const reply = await server().browser().post('disconnect', validBody.disconnect, { headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(reply.status).toBe(200)
  })

  it('the callback is dormant too: 404 for a foreign host, the disabled result without the switch, and no Google call', async () => {
    const off = server({ GOOGLE_SERVER_ENABLED: undefined })
    const disabled = await off.browser().callback({ state: 's', code: 'c' }, { flow: 's' })
    expect(disabled.reply.status).toBe(303)
    expect(disabled.location).toBe(`${APP}/?google=disabled#/settings/calendars`)
    expectUntouched(off)

    const foreign = server()
    const notFound = await foreign.browser().callback({ state: 's', code: 'c' }, { flow: 's', url: 'https://next168.pages.dev/api/google/callback?state=s&code=c' })
    expect(notFound.reply.status).toBe(404)
    expectUntouched(foreign)
  })

  it('the canary page and script: 404 for a foreign host, 503 disabled without the switch, no CORS', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const env = { APP_ORIGIN: APP, GOOGLE_SERVER_ENABLED: '1' }
    for (const route of [canaryPage, canaryScript]) {
      const path = route === canaryPage ? '/api/google/canary' : '/api/google/canary/script'
      const ok = await route({ request: new Request(`${APP}${path}`), env })
      expect(ok.status).toBe(200)
      const off = await route({ request: new Request(`${APP}${path}`), env: { APP_ORIGIN: APP } })
      expect(off.status).toBe(503)
      expect(await off.json()).toEqual({ code: 'disabled' })
      const foreign = await route({ request: new Request(`https://next168.pages.dev${path}`), env })
      expect(foreign.status).toBe(404)
      for (const response of [ok, off, foreign]) for (const [name] of response.headers) expect(name.startsWith('access-control-')).toBe(false)
    }
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)).o)).toEqual(['ok', 'disabled', 'notFound', 'ok', 'disabled', 'notFound'])
    log.mockRestore()
  })
})

describe('S-2 configuration', () => {
  const baseItems = ['VITE_GOOGLE_CLIENT_ID', 'GOOGLE_TOKEN_KEY', 'DB'] as const

  for (const route of ROUTES) {
    it.each(baseItems)(`${route}: missing %s → 503 notConfigured, zero fetch`, async (item) => {
      const s = item === 'DB' ? server({}, { withoutDb: true }) : server({ [item]: undefined })
      const reply = await s.browser().post(route, validBody[route])
      expect(reply.status).toBe(503)
      expect(reply.body).toEqual({ code: 'notConfigured' })
      expectUntouched(s)
    })
  }

  it('the client ID falls back to GOOGLE_CLIENT_ID; a malformed one is not configured', () => {
    expect(readConfig({ ...validEnv(), VITE_GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_ID: FAKE.clientId }).base?.clientId).toBe(FAKE.clientId)
    expect(readConfig({ ...validEnv(), VITE_GOOGLE_CLIENT_ID: 'not-a-client-id' }).base).toBeNull()
  })

  it.each([31, 33, 16, 0])('a %i-byte GOOGLE_TOKEN_KEY → notConfigured', async (length) => {
    const key = Buffer.alloc(length, 9).toString('base64')
    const s = server({ GOOGLE_TOKEN_KEY: key })
    const reply = await s.browser().post('connect', validBody.connect)
    expect(reply.body).toEqual({ code: 'notConfigured' })
    expectUntouched(s)
  })

  it('accepts a 32-byte key in standard (openssl rand -base64 32) or URL-safe base64, and rejects garbage', () => {
    expect(readConfig(validEnv()).base?.tokenKey.length).toBe(32)
    expect(readConfig({ ...validEnv(), GOOGLE_TOKEN_KEY: OTHER_TOKEN_KEY.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }).base?.tokenKey.length).toBe(32)
    expect(readConfig({ ...validEnv(), GOOGLE_TOKEN_KEY: 'not base64 at all!' }).base).toBeNull()
  })

  it.each(['https://evil.example', 'http://127.0.0.1:9', 'https://accounts.google-fake.test', 'http://a.test:4443', 'https://a.test:4443/path'])(
    'the OAuth origin override %s is ignored: Google stays Google', async (override) => {
      const s = server({ GOOGLE_OAUTH_TEST_ORIGIN: override })
      expect(s.deps.config.googleOrigin).toBeNull()
      const { url } = await s.browser().connect()
      expect(url.origin).toBe('https://accounts.google.com')
    })

  it('a .test origin override is honoured (the e2e harness)', async () => {
    const s = server({ GOOGLE_OAUTH_TEST_ORIGIN: 'https://accounts.google-fake.test:4443' })
    const { url } = await s.browser().connect()
    expect(url.origin).toBe('https://accounts.google-fake.test:4443')
  })

  it('GOOGLE_TEST_FAULT is ignored without a valid .test origin', () => {
    expect(readConfig({ ...validEnv(), GOOGLE_TEST_FAULT: 'disconnect' }).testFault).toBeNull()
    expect(readConfig({ ...validEnv(), GOOGLE_TEST_FAULT: 'disconnect', GOOGLE_OAUTH_TEST_ORIGIN: 'https://evil.example' }).testFault).toBeNull()
    expect(readConfig({ ...validEnv(), GOOGLE_TEST_FAULT: 'disconnect', GOOGLE_OAUTH_TEST_ORIGIN: 'https://accounts.google-fake.test:4443' }).testFault).toBe('disconnect')
    expect(readConfig({ ...validEnv(), GOOGLE_TEST_FAULT: 'other', GOOGLE_OAUTH_TEST_ORIGIN: 'https://accounts.google-fake.test:4443' }).testFault).toBeNull()
  })
})

function validEnv() {
  return { APP_ORIGIN: APP, VITE_GOOGLE_CLIENT_ID: FAKE.clientId, GOOGLE_TOKEN_KEY: TOKEN_KEY, GOOGLE_SERVER_ENABLED: '1', DB: server().db }
}
