// Composition root for the Pages adapters in functions/: the real clock, randomness, fetch, log and D1 store.
import { systemRandom } from '../google/crypto'
import { d1AccountsStore } from './accountsStore'
import { readAccountsConfig, type AccountsEnv } from './config'
import type { AccountsDeps } from './session'

export interface AccountsPagesContext {
  request: Request
  env: AccountsEnv
}

export const GOOGLE_DEADLINE_MS = 8_000

export function accountsDeps(env: AccountsEnv): AccountsDeps {
  const config = readAccountsConfig(env)
  return {
    config,
    store: config.base ? d1AccountsStore(config.base.db) : null,
    fetch: (input, init) => fetch(input, init),
    random: systemRandom,
    now: () => Date.now(),
    log: (line) => console.log(line),
    deadlineMs: GOOGLE_DEADLINE_MS,
  }
}
