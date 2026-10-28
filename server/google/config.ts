// Configuration read from the Pages environment on every request. Every value is set by the owner in the Cloudflare
// dashboard, Production only (§4.2); nothing here has a default that turns the server on.
import { GOOGLE_CLIENT_ID_PATTERN } from '../../config/googleClientId'
import type { D1Like } from './connectionStore'
import { fromBase64 } from './crypto'

export interface GoogleEnv {
  APP_ORIGIN?: string
  VITE_GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_TOKEN_KEY?: string
  GOOGLE_SERVER_ENABLED?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_OAUTH_TEST_ORIGIN?: string
  GOOGLE_TEST_FAULT?: string
  DB?: D1Like
}

// The test-only overrides are honoured only for a `.test` origin, which no public DNS name can have.
export const TEST_ORIGIN_PATTERN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.test:\d{2,5}$/

export type TestFault = 'disconnect'
const TEST_FAULTS: readonly TestFault[] = ['disconnect']

export interface BaseConfig {
  clientId: string
  tokenKey: Uint8Array<ArrayBuffer>
  db: D1Like
}

export interface Config {
  /** Null when absent or not a bare HTTPS origin: every route answers 404. */
  appOrigin: string | null
  enabled: boolean
  /** Null when any base item is missing or malformed: `notConfigured`. */
  base: BaseConfig | null
  /** Null in canary mode: the code is never exchanged, and mints answer `notConfigured`. */
  clientSecret: string | null
  /** A fake OAuth origin for the server e2e harness; null in every real deployment. */
  googleOrigin: string | null
  testFault: TestFault | null
}

function bareHttpsOrigin(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.origin === raw ? raw : null
  } catch {
    return null
  }
}

function readBase(env: GoogleEnv): BaseConfig | null {
  const clientId = env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID
  const tokenKey = env.GOOGLE_TOKEN_KEY ? fromBase64(env.GOOGLE_TOKEN_KEY) : null
  if (!clientId || !GOOGLE_CLIENT_ID_PATTERN.test(clientId) || tokenKey?.length !== 32 || !env.DB) return null
  return { clientId, tokenKey, db: env.DB }
}

export function readConfig(env: GoogleEnv): Config {
  const googleOrigin = env.GOOGLE_OAUTH_TEST_ORIGIN && TEST_ORIGIN_PATTERN.test(env.GOOGLE_OAUTH_TEST_ORIGIN) ? env.GOOGLE_OAUTH_TEST_ORIGIN : null
  const fault = googleOrigin ? TEST_FAULTS.find((name) => name === env.GOOGLE_TEST_FAULT) ?? null : null
  return {
    appOrigin: bareHttpsOrigin(env.APP_ORIGIN),
    enabled: env.GOOGLE_SERVER_ENABLED === '1',
    base: readBase(env),
    clientSecret: env.GOOGLE_CLIENT_SECRET || null,
    googleOrigin,
    testFault: fault,
  }
}
