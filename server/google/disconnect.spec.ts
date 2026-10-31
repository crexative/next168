// @vitest-environment node
// S-8 (disconnect outcome table), S-13 (generation fence: the red team's sequences, and all 81 pairs) and S-14 (status).
import { describe, expect, it } from 'vitest'
import { DEVICE_COOKIE } from './handlers'
import { EPOCH_B, FAKE, OTHER_TOKEN_KEY, id22, server, type Browser, type TestServer } from './testing/harness'

async function connected(s: TestServer): Promise<Browser> {
  const browser = s.browser()
  expect(await browser.consent()).toBe('connected')
  return browser
}

async function gen(browser: Browser): Promise<string> {
  const reply = await browser.status()
  expect(reply.status).toBe(200)
  return String(reply.body!.gen)
}

const rows = (s: TestServer) => ({ credentials: s.db.rows('google_credentials'), pending: s.db.rows('google_pending') })

describe('S-8 disconnect outcome table', () => {
  it('deleted a credential, revoke:true, Google 200 → confirmed; the credential is gone before the revoke call', async () => {
    const s = server()
    const browser = await connected(s)
    let credentialsAtRevoke = -1
    s.google.onRevoke = () => {
      credentialsAtRevoke = s.db.rows('google_credentials').length
    }
    const reply = await browser.disconnect(await gen(browser), true)
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: 'confirmed' })
    expect(credentialsAtRevoke).toBe(0)
    expect(s.google.calls.filter((c) => c.kind === 'revoke').map((c) => c.form)).toEqual([{ token: FAKE.refreshToken }])
    expect(rows(s)).toEqual({ credentials: [], pending: [] })
    expect(reply.setCookies).toEqual([])
  })

  it('deleted a credential, revoke:true, Google not 200 or hanging → unconfirmed, rows gone', async () => {
    for (const scripted of [{ status: 400, body: { error: 'invalid_token' } }, { status: 503 }, 'hang' as const]) {
      const s = server()
      const browser = await connected(s)
      s.google.script('revoke', scripted)
      expect((await browser.disconnect(await gen(browser), true)).body).toEqual({ result: 'unconfirmed' })
      expect(rows(s)).toEqual({ credentials: [], pending: [] })
    }
  })

  it('deleted a credential whose token will not open → unconfirmed, zero revoke calls', async () => {
    const s = server()
    const browser = await connected(s)
    s.db.sqlite.exec(`UPDATE google_credentials SET ciphertext = 'AAAA' || substr(ciphertext, 5)`)
    expect((await browser.disconnect(await gen(browser), true)).body).toEqual({ result: 'unconfirmed' })
    expect(s.google.count('revoke')).toBe(0)
    expect(rows(s).credentials).toEqual([])

    const rekeyed = server()
    const other = await connected(rekeyed)
    const after = server({ GOOGLE_TOKEN_KEY: OTHER_TOKEN_KEY, DB: rekeyed.db })
    const moved = after.browser()
    moved.jar.set(DEVICE_COOKIE, other.deviceId!)
    expect((await moved.disconnect(await gen(moved), true)).body).toEqual({ result: 'unconfirmed' })
    expect(after.google.count('revoke')).toBe(0)
  })

  it('deleted a credential, revoke:false → forgotten, zero revoke calls', async () => {
    const s = server()
    const browser = await connected(s)
    expect((await browser.disconnect(await gen(browser), false)).body).toEqual({ result: 'forgotten' })
    expect(s.google.count('revoke')).toBe(0)
    expect(rows(s)).toEqual({ credentials: [], pending: [] })
  })

  it('deleted only a pending row → none (the pending consent is cancelled)', async () => {
    for (const revoke of [true, false]) {
      const s = server()
      const browser = s.browser()
      await browser.connect()
      const g = await gen(browser)
      expect(g).toMatch(/^-\.[A-Za-z0-9_-]{22}$/)
      expect((await browser.disconnect(g, revoke)).body).toEqual({ result: 'none' })
      expect(rows(s)).toEqual({ credentials: [], pending: [] })
      expect(s.google.count('revoke')).toBe(0)
    }
  })

  it('deleted nothing, nothing left → none; no cookie → none', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    browser.jar.delete('__Host-wl_gflow')
    expect((await browser.disconnect('-.-')).body).toEqual({ result: 'stale', gen: await gen(browser) })
    await browser.disconnect(await gen(browser))
    expect((await browser.disconnect('-.-')).body).toEqual({ result: 'none' })
    expect((await s.browser().disconnect('-.-')).body).toEqual({ result: 'none' })
  })

  it('deleted nothing, rows left → stale with the current generation', async () => {
    const s = server()
    const browser = await connected(s)
    const current = await gen(browser)
    const reply = await browser.disconnect(`${id22('other')}.-`)
    expect(reply.body).toEqual({ result: 'stale', gen: current })
    expect(rows(s).credentials).toHaveLength(1)
    expect(s.google.count('revoke')).toBe(0)
  })

  it("failNext('disconnect') → 503 storage, zero revoke calls, rows intact", async () => {
    const s = server()
    const browser = await connected(s)
    const before = rows(s)
    const g = await gen(browser)
    s.store.failNext('disconnect')
    const reply = await browser.disconnect(g)
    expect(reply.status).toBe(503)
    expect(reply.body).toEqual({ code: 'storage' })
    expect(s.google.count('revoke')).toBe(0)
    expect(rows(s)).toEqual(before)
  })

  it('a failing statement inside the batch rolls the whole batch back', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    const before = rows(s)
    s.db.sqlite.exec(`CREATE TRIGGER fail_pending_delete BEFORE DELETE ON google_pending BEGIN SELECT RAISE(ABORT, 'injected'); END`)
    expect((await browser.disconnect(await gen(browser))).body).toEqual({ code: 'storage' })
    expect(rows(s)).toEqual(before)
  })

  it.each([
    '', '-', '-.-.-', 'A.B', `${id22('a')}.`, `.${id22('a')}`, `${id22('a')}x.-`, `${id22('a').slice(1)}.-`, `-.${'+'.repeat(22)}`, `${id22('a')} .-`,
  ])('a malformed gen %j → 400', async (bad) => {
    const s = server()
    const browser = await connected(s)
    const before = rows(s)
    const reply = await browser.disconnect(bad)
    expect(reply.status).toBe(400)
    expect(reply.body).toEqual({ code: 'badRequest' })
    expect(rows(s)).toEqual(before)
  })

  it.each([
    ['revoke not boolean', { revoke: 'true', gen: '-.-' }],
    ['missing revoke', { gen: '-.-' }],
    ['missing gen', { revoke: true }],
    ['gen not a string', { revoke: true, gen: null }],
    ['an extra key', { revoke: true, gen: '-.-', nonce: 'x' }],
    ['an array', [true, '-.-']],
  ])('%s → 400', async (_, body) => {
    expect((await server().browser().post('disconnect', body)).status).toBe(400)
  })

  it('a matching generation that includes a pending row cancels that consent: its callback gets cancelled or state', async () => {
    const s = server()
    const browser = await connected(s)
    const { state, challenge } = await browser.connect(EPOCH_B)
    expect((await browser.disconnect(await gen(browser), false)).body).toEqual({ result: 'forgotten' })
    const { result } = await browser.callback({ state, code: s.google.issueCode({ challenge }) })
    expect(['cancelled', 'state']).toContain(result)
    expect(rows(s).credentials).toEqual([])
  })
})

