import { LANGUAGE_KEY } from '@/i18n'

type KeyValueStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>

// Every key this app keeps in the browser's key-value storage starts with this prefix: preferences, reminders, the
// "plan since" stamp of each workspace, the setup's draft and dismissal, and the legacy planner of older builds.
export const DEVICE_KEY_PREFIX = 'next168-'
// The language stays: the page goes on speaking it, and it says nothing about the deleted planner.
const KEPT_AFTER_DELETE_ALL = new Set([LANGUAGE_KEY])

// "Delete all data" removes everything of the deleted planner from this device, by prefix, so a key added later (or one
// named after a workspace) cannot be left behind. Returns the keys removed.
export function removeDeviceData(storage: KeyValueStorage | undefined): string[] {
  if (!storage) return []
  const doomed: string[] = []
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && key.startsWith(DEVICE_KEY_PREFIX) && !KEPT_AFTER_DELETE_ALL.has(key)) doomed.push(key)
    }
  } catch {
    return []
  }
  return doomed.filter((key) => {
    try { storage.removeItem(key); return true } catch { return false }
  })
}

export function deviceStorages(): KeyValueStorage[] {
  const storages: KeyValueStorage[] = []
  try { if (typeof localStorage !== 'undefined') storages.push(localStorage) } catch { /* blocked */ }
  try { if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage) } catch { /* blocked */ }
  return storages
}
