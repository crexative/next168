// @vitest-environment node
// The temporary canary (§4.4, §8.2; deleted by S1c): page headers, and the script's D15 lock contract for Start,
// Mint and Disconnect, run in a sandbox with recorded locks, fetches and navigation.
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet as canaryPage } from '../../functions/api/google/canary/index'
import { onRequestGet as canaryScript } from '../../functions/api/google/canary/script'
import { APP } from './testing/harness'

const env = { APP_ORIGIN: APP, GOOGLE_SERVER_ENABLED: '1' }
let logs: string[]

beforeEach(() => {
  logs = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line)
  })
})
afterEach(() => vi.restoreAllMocks())

describe('canary page', () => {
  it('is a GET-only HTML page with its own CSP, an external script and the home-screen meta', async () => {
    const response = await canaryPage({ request: new Request(`${APP}/api/google/canary?google=canary`), env })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'")
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('set-cookie')).toBeNull()
    const html = await response.text()
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">')
    expect(html).toContain('<script src="/api/google/canary/script"></script>')
    expect(html).not.toMatch(/<script>|on(click|load)=/)
    for (const id of ['start', 'mint', 'disconnect', 'result']) expect(html).toContain(`id="${id}"`)
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0]!)).toMatchObject({ r: 'canary', o: 'ok', s: 200 })
  })

  it('serves the script as JavaScript', async () => {
    const response = await canaryScript({ request: new Request(`${APP}/api/google/canary/script`), env })
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await response.text()).toContain("locks.request('weeklid-google'")
  })
})

interface Sandbox {
  click(id: string): Promise<void>
  output(): string
  fetches: { path: string; body: unknown; headers: Record<string, string>; credentials: string; lockHeld: boolean }[]
  lockRequests: { name: string; options: Record<string, unknown> }[]
  navigations: { url: string; lockHeld: boolean }[]
  settle(): Promise<void>
}

type Responder = (path: string, body: unknown) => { status: number; body: unknown }

