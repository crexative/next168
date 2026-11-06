// @vitest-environment node
// A-2: the client parser accepts the real replies of every route and outcome of the S1a handlers, and maps them to its
// closed results. A-13 (node half): `/token` tells a lost cookie from a missing credential.
import { describe, expect, it } from 'vitest'
import { DEVICE_COOKIE } from './handlers'
import { clientFor } from './testing/clientBridge'
import { EPOCH_B, FAKE, OTHER_TOKEN_KEY, server, type Browser, type TestServer } from './testing/harness'

async function connected(s: TestServer): Promise<Browser> {
  const browser = s.browser()
  expect(await browser.consent()).toBe('connected')
  return browser
}

describe('A-2 /connect', () => {
  it('a real 200 → the Google address', async () => {
    const s = server()
    const result = await clientFor(s.browser()).connection.connect()
    expect(result.kind).toBe('url')
    expect(result.kind === 'url' && new URL(result.url).hostname).toBe('accounts.google.com')
  })

  it.each([
    ['the switch off', { GOOGLE_SERVER_ENABLED: undefined }, 'paused', 'disabled'],
    ['no token key', { GOOGLE_TOKEN_KEY: undefined }, 'paused', 'notConfigured'],
    ['a foreign host', {}, 'unavailable', 'notFound'],
  ] as const)('%s → %s %s', async (_, env, kind, code) => {
    const s = server(env)
    const foreign = _ === 'a foreign host'
    const result = await clientFor(s.browser(), foreign ? { origin: 'https://next168.pages.dev' } : {}).connection.connect()
    expect(result).toMatchObject({ kind, code })
  })

  it('a storage failure → unavailable storage', async () => {
    const s = server()
    s.store.failNext('upsertPending')
    expect(await clientFor(s.browser()).connection.connect()).toEqual({ kind: 'unavailable', code: 'storage' })
  })
})

describe('A-2 /token', () => {
  it('a real 200 → a token with its lifetime', async () => {
    const s = server()
    const browser = await connected(s)
    expect(await clientFor(browser).connection.mint()).toEqual({ kind: 'token', accessToken: FAKE.accessToken, expiresIn: 3599 })
  })

  it('no cookie → noDevice; a cookie with no credential → notConnected', async () => {
    const s = server()
    expect(await clientFor(s.browser()).connection.mint()).toEqual({ kind: 'signedOut', code: 'noDevice' })
    const stranger = s.browser()
    stranger.jar.set(DEVICE_COOKIE, 'A'.repeat(43))
    expect(await clientFor(stranger).connection.mint()).toEqual({ kind: 'signedOut', code: 'notConnected' })
  })

  it('a credential under another key, and a Google refusal → reconnect', async () => {
    const s = server()
    const browser = await connected(s)
    const rekeyed = server({ GOOGLE_TOKEN_KEY: OTHER_TOKEN_KEY, DB: s.db })
    const moved = rekeyed.browser()
    moved.jar.set(DEVICE_COOKIE, browser.deviceId!)
    expect(await clientFor(moved).connection.mint()).toEqual({ kind: 'signedOut', code: 'reconnect' })
    s.google.script('refresh', { status: 400, body: { error: 'invalid_grant' } })
    expect(await clientFor(browser).connection.mint()).toEqual({ kind: 'signedOut', code: 'reconnect' })
  })

  it.each([
    ['the switch off', { GOOGLE_SERVER_ENABLED: undefined }, { kind: 'paused', code: 'disabled' }],
    ['no secret', { GOOGLE_CLIENT_SECRET: undefined }, { kind: 'paused', code: 'notConfigured' }],
  ] as const)('%s → paused', async (_, env, expected) => {
    const s = server()
    const browser = await connected(s)
    const other = server({ ...env, DB: s.db })
    const moved = other.browser()
    moved.jar.set(DEVICE_COOKIE, browser.deviceId!)
    expect(await clientFor(moved).connection.mint()).toEqual(expected)
  })

  it('Google unavailable, a rejected client and a storage failure → unavailable with the server code', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.script('refresh', { status: 503 })
    expect(await clientFor(browser).connection.mint()).toEqual({ kind: 'unavailable', code: 'googleUnavailable' })
    s.google.script('refresh', { status: 401, body: { error: 'invalid_client' } })
    expect(await clientFor(browser).connection.mint()).toEqual({ kind: 'unavailable', code: 'serverConfig' })
    s.store.failNext('mintRead')
    expect(await clientFor(browser).connection.mint()).toEqual({ kind: 'unavailable', code: 'storage' })
  })
})

