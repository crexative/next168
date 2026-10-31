// @vitest-environment node
// S-3 (connect) and the /connect half of S-12 (epoch binding).
import { describe, expect, it } from 'vitest'
import { sha256b64url } from './crypto'
import { CALENDAR_SCOPE } from './googleOAuth'
import { PENDING_TTL_S } from './handlers'
import { APP, EPOCH_A, EPOCH_B, FAKE, server, type Reply } from './testing/harness'

const DEVICE_COOKIE = /^__Host-wl_dev=([A-Za-z0-9_-]{43}); Max-Age=34560000; Path=\/; Secure; HttpOnly; SameSite=Strict$/
const FLOW_COOKIE = /^__Host-wl_gflow=([A-Za-z0-9_-]{43}); Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/
const deviceIdOf = (reply: Reply): string | undefined =>
  DEVICE_COOKIE.exec(reply.setCookies.find((c) => c.startsWith('__Host-wl_dev=')) ?? '')?.[1]

describe('S-3 connect', () => {
  it('returns an authorization URL with exactly the D5 parameters', async () => {
    const { url, state, challenge } = await server().browser().connect()
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['access_type', 'client_id', 'code_challenge', 'code_challenge_method', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state'],
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: FAKE.clientId,
      redirect_uri: `${APP}/api/google/callback`,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('sets the device cookie (Strict) and the flow cookie (Lax, 600 s) with the D4/D5 attributes', async () => {
    const { reply, state } = await server().browser().connect()
    expect(reply.setCookies).toHaveLength(2)
    expect(reply.setCookies.find((c) => c.startsWith('__Host-wl_dev='))).toMatch(DEVICE_COOKIE)
    const flow = reply.setCookies.find((c) => c.startsWith('__Host-wl_gflow='))
    expect(flow).toMatch(FLOW_COOKIE)
    expect(FLOW_COOKIE.exec(flow!)![1]).toBe(state)
    expect(reply.headers.get('cache-control')).toBe('no-store')
  })

  it('a connected device keeps its id on reconnect, and only its hash is stored', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const id = browser.deviceId!
    const second = await browser.connect(EPOCH_B)
    expect(deviceIdOf(second.reply)).toBe(id)
    const rows = s.db.rows('google_pending')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.device_hash).toBe(s.db.rows('google_credentials')[0]!.device_hash)
    expect(JSON.stringify(rows)).not.toContain(id)
  })

  it('a planted well-formed device id with no credential is discarded: a new id, and the pending row under its hash', async () => {
    const s = server()
    const browser = s.browser()
    const planted = 'P'.repeat(43)
    browser.jar.set('__Host-wl_dev', planted)
    const { reply } = await browser.connect()
    const minted = deviceIdOf(reply)
    expect(minted).not.toBe(planted)
    const rows = s.db.rows('google_pending')
    expect(rows.map((row) => row.device_hash)).toEqual([await sha256b64url(minted!)])
    expect(rows[0]!.device_hash).not.toBe(await sha256b64url(planted))
  })

  it('a connect sweeps expired pending rows in the same batch', async () => {
    const s = server()
    await s.browser().connect()
    await s.browser().connect()
    s.advance(PENDING_TTL_S + 1)
    await s.browser().connect()
    expect(s.db.rows('google_pending')).toHaveLength(1)
  })

  it('a malformed incoming device cookie is replaced by a new id', async () => {
    const browser = server().browser()
    browser.jar.set('__Host-wl_dev', 'short')
    const { reply } = await browser.connect()
    expect(DEVICE_COOKIE.exec(reply.setCookies.find((c) => c.startsWith('__Host-wl_dev='))!)![1]).not.toBe('short')
  })

  it('a second connect replaces the device pending row: one row, the old state gone, a new pending id', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    await browser.connect(EPOCH_A)
    const [before] = s.db.rows('google_pending')
    await browser.connect(EPOCH_B)
    const rows = s.db.rows('google_pending')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state_hash).not.toBe(before!.state_hash)
    expect(rows[0]!.pending_id).not.toBe(before!.pending_id)
    expect(rows[0]!.pending_id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(rows[0]!.epoch).toBe(EPOCH_B)
    expect(rows[0]!.return_to).toBe('app')
    // The old state no longer matches any pending row.
    const old = await browser.callback({ state: browser.states[0]!, code: s.google.issueCode() }, { flow: browser.states[0]! })
    expect(old.result).toBe('state')
  })

  it('two browsers keep two separate pending rows', async () => {
    const s = server()
    await s.browser().connect()
    await s.browser().connect()
    expect(s.db.rows('google_pending')).toHaveLength(2)
  })

  it('leaves the credential table unchanged', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const credentials = s.db.rows('google_credentials')
    s.advance(60)
    await browser.connect(EPOCH_B)
    expect(s.db.rows('google_credentials')).toEqual(credentials)
  })

  it('a D1 error → 503 storage, and no cookie is set', async () => {
    const s = server()
    s.store.failNext('upsertPending')
    const reply = await s.browser().post('connect', { from: 'app', epoch: EPOCH_A })
    expect(reply.status).toBe(503)
    expect(reply.body).toEqual({ code: 'storage' })
    expect(reply.setCookies).toEqual([])
  })

  it('stores the canary return target from `from`', async () => {
    const s = server()
    await s.browser().connect(EPOCH_A, 'canary')
    expect(s.db.rows('google_pending')[0]!.return_to).toBe('canary')
  })
})

describe('S-12 epoch binding at /connect', () => {
  it.each([
    ['no epoch', { from: 'app' }],
    ['a 21-character epoch', { from: 'app', epoch: 'A'.repeat(21) }],
    ['a 23-character epoch', { from: 'app', epoch: 'A'.repeat(23) }],
    ['an epoch outside base64url', { from: 'app', epoch: 'AAAAAAAAAAAAAAAAAAAAA=' }],
    ['a numeric epoch', { from: 'app', epoch: 1234567890123456789012 }],
    ['an unknown from', { from: 'evil', epoch: EPOCH_A }],
    ['an extra key', { from: 'app', epoch: EPOCH_A, return_to: 'https://evil.test' }],
    ['an array', [EPOCH_A]],
  ])('%s → 400 badRequest, nothing stored, no cookie', async (_, body) => {
    const s = server()
    const reply = await s.browser().post('connect', body)
    expect(reply.status).toBe(400)
    expect(reply.body).toEqual({ code: 'badRequest' })
    expect(reply.setCookies).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
  })

  it('a body that is not JSON → 400', async () => {
    const reply = await server().browser().post('connect', undefined, { rawBody: 'from=app', headers: { 'content-type': 'application/json' } })
    expect(reply.status).toBe(400)
  })
})
