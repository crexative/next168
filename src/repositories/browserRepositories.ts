import { LocalStorageProposalRepository } from './LocalStorageProposalRepository'
import { LocalStorageRepository } from './LocalStorageRepository'
import { webLockRunner } from './storageCommit'

export function createBrowserRepositories() {
  const runExclusive = webLockRunner(typeof navigator === 'undefined' ? undefined : navigator.locks)
  const clock = {
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }
  return {
    planner: new LocalStorageRepository({
      storage: window.localStorage,
      runExclusive,
      events: window,
      ...clock,
      locale: () => window.localStorage.getItem('next168-language') ?? navigator.language.split('-')[0] ?? 'en',
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    proposals: new LocalStorageProposalRepository({ storage: window.localStorage, runExclusive, ...clock }),
  }
}