describe('A-2 /status and /disconnect through forgetThisDevice', () => {
  it('a credential, revoke:true → confirmed or unconfirmed; the credential is gone', async () => {
    for (const [scripted, expected] of [[undefined, 'confirmed'], [{ status: 503 }, 'unconfirmed']] as const) {
      const s = server()
      const browser = await connected(s)
      if (scripted) s.google.script('revoke', scripted)
      expect(await clientFor(browser).connection.forgetThisDevice(true)).toBe(expected)
      expect(s.db.rows('google_credentials')).toEqual([])
    }
  })

  it('a credential, revoke:false → forgotten, with no revoke call', async () => {
    const s = server()
    const browser = await connected(s)
    expect(await clientFor(browser).connection.forgetThisDevice(false)).toBe('forgotten')
    expect(s.google.count('revoke')).toBe(0)
  })

  it('a stale generation is retried once with the answer: a newer pending row is removed with the credential', async () => {
    const s = server()
    const browser = await connected(s)
    const held = s.store.hold('disconnect')
    const forgetting = clientFor(browser).connection.forgetThisDevice(true)
    await held.reached
    await browser.connect()
    held.release()
    expect(await forgetting).toBe('confirmed')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
  })

  it('a second stale answer is not terminal: failed, and the credential stays', async () => {
    const s = server()
    const browser = await connected(s)
    const first = s.store.hold('disconnect')
    const second = s.store.hold('disconnect')
    const forgetting = clientFor(browser).connection.forgetThisDevice(true)
    await first.reached
    await browser.connect()
    first.release()
    await second.reached
    await browser.connect(EPOCH_B)
    second.release()
    expect(await forgetting).toBe('failed')
    expect(s.db.rows('google_credentials')).toHaveLength(1)
  })

  it('a cookie with no credential → cleared (notConnected); no cookie → mayRemain (noDevice)', async () => {
    const s = server()
    const stranger = s.browser()
    stranger.jar.set(DEVICE_COOKIE, 'B'.repeat(43))
    expect(await clientFor(stranger).connection.forgetThisDevice(true)).toBe('cleared')
    expect(await clientFor(s.browser()).connection.forgetThisDevice(true)).toBe('mayRemain')
    expect(await clientFor(s.browser()).connection.forgetThisDevice(false)).toBe('mayRemain')
  })

  it('a storage failure at /status or /disconnect → failed', async () => {
    const s = server()
    const browser = await connected(s)
    s.store.failNext('status')
    expect(await clientFor(browser).connection.forgetThisDevice(true)).toBe('failed')
    s.store.failNext('disconnect')
    expect(await clientFor(browser).connection.forgetThisDevice(true)).toBe('failed')
    expect(s.db.rows('google_credentials')).toHaveLength(1)
  })
})

describe('A-3 without navigator.locks nothing is sent', () => {
  it('every call answers lockUnavailable and the server sees no request', async () => {
    const s = server()
    const bridge = clientFor(s.browser(), { locks: false })
    expect(await bridge.connection.mint()).toEqual({ kind: 'unavailable', code: 'lockUnavailable' })
    expect(await bridge.connection.connect()).toEqual({ kind: 'unavailable', code: 'lockUnavailable' })
    expect(await bridge.connection.forgetThisDevice(true)).toBe('failed')
    expect(bridge.paths).toEqual([])
    expect(s.requests).toBe(0)
  })
})
