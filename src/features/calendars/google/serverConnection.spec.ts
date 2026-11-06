// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServerConnection, type LockPort, type RequestOptions, type ServerEnvironment } from './serverConnection'

// A-3: every call carries the guard header, same-origin credentials and no-store, and runs only inside the
// `weeklid-google` lock; without navigator.locks nothing is sent.
const TOKEN = 'tok-unit-SECRET-9'
const GEN = 'AAAAAAAAAAAAAAAAAAAAAA.-'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

interface Sent { url: string; options: RequestOptions; insideLock: boolean }

function harness(answer: (url: string) => Response | Promise<Response> = (url) => (url.endsWith('/connect')
  ? json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' })
  : url.endsWith('/token') ? json({ accessToken: TOKEN, expiresIn: 3599, epoch: 'e', pending: false })
    : url.endsWith('/status') ? json({ gen: GEN, connected: true, pending: false })
      : json({ result: 'confirmed' }))) {
  const sent: Sent[] = []
  const lockRequests: { name: string; mode: string; signal: AbortSignal }[] = []
  let inside = 0
  const locks: LockPort = {
    request: async (name, options, task) => {
      lockRequests.push({ name, mode: options.mode, signal: options.signal })
      inside += 1
      try { return await task() } finally { inside -= 1 }
    },
  }
  const env: ServerEnvironment = {
    fetch: async (url, options) => {
      sent.push({ url, options, insideLock: inside > 0 })
      return answer(url)
    },
    locks,
    randomBytes: (length) => new Uint8Array(length).fill(7),
  }
  return { env, sent, lockRequests }
}

afterEach(() => { vi.useRealTimers() })

