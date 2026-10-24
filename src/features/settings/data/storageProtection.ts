// The browser may clear a site's storage under pressure unless it is asked to keep it. Asking is held back until
// the first check-in: before that there is little worth protecting, and a prompt out of nowhere is noise.
export const PERSIST_REQUESTED_KEY = 'next168-persist-requested'

export function shouldRequestPersistence(input: { checkIns: number; requested: boolean }): boolean {
  return input.checkIns > 0 && !input.requested
}

export function persistenceAlreadyRequested(storage: Pick<Storage, 'getItem'> = window.localStorage): boolean {
  try {
    return storage.getItem(PERSIST_REQUESTED_KEY) !== null
  } catch {
    return false
  }
}

// Best effort: a browser without the API, or one that refuses, simply leaves the status at "Not yet" in Settings.
export async function requestPersistentStorage(storage: Pick<Storage, 'setItem'> = window.localStorage): Promise<boolean | null> {
  try {
    storage.setItem(PERSIST_REQUESTED_KEY, new Date().toISOString())
  } catch {
    // Not remembering only means asking again next visit.
  }
  try {
    return (await navigator.storage?.persist?.()) ?? null
  } catch {
    return null
  }
}