describe('S-13 generation fence: the red team sequences', () => {
  it('(a) a held (A,-) disconnect released after B committed → stale, B intact (also 2 days later)', async () => {
    for (const delaySeconds of [0, 2 * 86_400]) {
      const s = server()
      const browser = await connected(s)
      const genA = await gen(browser)
      expect(genA).toMatch(/\.-$/)
      const held = s.store.hold('disconnect')
      const disconnect = browser.disconnect(genA, true)
      await held.reached
      expect(await browser.consent({ epoch: EPOCH_B, refreshToken: 'rt-SECRET-B' })).toBe('connected')
      const b = rows(s)
      s.advance(delaySeconds)
      held.release()
      const reply = await disconnect
      expect(reply.body).toEqual({ result: 'stale', gen: `${String(b.credentials[0]!.connection_id)}.-` })
      expect(rows(s)).toEqual(b)
      expect(s.google.count('revoke')).toBe(0)
    }
  })

  it('(b) a newer pending P makes (A,-) stale with A and P intact; (A,P) then removes both', async () => {
    const s = server()
    const browser = await connected(s)
    const genA = await gen(browser)
    await browser.connect(EPOCH_B)
    const both = rows(s)
    const stale = await browser.disconnect(genA)
    expect(stale.body!.result).toBe('stale')
    expect(rows(s)).toEqual(both)
    const genAP = String(stale.body!.gen)
    expect(genAP).toBe(`${String(both.credentials[0]!.connection_id)}.${String(both.pending[0]!.pending_id)}`)
    expect((await browser.disconnect(genAP)).body).toEqual({ result: 'confirmed' })
    expect(rows(s)).toEqual({ credentials: [], pending: [] })
  })

  it('(c) (-,P) with no credential deletes P → none; (-,P) while a credential exists → stale', async () => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    expect((await browser.disconnect(await gen(browser))).body).toEqual({ result: 'none' })
    expect(rows(s).pending).toEqual([])

    const t = server()
    const other = await connected(t)
    await other.connect(EPOCH_B)
    const pendingOnly = `-.${String(rows(t).pending[0]!.pending_id)}`
    expect((await other.disconnect(pendingOnly)).body!.result).toBe('stale')
    expect(rows(t).pending).toHaveLength(1)
    expect(rows(t).credentials).toHaveLength(1)
  })

  it('(d) two identical (A,-) requests in sequence: the first deletes, the second answers none', async () => {
    const s = server()
    const browser = await connected(s)
    const g = await gen(browser)
    expect((await browser.disconnect(g)).body).toEqual({ result: 'confirmed' })
    expect((await browser.disconnect(g)).body).toEqual({ result: 'none' })
    expect(s.google.count('revoke')).toBe(1)
  })

  it('(e) an expired pending row (601 s) is ignored by gen and by statement 3', async () => {
    const s = server()
    const browser = await connected(s)
    await browser.connect(EPOCH_B)
    const live = String((await browser.status()).body!.gen)
    s.advance(601)
    const g = await gen(browser)
    expect(g).toBe(`${live.split('.')[0]}.-`)
    expect((await browser.status()).body).toMatchObject({ connected: true, pending: false })
    expect((await browser.disconnect(live)).body).toEqual({ result: 'stale', gen: g })
    expect((await browser.disconnect(g, false)).body).toEqual({ result: 'forgotten' })
  })

  it('(f) the credential vanishes between status and disconnect (held invalid_grant) → stale, P intact', async () => {
    const s = server()
    const browser = await connected(s)
    await browser.connect(EPOCH_B)
    const captured = await gen(browser)
    s.google.validRefreshTokens.clear()
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    held.release()
    expect((await mint).body).toEqual({ code: 'reconnect' })
    const pendingRow = rows(s).pending
    const reply = await browser.disconnect(captured)
    expect(reply.body).toEqual({ result: 'stale', gen: `-.${String(pendingRow[0]!.pending_id)}` })
    expect(rows(s).pending).toEqual(pendingRow)
  })

  it('(f) the same when the credential disappears by purge', async () => {
    const s = server()
    const browser = await connected(s)
    await browser.connect(EPOCH_B)
    const captured = await gen(browser)
    s.db.sqlite.exec('DELETE FROM google_credentials;')
    const pendingRow = rows(s).pending
    expect((await browser.disconnect(captured)).body!.result).toBe('stale')
    expect(rows(s).pending).toEqual(pendingRow)
  })
})

