import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { BrowserPlannerRepository } from './BrowserPlannerRepository'
import { BrowserProposalRepository } from './BrowserProposalRepository'
import { broadcastChangeChannel } from './changeChannel'
import { IndexedDbStore } from './indexedDbStore'
import { webLockRunner } from './storageCommit'

export type BrowserRepositories = ReturnType<typeof buildBrowserRepositories>

function buildBrowserRepositories() {
  const runExclusive = webLockRunner(typeof navigator === 'undefined' ? undefined : navigator.locks)
  const clock = {
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  }
  // Construction has no side effects: nothing opens IndexedDB until a repository is used.
  const store = new IndexedDbStore()
  const channel = broadcastChangeChannel()
  const calendarTexts = new IndexedDbCalendarSourceStore()
  return {
    calendarTexts,
    planner: new BrowserPlannerRepository({
      store,
      legacy: window.localStorage,
      runExclusive,
      channel,
      events: window,
      visibility: { target: document, visible: () => document.visibilityState === 'visible' },
      calendarTexts,
      ...clock,
      locale: () => window.localStorage.getItem('next168-language') ?? navigator.language.split('-')[0] ?? 'en',
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    proposals: new BrowserProposalRepository({ store, runExclusive, channel, ...clock }),
  }
}

let repositories: BrowserRepositories | undefined

// One store, one lock runner, one channel and one calendar text store per page.
export function createBrowserRepositories(): BrowserRepositories {
  return (repositories ??= buildBrowserRepositories())
}
