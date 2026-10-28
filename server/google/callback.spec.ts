// @vitest-environment node
// S-4 (rejection, fixed redirect, no cookies), S-5 (success), S-6 (degraded and cancelled), and the commit half of S-12.
import { describe, expect, it } from 'vitest'
import { fromBase64, open, pkceAad, sha256b64url, tokenAad } from './crypto'
import { CALENDAR_SCOPE } from './googleOAuth'
import { APP, EPOCH_A, EPOCH_B, FAKE, TOKEN_KEY, id22, server, type TestServer } from './testing/harness'

const appTarget = (result: string): string => `${APP}/?google=${result}#/settings/calendars`
const key = fromBase64(TOKEN_KEY)!

function snapshot(s: TestServer): string {
  return JSON.stringify([s.db.rows('google_pending'), s.db.rows('google_credentials')])
}

describe('S-4 callback rejection: fixed redirect, zero Google calls, nothing written, no cookies', () => {
  async function rejected(s: TestServer, run: () => Promise<{ reply: { status: number; setCookies: string[] }; location: string }>): Promise<void> {
    const before = snapshot(s)
    const calls = s.google.calls.length
    const { reply, location } = await run()
    expect(reply.status).toBe(303)
    expect(location).toBe(appTarget('state'))
    expect(reply.setCookies).toEqual([])
    expect(s.google.calls.length).toBe(calls)
    expect(snapshot(s)).toBe(before)
  }

  it('a missing flow cookie → state', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    await rejected(s, () => browser.callback({ state, code: s.google.issueCode() }, { flow: null }))
  })

  it('a mismatched flow cookie → state', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    await rejected(s, () => browser.callback({ state, code: s.google.issueCode() }, { flow: `${state.slice(0, -1)}x` }))
  })

  it('a missing state → state', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    await rejected(s, () => browser.callback({ code: s.google.issueCode() }))
  })

  it('an unknown state, even with a matching flow cookie → state', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    const forged = 'f'.repeat(43)
    await rejected(s, () => browser.callback({ state: forged, code: s.google.issueCode() }, { flow: forged }))
  })

  it('a pending row 601 s old → state; 600 s old is still accepted', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    s.advance(601)
    await rejected(s, () => browser.callback({ state, code: s.google.issueCode() }))

    const fresh = server()
    const other = fresh.browser()
    const { state: freshState, challenge } = await other.connect()
    fresh.advance(600)
    expect((await other.callback({ state: freshState, code: fresh.google.issueCode({ challenge }) })).result).toBe('connected')
  })

  it('an already consumed state → state', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    expect((await browser.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('connected')
    await rejected(s, () => browser.callback({ state, code: s.google.issueCode({ challenge }) }))
  })

  it('hostile parameters never change Location', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    const hostile = { redirect: 'https://evil.test', return_to: 'https://evil.test', next: '//evil.test' }
    const unknown = await browser.callback({ state: `${state}#@evil.test`, code: 'x', ...hostile }, { flow: `${state}#@evil.test` })
    expect(unknown.location).toBe(appTarget('state'))
    const denied = await browser.callback({ state, error: 'access_denied', ...hostile, google: 'connected' })
    expect(denied.location).toBe(appTarget('denied'))
    for (const location of [unknown.location, denied.location]) expect(location).not.toContain('evil')
  })

  it('an exception → 303 error, never a 500', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    const code = s.google.issueCode({ challenge })
    s.deps.random = () => {
      throw new Error('boom')
    }
    const { reply, location } = await browser.callback({ state, code })
    expect(reply.status).toBe(303)
    expect(location).toBe(appTarget('error'))
    expect(reply.setCookies).toEqual([])
  })

  it('a D1 lookup error → storage', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    s.store.failNext('findPending')
    expect((await browser.callback({ state, code: 'c' })).location).toBe(appTarget('storage'))
    expect(s.google.calls).toEqual([])
  })

  it('the canary target is used only once a pending row says so', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect(EPOCH_A, 'canary')
    const done = await browser.callback({ state, error: 'access_denied' })
    expect(done.location).toBe(`${APP}/api/google/canary?google=denied`)
    const unknown = await browser.callback({ state, code: 'x' })
    expect(unknown.location).toBe(appTarget('state'))
  })
})

