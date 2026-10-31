// @vitest-environment node
// S-7 (token, including the redteam2 interleavings) and the mint half of S-12.
import { describe, expect, it } from 'vitest'
import { DEVICE_COOKIE } from './handlers'
import { EPOCH_A, EPOCH_B, FAKE, OTHER_TOKEN_KEY, id22, server, type TestServer } from './testing/harness'

async function connected(s: TestServer, epoch = EPOCH_A) {
  const browser = s.browser()
  expect(await browser.consent({ epoch })).toBe('connected')
  return browser
}

const lastUsed = (s: TestServer): number => Number(s.db.rows('google_credentials')[0]!.last_used_at)

describe('S-7 token', () => {
  it('(a) success → 200 with the access token, no-store, no Set-Cookie, last_used_at advanced', async () => {
    const s = server()
    const browser = await connected(s)
    const before = lastUsed(s)
    s.advance(3600)
    const reply = await browser.mint()
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ accessToken: FAKE.accessToken, expiresIn: 3599, epoch: EPOCH_A, pending: false })
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff')
    expect(reply.headers.get('referrer-policy')).toBe('no-referrer')
    expect(reply.setCookies).toEqual([])
    expect(lastUsed(s)).toBe(before + 3600)
    const [refresh] = s.google.calls.filter((call) => call.kind === 'refresh')
    expect(refresh!.form).toEqual({ grant_type: 'refresh_token', refresh_token: FAKE.refreshToken, client_id: FAKE.clientId, client_secret: FAKE.clientSecret })
  })

  it('(b) a held refresh released with a rotated token after the credential was deleted and recommitted leaves the new credential unchanged', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.rotateNextTo = 'rt-SECRET-rotated'
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    const status = await browser.status()
    expect((await browser.disconnect(String(status.body!.gen), false)).body).toEqual({ result: 'forgotten' })
    expect(await browser.consent({ epoch: EPOCH_B, refreshToken: 'rt-SECRET-second' })).toBe('connected')
    const recommitted = s.db.rows('google_credentials')
    held.release()
    expect((await mint).status).toBe(200)
    expect(s.db.rows('google_credentials')).toEqual(recommitted)
  })

  it('(b) after a plain delete, the held rotated refresh recreates no row', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.rotateNextTo = 'rt-SECRET-rotated'
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    const status = await browser.status()
    await browser.disconnect(String(status.body!.gen), false)
    held.release()
    await mint
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
  })

  it('(c) M2: a held invalid_grant for C1 deletes C1 only; the newer pending P2 survives and then commits', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.validRefreshTokens.clear()
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    const { state, challenge } = await browser.connect(EPOCH_B)
    const p2 = s.db.rows('google_pending')
    held.release()
    expect((await mint).body).toEqual({ code: 'reconnect' })
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual(p2)
    expect((await browser.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('connected')
    expect(s.db.rows('google_credentials')[0]!.epoch).toBe(EPOCH_B)
  })

  it('(c) a held invalid_grant for C1 released after C2 was committed for the same device deletes nothing', async () => {
    const s = server()
    const browser = await connected(s)
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    expect(await browser.consent({ epoch: EPOCH_B, refreshToken: 'rt-SECRET-second' })).toBe('connected')
    const c2 = s.db.rows('google_credentials')
    s.google.validRefreshTokens.delete(FAKE.refreshToken)
    held.release()
    expect((await mint).body).toEqual({ code: 'reconnect' })
    expect(s.db.rows('google_credentials')).toEqual(c2)
    expect((await browser.mint()).body).toMatchObject({ epoch: EPOCH_B })
  })

  it('(d) a credential idle 189 days survives a sweep', async () => {
    const s = server()
    await connected(s)
    s.advance(189 * 86_400)
    const other = await connected(s)
    expect((await other.mint()).status).toBe(200)
    expect(s.db.rows('google_credentials')).toHaveLength(2)
  })

  it('(d) M2: a credential idle past 190 days is swept, and the fresh pending row of the same device is kept', async () => {
    const s = server()
    const browser = await connected(s)
    const idleDevice = s.db.rows('google_credentials')[0]!.device_hash
    s.advance(190 * 86_400 + 1)
    await browser.connect(EPOCH_B)
    const other = await connected(s)
    expect((await other.mint()).status).toBe(200)
    const pending = s.db.rows('google_pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.device_hash).toBe(idleDevice)
    expect(pending[0]!.epoch).toBe(EPOCH_B)
    expect(s.db.rows('google_credentials').map((row) => row.device_hash)).not.toContain(idleDevice)
  })

  it('(e) an unknown or malformed cookie → noDevice, zero fetch', async () => {
    for (const jar of [new Map<string, string>(), new Map([['wl_dev', 'x'.repeat(43)]]), new Map([[DEVICE_COOKIE, 'short']])]) {
      const s = server()
      const browser = s.browser()
      for (const [name, value] of jar) browser.jar.set(name, value)
      const reply = await browser.mint()
      expect(reply.status).toBe(401)
      expect(reply.body).toEqual({ code: 'noDevice' })
      expect(s.google.calls).toEqual([])
    }
  })

  it('(e) a cookie without a credential → notConnected, zero fetch', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    const reply = await browser.mint()
    expect(reply.status).toBe(401)
    expect(reply.body).toEqual({ code: 'notConnected' })
    expect(s.google.calls).toEqual([])
  })

  it('(e) a key_id mismatch → reconnect, row kept, zero fetch', async () => {
    const s = server()
    const browser = await connected(s)
    const rows = s.db.rows('google_credentials')
    const rotated = server({ GOOGLE_TOKEN_KEY: OTHER_TOKEN_KEY, DB: s.db })
    const moved = rotated.browser()
    moved.jar.set(DEVICE_COOKIE, browser.deviceId!)
    const reply = await moved.mint()
    expect(reply.status).toBe(401)
    expect(reply.body).toEqual({ code: 'reconnect' })
    expect(s.db.rows('google_credentials')).toEqual(rows)
    expect(rotated.google.calls).toEqual([])
  })

  it('(e) a ciphertext that does not open → reconnect, row kept, zero fetch', async () => {
    const s = server()
    const browser = await connected(s)
    s.db.sqlite.exec(`UPDATE google_credentials SET ciphertext = 'AAAA' || substr(ciphertext, 5)`)
    const rows = s.db.rows('google_credentials')
    const calls = s.google.calls.length
    expect((await browser.mint()).body).toEqual({ code: 'reconnect' })
    expect(s.db.rows('google_credentials')).toEqual(rows)
    expect(s.google.calls.length).toBe(calls)
  })

  it('(e) invalid_client or unauthorized_client → 503 serverConfig, row kept', async () => {
    for (const error of ['invalid_client', 'unauthorized_client']) {
      const s = server()
      const browser = await connected(s)
      const rows = s.db.rows('google_credentials')
      s.google.script('refresh', { status: 401, body: { error } })
      const reply = await browser.mint()
      expect(reply.status).toBe(503)
      expect(reply.body).toEqual({ code: 'serverConfig' })
      expect(s.db.rows('google_credentials')).toEqual(rows)
    }
  })

  it('(e) a Google 500, a hang or a network error → 502 googleUnavailable, row kept', async () => {
    for (const scripted of [{ status: 500 }, 'hang' as const, { status: 503, body: { error: 'backend' } }]) {
      const s = server()
      const browser = await connected(s)
      const rows = s.db.rows('google_credentials')
      s.google.script('refresh', scripted)
      const reply = await browser.mint()
      expect(reply.status).toBe(502)
      expect(reply.body).toEqual({ code: 'googleUnavailable' })
      expect(s.db.rows('google_credentials')).toEqual(rows)
    }
  })

  it('(e) 200 headers whose body times out → 502 googleUnavailable with the timeout class, row kept', async () => {
    const s = server()
    const browser = await connected(s)
    const rows = s.db.rows('google_credentials')
    s.google.script('refresh', 'hangAfterHeaders')
    const reply = await browser.mint()
    expect(reply.status).toBe(502)
    expect(reply.body).toEqual({ code: 'googleUnavailable' })
    expect(JSON.parse(s.logs.at(-1)!)).toMatchObject({ r: 'token', o: 'googleUnavailable', e: 'TimeoutError' })
    expect(s.db.rows('google_credentials')).toEqual(rows)
  })

  it('(e) the secret absent → 503 notConfigured, zero fetch (canary mode)', async () => {
    const s = server()
    const browser = await connected(s)
    const canary = server({ GOOGLE_CLIENT_SECRET: undefined, DB: s.db })
    const moved = canary.browser()
    moved.jar.set(DEVICE_COOKIE, browser.deviceId!)
    expect((await moved.mint()).body).toEqual({ code: 'notConfigured' })
    expect(canary.google.calls).toEqual([])
  })

  it('a refresh that comes back without the calendar scope → reconnect', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.script('refresh', { status: 200, body: { access_token: FAKE.accessToken, expires_in: 3599, scope: 'openid' } })
    expect((await browser.mint()).body).toEqual({ code: 'reconnect' })
  })

  it('invalid_grant deletes the credential: reconnect, then notConnected', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.validRefreshTokens.clear()
    expect((await browser.mint()).body).toEqual({ code: 'reconnect' })
    expect(s.db.rows('google_credentials')).toEqual([])
    expect((await browser.mint()).body).toEqual({ code: 'notConnected' })
  })

  it('(f) m2: the rotate write fails and Google invalidates the predecessor → this mint 200, the next reconnect', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.rotateNextTo = 'rt-SECRET-rotated'
    s.google.invalidatePredecessorOnRotate = true
    s.store.failNext('rotate')
    expect((await browser.mint()).status).toBe(200)
    expect((await browser.mint()).body).toEqual({ code: 'reconnect' })
  })

  it('a successful rotation is stored sealed and used by the next mint', async () => {
    const s = server()
    const browser = await connected(s)
    s.google.rotateNextTo = 'rt-SECRET-rotated'
    s.google.invalidatePredecessorOnRotate = true
    expect((await browser.mint()).status).toBe(200)
    expect(JSON.stringify(s.db.rows('google_credentials'))).not.toContain('rt-SECRET-rotated')
    expect((await browser.mint()).status).toBe(200)
    expect(s.google.calls.filter((c) => c.kind === 'refresh').at(-1)!.form.refresh_token).toBe('rt-SECRET-rotated')
  })

  it("(g) failNext('touch') → 200; a failed sweep → 200", async () => {
    const s = server()
    const browser = await connected(s)
    s.store.failNext('touch')
    expect((await browser.mint()).status).toBe(200)
    s.store.failNext('sweep')
    expect((await browser.mint()).status).toBe(200)
  })

  it('a D1 read error → 503 storage, zero fetch', async () => {
    const s = server()
    const browser = await connected(s)
    const calls = s.google.calls.length
    s.store.failNext('mintRead')
    expect((await browser.mint()).body).toEqual({ code: 'storage' })
    expect(s.google.calls.length).toBe(calls)
  })
})

