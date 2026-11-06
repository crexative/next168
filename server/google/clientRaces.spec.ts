// @vitest-environment node
// A-12 (callback-commit race against Delete all data's forget) and A-11 (d) (a refresh in flight across Disconnect),
// both against the real S1a handlers and the real client.
import { describe, expect, it } from 'vitest'
import { clientFor } from './testing/clientBridge'
import { FAKE, server } from './testing/harness'

describe('A-12 callback-commit race', () => {
  // The design says `cancelled` here; the handler answers `state` when the row is already gone at the lookup
  // (handlers.ts, `if (!pending) return finish('state')`). The protected property is the same: no credential.
  it('Delete all data forgets before the callback looks the row up: no credential is created', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    expect(await clientFor(browser).connection.forgetThisDevice(false)).toBe('cleared')
    const done = await browser.callback({ state, code: s.google.issueCode({ challenge }) })
    expect(done.result).toBe('state')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
    expect(s.google.calls).toEqual([])
  })

  it('Delete all data forgets while the code is being exchanged: the callback answers cancelled and no credential exists', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    const exchange = s.google.hold('exchange')
    const callback = browser.callback({ state, code: s.google.issueCode({ challenge }) })
    await exchange.reached
    expect(await clientFor(browser).connection.forgetThisDevice(false)).toBe('cleared')
    exchange.release()
    expect((await callback).result).toBe('cancelled')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
  })

  it('a commit between status and disconnect makes the disconnect stale, and the retry deletes the new credential', async () => {
    const s = server()
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    const held = s.store.hold('disconnect')
    const forgetting = clientFor(browser).connection.forgetThisDevice(false)
    await held.reached
    expect((await browser.callback({ state, code: s.google.issueCode({ challenge }) })).result).toBe('connected')
    expect(s.db.rows('google_credentials')).toHaveLength(1)
    held.release()
    expect(await forgetting).toBe('forgotten')
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
  })
})

describe('A-11 (d) a refresh in flight across the terminal Disconnect', () => {
  // The revoke is unconfirmed, so Google still honours the refresh it already accepted: the residual of design 4-1b.
  it('still answers 200 with one access token, re-creates no credential, and the next mint answers notConnected', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const refresh = s.google.hold('refresh')
    const minting = browser.mint()
    await refresh.reached
    s.google.script('revoke', { status: 503 })
    expect(await clientFor(browser).connection.forgetThisDevice(true)).toBe('unconfirmed')
    expect(s.db.rows('google_credentials')).toEqual([])
    refresh.release()
    const late = await minting
    expect(late.status).toBe(200)
    expect(late.body).toMatchObject({ accessToken: FAKE.accessToken })
    expect(s.db.rows('google_credentials')).toEqual([])
    expect(s.db.rows('google_pending')).toEqual([])
    const next = await browser.mint()
    expect(next.status).toBe(401)
    expect(next.body).toEqual({ code: 'notConnected' })
    expect(s.google.count('refresh')).toBe(1)
  })

  it('after a confirmed revoke Google refuses the held refresh: no access token at all', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const refresh = s.google.hold('refresh')
    const minting = browser.mint()
    await refresh.reached
    expect(await clientFor(browser).connection.forgetThisDevice(true)).toBe('confirmed')
    refresh.release()
    const late = await minting
    expect(late.status).toBe(401)
    expect(JSON.stringify(late.body)).not.toContain(FAKE.accessToken)
    expect(s.db.rows('google_credentials')).toEqual([])
  })
})