async function sandbox(options: { search?: string; respond: Responder; locks?: 'none' | 'reject' | 'timeout' }): Promise<Sandbox> {
  const source = await (await canaryScript({ request: new Request(`${APP}/api/google/canary/script`), env })).text()
  const handlers = new Map<string, () => Promise<void>>()
  const elements = new Map<string, { textContent: string; addEventListener(type: string, fn: () => Promise<void>): void }>()
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener: (_type, fn) => handlers.set(id, fn) })
    return elements.get(id)!
  }
  let held = false
  let pending: Promise<unknown> = Promise.resolve()
  const result: Sandbox = {
    fetches: [],
    lockRequests: [],
    navigations: [],
    output: () => element('result').textContent,
    async click(id) {
      await handlers.get(id)!()
    },
    async settle() {
      await pending
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
  const locks = options.locks === 'none' ? undefined : {
    request(name: string, lockOptions: Record<string, unknown>, task: () => Promise<unknown>) {
      result.lockRequests.push({ name, options: lockOptions })
      if (options.locks === 'reject') return Promise.reject(new DOMException('denied', 'SecurityError'))
      if (options.locks === 'timeout') return Promise.reject(new DOMException('timed out', 'TimeoutError'))
      held = true
      const run = task().finally(() => {
        held = false
      })
      pending = run
      return run
    },
  }
  runInNewContext(source, {
    document: { getElementById: element },
    navigator: { locks },
    location: { search: options.search ?? '', assign: (url: string) => result.navigations.push({ url, lockHeld: held }) },
    fetch: async (path: string, init: { body?: string; headers: Record<string, string>; credentials: string }) => {
      const body = init.body === undefined ? undefined : JSON.parse(init.body)
      result.fetches.push({ path, body, headers: init.headers, credentials: init.credentials, lockHeld: held })
      const reply = options.respond(path, body)
      return { status: reply.status, json: async () => reply.body }
    },
    crypto: globalThis.crypto,
    AbortSignal,
    AbortController,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    btoa,
  })
  return result
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=x'

describe('canary script', () => {
  it('Start: under the exclusive lock (20 s acquisition, no steal) posts a fresh epoch, then navigates after release', async () => {
    const page = await sandbox({ respond: () => ({ status: 200, body: { url: AUTH_URL } }) })
    await page.click('start')
    await page.click('start')
    expect(page.lockRequests).toHaveLength(2)
    for (const request of page.lockRequests) {
      expect(request.name).toBe('weeklid-google')
      expect(request.options.mode).toBe('exclusive')
      expect(request.options.signal).toBeInstanceOf(AbortSignal)
      expect('steal' in request.options).toBe(false)
      expect('ifAvailable' in request.options).toBe(false)
    }
    const [first, second] = page.fetches
    expect(first!.path).toBe('/api/google/connect')
    expect(first!.lockHeld).toBe(true)
    expect(first!.credentials).toBe('same-origin')
    expect(first!.headers).toEqual({ 'X-Weeklid': '1', 'Content-Type': 'application/json' })
    expect(first!.body).toMatchObject({ from: 'canary' })
    expect(Object.keys(first!.body as object)).toEqual(['from', 'epoch'])
    expect((first!.body as { epoch: string }).epoch).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect((second!.body as { epoch: string }).epoch).not.toBe((first!.body as { epoch: string }).epoch)
    expect(page.navigations).toEqual([{ url: AUTH_URL, lockHeld: false }, { url: AUTH_URL, lockHeld: false }])
  })

  it('Start shows the server code and does not navigate when /connect fails', async () => {
    const page = await sandbox({ respond: () => ({ status: 503, body: { code: 'notConfigured' } }) })
    await page.click('start')
    expect(page.output()).toBe('notConfigured')
    expect(page.navigations).toEqual([])
  })

  it('no navigator.locks → lock unavailable, zero fetch; a rejected request → unavailable; a timeout → busy', async () => {
    for (const [locks, shown] of [['none', 'lock unavailable'], ['reject', 'lock unavailable'], ['timeout', 'lock busy']] as const) {
      const page = await sandbox({ locks, respond: () => ({ status: 200, body: { url: AUTH_URL } }) })
      await page.click('start')
      expect(page.output()).toBe(shown)
      expect(page.fetches).toEqual([])
      expect(page.navigations).toEqual([])
    }
  })

  it('Mint ×3: three locked token requests, results shown as codes', async () => {
    const page = await sandbox({ respond: () => ({ status: 200, body: { accessToken: 'at-SECRET-123', expiresIn: 3599, epoch: 'e', pending: false } }) })
    await page.click('mint')
    expect(page.fetches.map((f) => [f.path, f.lockHeld, f.body])).toEqual([
      ['/api/google/token', true, undefined], ['/api/google/token', true, undefined], ['/api/google/token', true, undefined],
    ])
    expect(page.output()).toBe('ok ok ok')
    expect(page.output()).not.toContain('SECRET')
  })

  it('Disconnect: /status then one /disconnect with that generation and revoke:true, in one locked task', async () => {
    const gen = `${'c'.repeat(22)}.-`
    const page = await sandbox({
      respond: (path) => (path.endsWith('/status') ? { status: 200, body: { gen, connected: true, pending: false } } : { status: 200, body: { result: 'stale', gen: '-.-' } }),
    })
    await page.click('disconnect')
    expect(page.fetches.map((f) => [f.path, f.lockHeld, f.body])).toEqual([
      ['/api/google/status', true, undefined],
      ['/api/google/disconnect', true, { revoke: true, gen }],
    ])
    expect(page.lockRequests).toHaveLength(1)
    expect(page.output()).toBe('stale')
  })

  it('on return with google=canary it mints once under the lock: notConnected → PASS', async () => {
    const page = await sandbox({ search: '?google=canary', respond: () => ({ status: 401, body: { code: 'notConnected' } }) })
    await page.settle()
    expect(page.fetches.map((f) => [f.path, f.lockHeld])).toEqual([['/api/google/token', true]])
    expect(page.output()).toBe('PASS: canary, then notConnected')
  })

  it('on return with google=canary, any other mint answer → FAIL with the code', async () => {
    const page = await sandbox({ search: '?google=canary', respond: () => ({ status: 401, body: { code: 'noDevice' } }) })
    await page.settle()
    expect(page.output()).toBe('FAIL: canary, then noDevice')
  })

  it('shows only known result codes from the URL', async () => {
    const known = await sandbox({ search: '?google=connected', respond: () => ({ status: 500, body: null }) })
    expect(known.output()).toBe('connected')
    expect(known.fetches).toEqual([])
    const hostile = await sandbox({ search: '?google=%3Cscript%3Ealert(1)%3C/script%3E', respond: () => ({ status: 500, body: null }) })
    expect(hostile.output()).toBe('unknown')
  })
})
