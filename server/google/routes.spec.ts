// @vitest-environment node
// S-10: Functions run only under /api/google/*, and each route file exports exactly one method handler.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PagesContext } from './deps'
import { APP, EPOCH_A, FAKE, TOKEN_KEY } from './testing/harness'
import { sqliteD1 } from './testing/sqliteD1'

const root = fileURLToPath(new URL('../../', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [relative(root, path)]
  })
}

const EXPECTED: Record<string, 'onRequestGet' | 'onRequestPost'> = {
  'functions/api/google/connect.ts': 'onRequestPost',
  'functions/api/google/callback.ts': 'onRequestGet',
  'functions/api/google/token.ts': 'onRequestPost',
  'functions/api/google/status.ts': 'onRequestPost',
  'functions/api/google/disconnect.ts': 'onRequestPost',
  'functions/api/google/canary/index.ts': 'onRequestGet',
  'functions/api/google/canary/script.ts': 'onRequestGet',
}

describe('S-10 routes', () => {
  it('public/_routes.json routes only /api/google/* to Functions', () => {
    expect(JSON.parse(readFileSync(join(root, 'public/_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/api/google/*'], exclude: [] })
  })

  it('functions/ holds exactly the Google routes', () => {
    expect(files(join(root, 'functions')).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('%s exports only %s', async (file, method) => {
    const exports = Object.keys(await import(/* @vite-ignore */ join(root, file)))
    expect(exports).toEqual([method])
  })
})

type Adapter = (ctx: PagesContext) => Promise<Response>

// Each Pages adapter, called as Pages calls it, must reach its own handler: a request every route would accept
// gets a route-specific answer. No path below contacts Google.
describe('S-10 each Pages adapter reaches its own handler', () => {
  const env = () => ({ APP_ORIGIN: APP, GOOGLE_SERVER_ENABLED: '1', GOOGLE_TOKEN_KEY: TOKEN_KEY, VITE_GOOGLE_CLIENT_ID: FAKE.clientId, DB: sqliteD1() })
  const post = (path: string, body?: unknown) => new Request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'x-weeklid': '1', origin: APP, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const adapter = async (file: string): Promise<Adapter> => {
    const module = (await import(/* @vite-ignore */ join(root, file))) as Record<string, Adapter>
    return module[EXPECTED[file]!]!
  }
  let log = vi.spyOn(console, 'log')
  let fetchSpy = vi.spyOn(globalThis, 'fetch')
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('no network in tests'))
  })
  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  const routeOf = () => JSON.parse(String(log.mock.calls.at(-1)![0])).r

  it('connect: 200 with an authorization URL and both cookies', async () => {
    const response = await (await adapter('functions/api/google/connect.ts'))({ request: post('/api/google/connect', { from: 'app', epoch: EPOCH_A }), env: env() })
    expect(response.status).toBe(200)
    expect(String(((await response.json()) as { url: string }).url)).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(routeOf()).toBe('connect')
  })

  it('token: no device cookie → 401 noDevice', async () => {
    const response = await (await adapter('functions/api/google/token.ts'))({ request: post('/api/google/token'), env: env() })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'noDevice' })
    expect(routeOf()).toBe('token')
  })

  it('status: no device cookie → the empty generation', async () => {
    const response = await (await adapter('functions/api/google/status.ts'))({ request: post('/api/google/status'), env: env() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ gen: '-.-', connected: false, pending: false })
    expect(routeOf()).toBe('status')
  })

  it('disconnect: no device cookie → none; a malformed generation → 400', async () => {
    const disconnect = await adapter('functions/api/google/disconnect.ts')
    const none = await disconnect({ request: post('/api/google/disconnect', { revoke: true, gen: '-.-' }), env: env() })
    expect(await none.json()).toEqual({ result: 'none' })
    const bad = await disconnect({ request: post('/api/google/disconnect', { revoke: true, gen: 'x' }), env: env() })
    expect(bad.status).toBe(400)
    expect(routeOf()).toBe('disconnect')
  })

  it('callback: a GET without state → 303 to the app with the state result, no cookie', async () => {
    const response = await (await adapter('functions/api/google/callback.ts'))({ request: new Request(`${APP}/api/google/callback?code=x`), env: env() })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${APP}/?google=state#/settings/calendars`)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(routeOf()).toBe('callback')
  })

  it('canary page and script: HTML with its CSP, and the JavaScript', async () => {
    const page = await (await adapter('functions/api/google/canary/index.ts'))({ request: new Request(`${APP}/api/google/canary`), env: env() })
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('<script src="/api/google/canary/script"></script>')
    expect(routeOf()).toBe('canary')
    const script = await (await adapter('functions/api/google/canary/script.ts'))({ request: new Request(`${APP}/api/google/canary/script`), env: env() })
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await script.text()).toContain("locks.request('weeklid-google'")
    expect(routeOf()).toBe('canaryScript')
  })
})