describe('S-13 generation fence: all 81 gen × actual pairs delete only on an exact match', () => {
  const C = { A: id22('credA'), B: id22('credB') }
  const P = { P: id22('pendP'), Q: id22('pendQ') }
  const credentialStates = [null, C.A, C.B]
  const pendingStates = [null, P.P, P.Q]
  const pairs: [string | null, string | null, string | null, string | null][] = []
  for (const ac of credentialStates) for (const ap of pendingStates) for (const gc of credentialStates) for (const gp of pendingStates) pairs.push([ac, ap, gc, gp])

  it('covers 81 pairs', () => expect(pairs).toHaveLength(81))

  it.each(pairs)('actual (%s, %s), gen (%s, %s)', async (ac, ap, gc, gp) => {
    const s = server()
    const browser = s.browser()
    await browser.connect()
    const device = String(rows(s).pending[0]!.device_hash)
    s.db.sqlite.exec('DELETE FROM google_pending;')
    const now = Math.floor(s.clock.now / 1000)
    if (ac) s.db.sqlite.prepare(`INSERT INTO google_credentials VALUES (?, ?, 'e', 'k', 'iv', 'ct', ?, ?)`).run(device, ac, now, now)
    if (ap) s.db.sqlite.prepare(`INSERT INTO google_pending VALUES (?, ?, 'st', 'v', 'k', 'e', 'app', ?)`).run(device, ap, now)
    // Another device with the same ids must never be touched.
    s.db.sqlite.prepare(`INSERT INTO google_credentials VALUES ('other', ?, 'e', 'k', 'iv', 'ct', ?, ?)`).run(gc ?? C.A, now, now)
    s.db.sqlite.prepare(`INSERT INTO google_pending VALUES ('other', ?, 'st-other', 'v', 'k', 'e', 'app', ?)`).run(gp ?? P.P, now)
    const before = rows(s)

    const result = await s.store.disconnect(device, { connectionId: gc, pendingId: gp }, now - 600)
    const after = rows(s)
    const exact = ac === gc && ap === gp
    const mine = (list: Record<string, unknown>[]) => list.filter((row) => row.device_hash === device)
    if (exact) {
      expect(mine(after.credentials)).toEqual([])
      expect(mine(after.pending)).toEqual([])
    } else {
      expect(after).toEqual(before)
      expect(result.deleted).toBeNull()
      expect(result.pendingDeleted).toBe(false)
    }
    expect(after.credentials.filter((row) => row.device_hash === 'other')).toHaveLength(1)
    expect(after.pending.filter((row) => row.device_hash === 'other')).toHaveLength(1)
    expect(result.after).toEqual(exact ? { connectionId: null, pendingId: null } : { connectionId: ac, pendingId: ap })
  })
})

