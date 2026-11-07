// Shared by the account and sync routes: dependencies, the admission checks, and the session cookie.
import type { RandomSource } from '../google/crypto'
import { sha256b64url } from '../google/crypto'
import {
  errorClass, failure, guardPost, readCookie, setCookie, type Clock, type Reply,
} from '../google/http'
import type { AccountsConfig, AccountsBase } from './config'
import type { AccountsStore, SessionRow } from './accountsStore'

export interface AccountsDeps extends Clock {
  config: AccountsConfig
  /** Null exactly when the base configuration is missing. */
  store: AccountsStore | null
  fetch: typeof fetch
  random: RandomSource
  deadlineMs: number
}

export const SESSION_COOKIE = '__Host-wl_ses'
export const FLOW_COOKIE = '__Host-wl_aflow'
export const SESSION_IDLE_S = 180 * 86_400
export const PENDING_TTL_S = 600
export const CONSENT_VERSION = 1
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const seconds = (deps: Clock): number => Math.floor(deps.now() / 1000)

export interface Admitted {
  base: AccountsBase
  store: AccountsStore
}

// The accounts switch comes first and answers 404: while ACCOUNTS_ENABLED is not 1 no route reveals itself or touches storage.
export function switchedOff(request: Request, config: AccountsConfig): Reply | null {
  if (!config.appOrigin || new URL(request.url).origin !== config.appOrigin || !config.enabled) return failure(404, 'notFound')
  return null
}

function guardRead(request: Request, config: AccountsConfig): Reply | null {
  if (request.headers.get('x-weeklid') !== '1') return failure(403, 'forbidden')
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== config.appOrigin) return failure(403, 'forbidden')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return failure(403, 'forbidden')
  return null
}

async function configured(deps: AccountsDeps): Promise<Admitted | Reply> {
  const { base } = deps.config
  const store = deps.store
  if (!base || !store) return failure(503, 'notConfigured')
  try {
    if (!await store.migrated()) return failure(503, 'notConfigured')
  } catch (error) {
    return failure(503, 'storage', errorClass(error))
  }
  return { base, store }
}

export const isReply = (value: Admitted | Reply): value is Reply => 'status' in value

export async function admit(request: Request, deps: AccountsDeps, options: { method: 'read' | 'write'; requireJson: boolean }): Promise<Admitted | Reply> {
  const off = switchedOff(request, deps.config)
  if (off) return off
  const stop = options.method === 'read' ? guardRead(request, deps.config) : guardPost(request, deps.config, { requireJson: options.requireJson })
  return stop ?? configured(deps)
}

export function sessionCookieOf(request: Request): string | null {
  const value = readCookie(request, SESSION_COOKIE)
  return value && TOKEN_PATTERN.test(value) ? value : null
}

export async function currentSession(request: Request, deps: AccountsDeps, store: AccountsStore): Promise<SessionRow | null> {
  const token = sessionCookieOf(request)
  if (!token) return null
  const now = seconds(deps)
  return store.session(await sha256b64url(token), now - SESSION_IDLE_S, now)
}

export const clearCookie = (name: string): string => setCookie(name, '', 0, 'Lax')

export function withCookies(reply: Reply, cookies: string[]): Reply {
  return { ...reply, headers: [...reply.headers, ...cookies.map((cookie): [string, string] => ['set-cookie', cookie])] }
}
