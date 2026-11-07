// @vitest-environment node
// Functions for accounts and sync: exactly these files with exactly these methods, routed by _routes.json, each reaching its own handler.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsPagesContext } from './deps'
import { APP, FAKE_ID, SYNC_KEY, migrate } from './testing/harness'
import { sqliteD1 } from '../google/testing/sqliteD1'

const root = fileURLToPath(new URL('../../', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [relative(root, path)]
  })
}

const EXPECTED: Record<string, string[]> = {
  'functions/api/auth/start.ts': ['onRequestPost'],
  'functions/api/auth/callback.ts': ['onRequestGet'],
  'functions/api/auth/session.ts': ['onRequestPost'],
  'functions/api/auth/signout.ts': ['onRequestPost'],
  'functions/api/auth/delete.ts': ['onRequestPost'],
  'functions/api/sync/index.ts': ['onRequestGet', 'onRequestPut'],
  'functions/api/sync/replace.ts': ['onRequestPut'],
}

describe('accounts routes', () => {
  it('public/_routes.json sends /api/auth/*, /api/sync and /api/sync/* to Functions', () => {
    const routes = JSON.parse(readFileSync(join(root, 'public/_routes.json'), 'utf8')) as { include: string[] }
    for (const path of ['/api/auth/*', '/api/sync', '/api/sync/*']) expect(routes.include).toContain(path)
  })

  it('functions/ holds exactly these account and sync routes', () => {
    expect(files(join(root, 'functions')).filter((file) => !file.startsWith('functions/api/google/')).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('%s exports only %j', async (file, methods) => {
    expect(Object.keys(await import(/* @vite-ignore */ join(root, file))).sort()).toEqual([...methods].sort())
  })
})

type Adapter = (ctx: AccountsPagesContext) => Promise<Response>

describe('each Pages adapter reaches its own handler', () => {
  const env = (extra: object = {}) => {
    const DB = sqliteD1()
    migrate(DB as never)
    return { APP_ORIGIN: APP, ACCOUNTS_ENABLED: '1', SYNC_KEY, VITE_GOOGLE_CLIENT_ID: FAKE_ID.clientId, GOOGLE_CLIENT_SECRET: FAKE_ID.clientSecret, DB, ...extra }
  }
  const write = (path: string, method: string, body?: unknown) => new Request(`${APP}${path}`, {
    method,
    headers: { 'x-weeklid': '1', origin: APP, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const adapter = async (file: string, method: string): Promise<Adapter> => ((await import(/* @vite-ignore */ join(root, file))) as Record<string, Adapter>)[method]!
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

  it('start: 200 with an authorization URL for the identity scopes and the flow cookie', async () => {
    const response = await (await adapter('functions/api/auth/start.ts', 'onRequestPost'))({ request: write('/api/auth/start', 'POST', { consent: 1 }), env: env() })
    expect(response.status).toBe(200)
    const url = new URL(((await response.json()) as { url: string }).url)
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(response.headers.getSetCookie()).toHaveLength(1)
    expect(routeOf()).toBe('auth.start')
  })

  it('session: signed out', async () => {
    const response = await (await adapter('functions/api/auth/session.ts', 'onRequestPost'))({ request: write('/api/auth/session', 'POST'), env: env() })
    expect(await response.json()).toEqual({ signedIn: false })
    expect(routeOf()).toBe('auth.session')
  })

  it('signout and delete reach their own handlers', async () => {
    const out = await (await adapter('functions/api/auth/signout.ts', 'onRequestPost'))({ request: write('/api/auth/signout', 'POST'), env: env() })
    expect(out.status).toBe(200)
    expect(routeOf()).toBe('auth.signout')
    const del = await (await adapter('functions/api/auth/delete.ts', 'onRequestPost'))({ request: write('/api/auth/delete', 'POST', { accountKey: 'A'.repeat(43) }), env: env() })
    expect(del.status).toBe(401)
    expect(routeOf()).toBe('auth.delete')
  })

  it('callback: a GET without state → 303 to the app with the state result', async () => {
    const response = await (await adapter('functions/api/auth/callback.ts', 'onRequestGet'))({ request: new Request(`${APP}/api/auth/callback?code=x`), env: env() })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${APP}/?account=state#/settings/account`)
    expect(routeOf()).toBe('auth.callback')
  })

  it('sync: GET, PUT and replace reach their own handlers', async () => {
    const key = 'A'.repeat(43)
    const get = await (await adapter('functions/api/sync/index.ts', 'onRequestGet'))({
      request: new Request(`${APP}/api/sync`, { headers: { 'x-weeklid': '1', 'x-weeklid-account': key } }), env: env(),
    })
    expect(get.status).toBe(401)
    expect(routeOf()).toBe('sync.get')
    const put = await (await adapter('functions/api/sync/index.ts', 'onRequestPut'))({ request: write('/api/sync', 'PUT', { accountKey: key, baseRevision: 0, epoch: 0, document: {} }), env: env() })
    expect(put.status).toBe(401)
    expect(routeOf()).toBe('sync.put')
    const replace = await (await adapter('functions/api/sync/replace.ts', 'onRequestPut'))({ request: write('/api/sync/replace', 'PUT', { accountKey: key, document: {} }), env: env() })
    expect(replace.status).toBe(401)
    expect(routeOf()).toBe('sync.replace')
  })

  it('with no variables every adapter answers 404 and never touches the network', async () => {
    for (const [file, methods] of Object.entries(EXPECTED)) {
      for (const method of methods) {
        const path = file.replace('functions', '').replace('/index.ts', '').replace('.ts', '')
        const response = await (await adapter(file, method))({
          request: new Request(`${APP}${path}`, { method: method === 'onRequestGet' ? 'GET' : method === 'onRequestPut' ? 'PUT' : 'POST', headers: { 'x-weeklid': '1', origin: APP, 'content-type': 'application/json' } }),
          env: {},
        })
        expect(response.status, `${file} ${method}`).toBe(404)
      }
    }
  })
})