describe('S-14 status', () => {
  it('no cookie → -.-; credential → <c>.-; credential + live pending → <c>.<p>; expired pending not reported', async () => {
    const s = server()
    const fresh = await s.browser().status()
    expect(fresh.body).toEqual({ gen: '-.-', connected: false, pending: false })
    const browser = await connected(s)
    const c = String(rows(s).credentials[0]!.connection_id)
    expect((await browser.status()).body).toEqual({ gen: `${c}.-`, connected: true, pending: false })
    await browser.connect(EPOCH_B)
    const p = String(rows(s).pending[0]!.pending_id)
    const live = await browser.status()
    expect(live.body).toEqual({ gen: `${c}.${p}`, connected: true, pending: true })
    expect(live.setCookies).toEqual([])
    expect(live.headers.get('cache-control')).toBe('no-store')
    s.advance(601)
    expect((await browser.status()).body).toEqual({ gen: `${c}.-`, connected: true, pending: false })
  })

  it('makes zero Google calls and answers storage on a D1 error', async () => {
    const s = server()
    const browser = await connected(s)
    const calls = s.google.calls.length
    await browser.status()
    expect(s.google.calls.length).toBe(calls)
    s.store.failNext('status')
    const reply = await browser.status()
    expect(reply.status).toBe(503)
    expect(reply.body).toEqual({ code: 'storage' })
  })
})