describe('S-5 callback success', () => {
  it('exchanges with the verifier, the secret and the exact redirect_uri; seals the token; removes the pending row', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect(EPOCH_A)
    const code = s.google.issueCode({ challenge })
    const { reply, location } = await browser.callback({ state, code })
    expect(location).toBe(appTarget('connected'))
    expect(reply.setCookies).toEqual([])

    const [exchange] = s.google.calls
    expect(exchange!.kind).toBe('exchange')
    expect(exchange!.form).toMatchObject({
      grant_type: 'authorization_code', code, client_id: FAKE.clientId, client_secret: FAKE.clientSecret, redirect_uri: `${APP}/api/google/callback`,
    })
    expect(await sha256b64url(exchange!.form.code_verifier!)).toBe(challenge)

    expect(s.db.rows('google_pending')).toEqual([])
    const [credential] = s.db.rows('google_credentials')
    const stored = JSON.stringify(credential)
    expect(stored).not.toContain(FAKE.refreshToken)
    expect(stored).not.toContain(Buffer.from(FAKE.refreshToken).toString('base64').slice(0, 12))
    const deviceHash = String(credential!.device_hash)
    const sealed = { iv: String(credential!.iv), ciphertext: String(credential!.ciphertext) }
    expect(await open(key, tokenAad(deviceHash), sealed)).toBe(FAKE.refreshToken)
    await expect(open(key, tokenAad(`${deviceHash}x`), sealed)).rejects.toThrow()
    await expect(open(key, pkceAad(deviceHash), sealed)).rejects.toThrow()
    expect(credential!.epoch).toBe(EPOCH_A)
  })

  it('two seals of the same token differ, and a reconnect gets a new connection id', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const [first] = s.db.rows('google_credentials')
    expect(await browser.consent({ epoch: EPOCH_B })).toBe('connected')
    const [second] = s.db.rows('google_credentials')
    expect(s.db.rows('google_credentials')).toHaveLength(1)
    expect(second!.device_hash).toBe(first!.device_hash)
    expect(second!.connection_id).not.toBe(first!.connection_id)
    expect(second!.iv).not.toBe(first!.iv)
    expect(second!.ciphertext).not.toBe(first!.ciphertext)
    expect(second!.epoch).toBe(EPOCH_B)
  })

  it('the commit sweeps each table by its own age: 191 days idle and 601 s pending go, 189 days and 300 s stay', async () => {
    const s = server()
    const now = Math.floor(s.clock.now / 1000)
    await s.browser().connect()
    const insertCredential = (device: string, lastUsed: number): void => {
      s.db.sqlite.prepare(`INSERT INTO google_credentials VALUES (?, ?, ?, 'k', 'iv', 'ct', ?, ?)`).run(device, id22(device), EPOCH_A, lastUsed, lastUsed)
    }
    const insertPending = (device: string, created: number): void => {
      s.db.sqlite.prepare(`INSERT INTO google_pending VALUES (?, ?, ?, 'v', 'k', ?, 'app', ?)`).run(device, id22(device), `state-${device}`, EPOCH_A, created)
    }
    insertCredential('idle191', now - 191 * 86_400)
    insertCredential('idle189', now - 189 * 86_400)
    insertPending('pend601', now - 601)
    insertPending('pend300', now - 300)
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const credentials = s.db.rows('google_credentials').map((row) => row.device_hash)
    const pending = s.db.rows('google_pending').map((row) => row.device_hash)
    expect(credentials).toContain('idle189')
    expect(credentials).not.toContain('idle191')
    expect(pending).toContain('pend300')
    expect(pending).not.toContain('pend601')
  })
})

