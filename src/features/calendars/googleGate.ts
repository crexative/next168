import { calendarMode, type CalendarMode } from './icsFetcher'

// Google Calendar is a labs feature while the OAuth app is in Google's testing mode: a device opts in by opening the
// app once with ?labs=google-calendar. "Delete all data" removes the flag with every other `next168-` key.
export const GOOGLE_LABS_KEY = 'next168-labs-google'
export const GOOGLE_LABS_PARAM = 'google-calendar'
export const PERMISSIONS_URL = 'https://myaccount.google.com/connections'

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

// --- Which token source this tab uses (design S1b 2.1) -------------------------------------------------------------
// The Weeklid server source is used only where a person's Google sign-in round trip is known to come back to the same
// storage and cookies; everything else stays on Google Identity Services. The choice is a pure function of the build
// flags and these signals, and it fails safe: anything not positively recognised is `gis`.

export type TokenSource = 'gis' | 'server'

export interface SourceInput {
  server: boolean
  installedServer: boolean
  topLevel: boolean
  browserDisplay: boolean
  installedDisplay: boolean
  navigatorStandalone: boolean
  referrer: string
  userAgent: string
  brands: readonly string[]
}

// Markers that in-app browsers add to an otherwise Safari-like iPhone or Android user agent.
const IN_APP_MARKERS = /FBAN|FBAV|Instagram|GSA\/|Line\/|WhatsApp/
const CHROMIUM_BRANDS = ['Google Chrome', 'Microsoft Edge', 'Brave']
const INSTALLED_CHROMIUM_BRANDS = ['Google Chrome', 'Microsoft Edge']

const hasChromiumBrand = (brands: readonly string[]): boolean => brands.some((brand) => CHROMIUM_BRANDS.includes(brand))
const hasInstalledChromiumBrand = (brands: readonly string[]): boolean => brands.some((brand) => INSTALLED_CHROMIUM_BRANDS.includes(brand))

function allowedBrowser({ userAgent: ua, brands }: SourceInput): boolean {
  if (IN_APP_MARKERS.test(ua)) return false
  if (/Opera Mini\//i.test(ua) || /DuckDuckGo\//.test(ua)) return false
  if (hasChromiumBrand(brands)) return true
  if (/Firefox\//.test(ua)) return !/; wv\)/.test(ua)
  if (/Edg\/|EdgA\/|OPR\/|YaBrowser\/|UCBrowser\/|SamsungBrowser\//.test(ua)) return true
  if (/iPhone|iPad|iPod/.test(ua)) return /Safari\//.test(ua) && /Version\/|CriOS\/|EdgiOS\/|FxiOS\/|Brave\b|OPT\//.test(ua)
  return /Version\//.test(ua) && /Safari\//.test(ua) && !/Chrome\//.test(ua)
}

export function googleTokenSource(input: SourceInput = currentSourceInput()): TokenSource {
  if (!input.server || !input.topLevel) return 'gis'
  const browserTab = input.browserDisplay && !input.navigatorStandalone && !input.referrer.startsWith('android-app://') && allowedBrowser(input)
  const installedApp = input.installedServer && (input.navigatorStandalone || (input.installedDisplay && hasInstalledChromiumBrand(input.brands)))
  return browserTab || installedApp ? 'server' : 'gis'
}

/** Whether the build keeps no Google data on the device in any context (VITE_GOOGLE_SERVER=1). */
export const googleServerBuild = (): boolean => import.meta.env.VITE_GOOGLE_SERVER === '1'

function matches(query: string): boolean {
  try { return typeof matchMedia === 'function' && matchMedia(query).matches } catch { return false }
}

function isTopLevel(): boolean {
  try { return window.top === window } catch { return false }
}

export function currentSourceInput(): SourceInput {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { standalone?: boolean; userAgentData?: { brands?: { brand: string }[] } })
  return {
    server: googleServerBuild(),
    installedServer: import.meta.env.VITE_GOOGLE_SERVER_INSTALLED === '1',
    topLevel: isTopLevel(),
    browserDisplay: matches('(display-mode: browser)'),
    installedDisplay: ['standalone', 'minimal-ui', 'fullscreen'].some((mode) => matches(`(display-mode: ${mode})`)),
    navigatorStandalone: nav?.standalone === true,
    referrer: typeof document === 'undefined' ? '' : document.referrer,
    userAgent: nav?.userAgent ?? '',
    brands: nav?.userAgentData?.brands?.map((entry) => entry.brand) ?? [],
  }
}

/** An installed app of any kind: the context that keeps `gis` until gate G-1 passes. */
export const isInstalledContext = (input: SourceInput = currentSourceInput()): boolean => input.navigatorStandalone || input.installedDisplay

// --- The address Google sends the person back to ------------------------------------------------------------------------
// The server's callback ends at `/?google=<result>#/settings/calendars`. The parameter is read once and dropped from the
// address, so it is not bookmarked, shared or replayed by a reload.

export const GOOGLE_RETURN_PARAM = 'google'
const GOOGLE_RETURN_RESULTS = [
  'connected', 'denied', 'auth', 'state', 'cancelled', 'exchange', 'noRefreshToken', 'missingScope', 'storage', 'disabled',
  'notConfigured', 'canary', 'error',
] as const
export type GoogleReturnResult = (typeof GOOGLE_RETURN_RESULTS)[number]

let captured: GoogleReturnResult | undefined

export function captureGoogleReturn(location: Pick<Location, 'href'> | undefined = globalThis.location, history: Pick<History, 'replaceState'> | undefined = globalThis.history): void {
  if (!location) return
  const url = new URL(location.href)
  const raw = url.searchParams.get(GOOGLE_RETURN_PARAM)
  if (raw === null) return
  captured = (GOOGLE_RETURN_RESULTS as readonly string[]).includes(raw) ? (raw as GoogleReturnResult) : undefined
  url.searchParams.delete(GOOGLE_RETURN_PARAM)
  try { history?.replaceState(history && 'state' in history ? (history as History).state : null, '', url.href) } catch { /* the address keeps the parameter */ }
}

/** The result captured at startup, once. */
export function takeGoogleReturn(): GoogleReturnResult | undefined {
  const result = captured
  captured = undefined
  return result
}
