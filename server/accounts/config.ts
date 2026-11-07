// Configuration read from the Pages environment on every request. Nothing here has a default that turns accounts on:
// with ACCOUNTS_ENABLED unset every account route answers 404 and touches nothing.
import { GOOGLE_CLIENT_ID_PATTERN } from '../../config/googleClientId'
import { TEST_ORIGIN_PATTERN } from '../google/config'
import type { D1Like } from '../google/connectionStore'
import { fromBase64 } from '../google/crypto'

export interface AccountsEnv {
  APP_ORIGIN?: string
  VITE_GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  ACCOUNTS_ENABLED?: string
  SYNC_KEY?: string
  GOOGLE_OAUTH_TEST_ORIGIN?: string
  DB?: D1Like
}

export interface AccountsBase {
  clientId: string
  clientSecret: string
  syncKey: Uint8Array<ArrayBuffer>
  db: D1Like
}

export interface AccountsConfig {
  /** Null when absent or not a bare HTTPS origin: every route answers 404. */
  appOrigin: string | null
  enabled: boolean
  /** Null when any item is missing or malformed: `notConfigured`. */
  base: AccountsBase | null
  /** A fake OAuth origin for the tests; null in every real deployment. */
  googleOrigin: string | null
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

function readBase(env: AccountsEnv): AccountsBase | null {
  const clientId = env.VITE_GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID
  const syncKey = env.SYNC_KEY ? fromBase64(env.SYNC_KEY) : null
  if (!clientId || !GOOGLE_CLIENT_ID_PATTERN.test(clientId) || !env.GOOGLE_CLIENT_SECRET || syncKey?.length !== 32 || !env.DB) return null
  return { clientId, clientSecret: env.GOOGLE_CLIENT_SECRET, syncKey, db: env.DB }
}

export function readAccountsConfig(env: AccountsEnv): AccountsConfig {
  return {
    appOrigin: bareHttpsOrigin(env.APP_ORIGIN),
    enabled: env.ACCOUNTS_ENABLED === '1',
    base: readBase(env),
    googleOrigin: env.GOOGLE_OAUTH_TEST_ORIGIN && TEST_ORIGIN_PATTERN.test(env.GOOGLE_OAUTH_TEST_ORIGIN) ? env.GOOGLE_OAUTH_TEST_ORIGIN : null,
  }
}