describe('S-6 callback degraded and cancelled: zero revoke calls in every case', () => {
  it('access_denied with an existing credential → denied, credential unchanged, pending gone', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const credential = s.db.rows('google_credentials')
    const { state } = await browser.connect(EPOCH_B)
    expect((await browser.callback({ state, error: 'access_denied' })).result).toBe('denied')
    expect(s.db.rows('google_credentials')).toEqual(credential)
    expect(s.db.rows('google_pending')).toEqual([])
    expect(s.google.count('revoke')).toBe(0)
  })

  it('another Google error → auth, credential untouched', async () => {
    const s = server()
    const browser = s.browser()
    const { state } = await browser.connect()
    expect((await browser.callback({ state, error: 'server_error' })).result).toBe('auth')
    expect(s.google.calls).toEqual([])
  })

  it('no refresh token → noRefreshToken; a narrow scope → missingScope; nothing stored, pending gone', async () => {
    for (const [options, expected] of [
      [{ refreshToken: null }, 'noRefreshToken'],
      [{ scope: 'https://www.googleapis.com/auth/calendar.readonly.other' }, 'missingScope'],
      [{ scope: `openid ${CALENDAR_SCOPE}x` }, 'missingScope'],
    ] as const) {
      const s = server()
      expect(await s.browser().consent(options)).toBe(expected)
      expect(s.db.rows('google_credentials')).toEqual([])
      expect(s.db.rows('google_pending')).toEqual([])
      expect(s.google.count('revoke')).toBe(0)
    }
  })

  it('a scope list that includes the calendar scope among others connects', async () => {
    expect(await server().browser().consent({ scope: `openid ${CALENDAR_SCOPE} email` })).toBe('connected')
  })

  it('exchange 500, a hang, or 200 headers whose body times out → exchange; the pending row is kept until it expires', async () => {
    for (const scripted of [{ status: 500, body: { error: 'internal' } }, 'hang' as const, 'hangAfterHeaders' as const, { status: 400, body: { error: 'invalid_grant' } }]) {
      const s = server()
      const browser = s.browser()
      const { state } = await browser.connect()
      s.google.script('exchange', scripted)
      const { result } = await browser.callback({ state, code: s.google.issueCode() })
      expect(result).toBe('exchange')
      expect(s.db.rows('google_credentials')).toEqual([])
      expect(s.db.rows('google_pending')).toHaveLength(1)
      expect(s.google.count('revoke')).toBe(0)
    }
  })

  it('secret absent → canary, with zero exchange calls and the pending row consumed', async () => {
    const s = server({ GOOGLE_CLIENT_SECRET: undefined })
    const browser = s.browser()
    const { state } = await browser.connect(EPOCH_A, 'canary')
    const done = await browser.callback({ state, code: s.google.issueCode() })
    expect(done.location).toBe(`${APP}/api/google/canary?google=canary`)
    expect(s.google.calls).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
    expect(s.db.rows('google_credentials')).toEqual([])
  })

  it('pending deleted between lookup and commit → cancelled; the token is discarded, not revoked', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    const held = s.google.hold('exchange')
    const callback = browser.callback({ state, code: s.google.issueCode({ challenge }) })
    await held.reached
    const status = await browser.status()
    expect((await browser.disconnect(String(status.body!.gen))).body).toEqual({ result: 'none' })
    held.release()
    expect((await callback).result).toBe('cancelled')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.google.count('revoke')).toBe(0)
  })

  it('pending replaced by a newer connect between lookup and commit → cancelled, and the newer pending row survives', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect(EPOCH_A)
    const held = s.google.hold('exchange')
    const callback = browser.callback({ state, code: s.google.issueCode({ challenge }) }, { flow: state })
    await held.reached
    await browser.connect(EPOCH_B)
    const newer = s.db.rows('google_pending')
    held.release()
    expect((await callback).result).toBe('cancelled')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual(newer)
    expect(newer[0]!.epoch).toBe(EPOCH_B)
    expect(s.google.count('revoke')).toBe(0)
  })

  it("failNext('commit') → storage; the old credential is unchanged and the pending row kept (rolled back)", async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const old = s.db.rows('google_credentials')
    const { state, challenge } = await browser.connect(EPOCH_B)
    s.store.failNext('commit')
    expect((await browser.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('storage')
    expect(s.db.rows('google_credentials')).toEqual(old)
    expect(s.db.rows('google_pending')).toHaveLength(1)
    expect(s.google.count('revoke')).toBe(0)
  })

  it('a batch whose second statement fails rolls back the credential insert (one transaction)', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    s.db.sqlite.exec(`CREATE TRIGGER fail_pending_delete BEFORE DELETE ON google_pending BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    expect((await browser.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('storage')
    expect(s.db.rows('google_credentials')).toEqual([])
  })
})

describe('S-12 epoch binding at commit', () => {
  it("the commit copies the pending row's epoch into the credential", async () => {
    const s = server()
    expect(await s.browser().consent({ epoch: EPOCH_B })).toBe('connected')
    expect(s.db.rows('google_credentials')[0]!.epoch).toBe(EPOCH_B)
  })

  it('the epoch committed is the one of the pending row the callback consumed, not of a newer connect elsewhere', async () => {
    const s = server()
    const a = s.browser()
    const b = s.browser()
    const { state, challenge } = await a.connect(EPOCH_A)
    await b.connect(EPOCH_B)
    expect((await a.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('connected')
    const [credential] = s.db.rows('google_credentials')
    expect(credential!.epoch).toBe(EPOCH_A)
    expect(s.db.rows('google_pending')).toHaveLength(1)
  })
})
