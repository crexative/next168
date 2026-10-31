// Composition root for the Pages adapters in functions/: the real clock, randomness, fetch, log and D1 store.
import { readConfig, type GoogleEnv, type TestFault } from './config'
import { d1ConnectionStore, type ConnectionStore } from './connectionStore'
import { systemRandom } from './crypto'
import type { Deps } from './handlers'

export interface PagesContext {
  request: Request
  env: GoogleEnv
}

export const GOOGLE_DEADLINE_MS = 8_000
export const REVOKE_DEADLINE_MS = 5_000

// The e2e harness's injected storage failure (E-5); config.ts honours it only beside a `.test` OAuth origin.
function withTestFault(store: ConnectionStore, fault: TestFault | null): ConnectionStore {
  if (fault !== 'disconnect') return store
  return { ...store, disconnect: () => Promise.reject(new Error('injected test fault')) }
}

export function deps(env: GoogleEnv): Deps {
  const config = readConfig(env)
  return {
    config,
    store: config.base ? withTestFault(d1ConnectionStore(config.base.db), config.testFault) : null,
    fetch: (input, init) => fetch(input, init),
    random: systemRandom,
    now: () => Date.now(),
    log: (line) => console.log(line),
    deadlines: { googleMs: GOOGLE_DEADLINE_MS, revokeMs: REVOKE_DEADLINE_MS },
  }
}
