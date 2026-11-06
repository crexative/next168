// @vitest-environment node
// S-9: one outcome line per request with closed vocabularies; no secret, code, state, verifier or identifier.
// The harness applies the same checks to every server built by every server spec, after each test.
import { describe, expect, it } from 'vitest'
import { EPOCH_B, ERROR_CLASSES, FAKE, OUTCOMES, server, type TestServer } from './testing/harness'

const parsed = (s: TestServer) => s.logs.map((line) => JSON.parse(line) as Record<string, unknown>)

describe('S-9 logs', () => {
  it('a session across every route logs one closed-vocabulary line per request and nothing sensitive', async () => {
    const s = server()
    const browser = s.browser()
    await browser.post('token', undefined, { headers: { origin: 'https://evil.test' } })
    expect(await browser.consent()).toBe('connected')
    await browser.mint()
    const { state } = await browser.connect(EPOCH_B)
    await browser.callback({ state, error: 'access_denied' })
    await browser.callback({ state: 'nope', code: 'nope' }, { flow: 'nope' })
    s.google.script('refresh', 'hang')
    await browser.mint()
    const gen = String((await browser.status()).body!.gen)
    await browser.disconnect('-.-')
    await browser.disconnect(gen)

    const lines = parsed(s)
    expect(lines).toHaveLength(s.requests)
    expect(lines.map((line) => line.r)).toEqual([
      'token', 'connect', 'callback', 'token', 'connect', 'callback', 'callback', 'token', 'status', 'disconnect', 'disconnect',
    ])
    expect(lines.map((line) => line.o)).toEqual([
      'forbidden', 'ok', 'connected', 'ok', 'ok', 'denied', 'state', 'googleUnavailable', 'ok', 'stale', 'confirmed',
    ])
    expect(lines[7]!.e).toBe('TimeoutError')
    for (const line of lines) {
      expect(OUTCOMES).toContain(line.o)
      expect(typeof line.s).toBe('number')
      expect(typeof line.ms).toBe('number')
      if ('e' in line) expect(ERROR_CLASSES).toContain(line.e)
    }
    const all = s.logs.join('\n')
    for (const secret of [FAKE.clientSecret, FAKE.refreshToken, FAKE.accessToken, state, browser.deviceId!, gen.split('.')[0]!]) {
      expect(all).not.toContain(secret)
    }
  })

  it("an error whose message is a secret logs e:'Other', never the message", async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    s.store.mintRead = () => Promise.reject(new Error('rt-SECRET-456'))
    expect((await browser.mint()).body).toEqual({ code: 'storage' })
    expect(parsed(s).at(-1)).toEqual({ r: 'token', o: 'storage', s: 503, ms: 0, e: 'Other' })
  })

  it("an error class named like a secret logs e:'Other', never the name", async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const Named = { 'rt-SECRET-456': class extends Error {} }['rt-SECRET-456']
    const renamed = new Named('x')
    renamed.name = 'rt-SECRET-456'
    for (const error of [new Named('rt-SECRET-456'), renamed]) {
      s.store.status = () => Promise.reject(error)
      await browser.status()
      expect(parsed(s).at(-1)).toEqual({ r: 'status', o: 'storage', s: 503, ms: 0, e: 'Other' })
    }
    expect(s.logs.join('\n')).not.toContain('SECRET')
  })

  it('an exception escaping a JSON route → 500 error, logged by class only', async () => {
    const s = server()
    s.deps.random = () => {
      throw new TypeError('rt-SECRET-456')
    }
    const reply = await s.browser().post('connect', { from: 'app', epoch: EPOCH_B })
    expect(reply.status).toBe(500)
    expect(reply.body).toEqual({ code: 'error' })
    expect(parsed(s).at(-1)).toEqual({ r: 'connect', o: 'error', s: 500, ms: 0, e: 'TypeError' })
  })

  it('reports elapsed milliseconds from the injected clock', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    s.clock.now += 42
    held.release()
    await mint
    expect(parsed(s).at(-1)).toMatchObject({ r: 'token', o: 'ok', s: 200, ms: 42 })
  })
})
