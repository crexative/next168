import { calendarMode, type CalendarMode } from './icsFetcher'

// Google Calendar is a labs feature while the OAuth app is in Google's testing mode: a device opts in by opening the
// app once with ?labs=google-calendar. "Delete all data" removes the flag with every other `next168-` key.
export const GOOGLE_LABS_KEY = 'next168-labs-google'
export const GOOGLE_LABS_PARAM = 'google-calendar'

export interface GoogleGateInput {
  clientId: string | undefined
  mode: CalendarMode
  labs: boolean
  secure: boolean
}

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>

function deviceStorage(): FlagStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function readLabsFlag(storage: FlagStorage | undefined = deviceStorage()): boolean {
  try { return storage?.getItem(GOOGLE_LABS_KEY) === '1' } catch { return false }
}

// The companion serves the app from an origin Google does not know, and its calendars are shared by every paired
// browser while this connection lives in one tab: the feature stays off there.
export function googleConnectionEnabled(input: GoogleGateInput = currentGateInput()): boolean {
  return Boolean(input.clientId) && input.mode !== 'companion' && input.labs && input.secure
}

export function currentGateInput(): GoogleGateInput {
  return {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    mode: calendarMode(),
    labs: readLabsFlag(),
    secure: typeof isSecureContext !== 'undefined' && isSecureContext,
  }
}

// Opening the app with ?labs=google-calendar turns the flag on for this device and drops the parameter from the
// address, so it is not bookmarked or shared along with the page.
export function captureLabsFlag(location: Pick<Location, 'href'> | undefined = globalThis.location, history: Pick<History, 'replaceState'> | undefined = globalThis.history, storage: FlagStorage | undefined = deviceStorage()): void {
  if (!location) return
  const url = new URL(location.href)
  if (url.searchParams.get('labs') !== GOOGLE_LABS_PARAM) return
  try { storage?.setItem(GOOGLE_LABS_KEY, '1') } catch { /* storage blocked: the feature stays off */ }
  url.searchParams.delete('labs')
  try { history?.replaceState(history && 'state' in history ? (history as History).state : null, '', url.href) } catch { /* the address keeps the parameter */ }
}