describe('S-12 mint epoch and pending', () => {
  it("returns the credential's epoch, not a newer pending row's", async () => {
    const s = server()
    const browser = await connected(s, EPOCH_A)
    await browser.connect(EPOCH_B)
    expect((await browser.mint()).body).toMatchObject({ epoch: EPOCH_A, pending: true })
  })

  it('pending is true only while an unexpired pending row exists for this device', async () => {
    const s = server()
    const browser = await connected(s, EPOCH_A)
    expect((await browser.mint()).body).toMatchObject({ pending: false })

    // Denial ends it.
    const denied = await browser.connect(EPOCH_B)
    expect((await browser.mint()).body).toMatchObject({ pending: true })
    await browser.callback({ state: denied.state, error: 'access_denied' })
    expect((await browser.mint()).body).toMatchObject({ epoch: EPOCH_A, pending: false })

    // Supersession then commit ends it.
    await browser.connect(EPOCH_B)
    const newest = await browser.connect(EPOCH_A.replace(/A/g, 'C'))
    expect((await browser.callback({ state: newest.state, code: s.google.issueCode({ challenge: newest.challenge }) })).result).toBe('connected')
    expect((await browser.mint()).body).toMatchObject({ epoch: EPOCH_A.replace(/A/g, 'C'), pending: false })

    // Expiry ends it: 600 s still counts, 601 s does not.
    await browser.connect(EPOCH_B)
    s.advance(600)
    expect((await browser.mint()).body).toMatchObject({ pending: true })
    s.advance(1)
    expect((await browser.mint()).body).toMatchObject({ pending: false })

    // Disconnect of the full generation ends it.
    await browser.connect(EPOCH_B)
    const gen = String((await browser.status()).body!.gen)
    expect(gen).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/)
    await browser.disconnect(gen, false)
    expect((await browser.mint()).body).toEqual({ code: 'notConnected' })
  })

  it("another device's pending row does not count", async () => {
    const s = server()
    const browser = await connected(s)
    s.db.sqlite.prepare(`INSERT INTO google_pending VALUES ('other', ?, 'st', 'v', 'k', ?, 'app', ?)`).run(id22('p'), EPOCH_B, Math.floor(s.clock.now / 1000))
    expect((await browser.mint()).body).toMatchObject({ pending: false })
  })
})