describe('A-3 request shape and lock', () => {
  it.each([
    ['mint', (c: ReturnType<typeof createServerConnection>) => c.mint(), ['token']],
    ['connect', (c: ReturnType<typeof createServerConnection>) => c.connect(), ['connect']],
    ['forgetThisDevice', (c: ReturnType<typeof createServerConnection>) => c.forgetThisDevice(true), ['status', 'disconnect']],
  ])('%s: POST with X-Weeklid, same-origin credentials, no-store, inside the exclusive lock', async (_, run, routes) => {
    const h = harness()
    await run(createServerConnection(h.env))
    expect(h.sent.map((request) => request.url)).toEqual(routes.map((route) => `/api/google/${route}`))
    for (const request of h.sent) {
      expect(request.options).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      expect(request.options.headers['X-Weeklid']).toBe('1')
      expect(request.options.signal).toBeInstanceOf(AbortSignal)
      expect(request.insideLock).toBe(true)
    }
    expect(h.lockRequests).toHaveLength(1)
    expect(h.lockRequests[0]).toMatchObject({ name: 'weeklid-google', mode: 'exclusive' })
    expect(h.lockRequests[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends JSON only with a body: connect and disconnect have one, token and status do not', async () => {
    const h = harness()
    const client = createServerConnection(h.env)
    await client.connect()
    await client.mint()
    await client.forgetThisDevice(false)
    const byRoute = Object.fromEntries(h.sent.map((request) => [request.url.split('/').pop(), request.options]))
    expect(byRoute.connect!.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(byRoute.connect!.body!)).toEqual({ from: 'app', epoch: 'BwcHBwcHBwcHBwcHBwcHBw' })
    expect(byRoute.disconnect!.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(byRoute.disconnect!.body!)).toEqual({ revoke: false, gen: GEN })
    for (const route of ['token', 'status']) {
      expect(byRoute[route]!.headers).not.toHaveProperty('Content-Type')
      expect(byRoute[route]!.body).toBeUndefined()
    }
  })

  it('without navigator.locks nothing is sent, and no call runs unlocked', async () => {
    const h = harness()
    const client = createServerConnection({ ...h.env, locks: undefined })
    expect(await client.mint()).toEqual({ kind: 'unavailable', code: 'lockUnavailable' })
    expect(await client.connect()).toEqual({ kind: 'unavailable', code: 'lockUnavailable' })
    expect(await client.forgetThisDevice(true)).toBe('failed')
    expect(h.sent).toEqual([])
  })

  it('a second call while one holds the lock in this tab is refused, not run unlocked', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const h = harness(async () => { await held; return json({ accessToken: TOKEN, expiresIn: 60 }) })
    const client = createServerConnection(h.env)
    const first = client.mint()
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    expect(await client.mint()).toEqual({ kind: 'unavailable', code: 'busy' })
    expect(h.sent).toHaveLength(1)
    release()
    expect((await first).kind).toBe('token')
    expect((await client.mint()).kind).toBe('token')
  })

  it('a lock that cannot be acquired in time is busy, not an unlocked request', async () => {
    const h = harness()
    const client = createServerConnection({ ...h.env, locks: { request: () => Promise.reject(new DOMException('waited', 'TimeoutError')) } })
    expect(await client.mint()).toEqual({ kind: 'unavailable', code: 'busy' })
    expect(h.sent).toEqual([])
  })

  it('the task is aborted at 15 s: a request that never answers ends as a timeout and frees the lock', async () => {
    vi.useFakeTimers()
    const h = harness((url) => new Promise<Response>((_, reject) => {
      const request = h.sent.find((item) => item.url === url)!
      request.options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const client = createServerConnection(h.env)
    const minting = client.mint()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await minting).toEqual({ kind: 'unavailable', code: 'timeout' })
    vi.useRealTimers()
    expect((await createServerConnection(harness().env).mint()).kind).toBe('token')
  })

  it('a network error is a network result and the next call still runs', async () => {
    const h = harness()
    const failing = createServerConnection({ ...h.env, fetch: () => Promise.reject(new TypeError('offline')) })
    expect(await failing.mint()).toEqual({ kind: 'unavailable', code: 'network' })
    expect(await failing.mint()).toEqual({ kind: 'unavailable', code: 'network' })
  })
})

describe('closed reply mapping', () => {
  it.each([
    ['a 200 without a token', json({ expiresIn: 5 }), { kind: 'unavailable', code: 'malformed' }],
    ['a 200 with a non-numeric lifetime', json({ accessToken: TOKEN, expiresIn: '60' }), { kind: 'unavailable', code: 'malformed' }],
    ['a 200 that is not JSON', new Response('<html>', { status: 200 }), { kind: 'unavailable', code: 'malformed' }],
    ['a 401 with an unknown code', json({ code: 'surprise' }, 401), { kind: 'unavailable', code: 'malformed' }],
    ['a 401 reconnect', json({ code: 'reconnect' }, 401), { kind: 'signedOut', code: 'reconnect' }],
    ['a 503 notConfigured', json({ code: 'notConfigured' }, 503), { kind: 'paused', code: 'notConfigured' }],
    ['a 503 storage', json({ code: 'storage' }, 503), { kind: 'unavailable', code: 'storage' }],
    ['a 500', json({ code: 'error' }, 500), { kind: 'unavailable', code: 'error' }],
  ])('mint: %s', async (_, reply, expected) => {
    expect(await createServerConnection(harness(() => reply).env).mint()).toEqual(expected)
  })

  it.each(['http://accounts.google.com/o', 'https://evil.example/o', 'https://accounts.google.com.evil.example/o', 'javascript:alert(1)', 'not a url'])('connect refuses the address %j', async (url) => {
    expect(await createServerConnection(harness(() => json({ url })).env).connect()).toEqual({ kind: 'unavailable', code: 'malformed' })
  })

  it('forgetThisDevice refuses a status without a well-formed generation', async () => {
    const h = harness((url) => (url.endsWith('/status') ? json({ gen: 'x' }) : json({ result: 'confirmed' })))
    expect(await createServerConnection(h.env).forgetThisDevice(true)).toBe('failed')
    expect(h.sent.map((request) => request.url)).toEqual(['/api/google/status'])
  })

  it('never keeps the access token anywhere but the result', async () => {
    const h = harness()
    const client = createServerConnection(h.env)
    await client.mint()
    expect(JSON.stringify(h.lockRequests)).not.toContain(TOKEN)
  })
})
