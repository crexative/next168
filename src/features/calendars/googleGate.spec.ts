import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_LABS_KEY, captureLabsFlag, googleConnectionEnabled, googleTokenSource, readLabsFlag, type GoogleGateInput, type SourceInput, type TokenSource } from './googleGate'

// The gate (Slice 1 spec §3, acceptance A2): the feature exists only with a client ID, outside companion mode, with the
// device's labs flag and in a secure context.
const all: GoogleGateInput = { clientId: '000000000000-e2etest.apps.googleusercontent.com', mode: 'browser', labs: true, secure: true }

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, values }
}

describe('googleConnectionEnabled', () => {
  it('is true only when all four conditions hold', () => {
    expect(googleConnectionEnabled(all)).toBe(true)
  })

  it.each([
    ['without a client ID', { clientId: undefined }],
    ['with an empty client ID', { clientId: '' }],
    ['in companion mode', { mode: 'companion' as const }],
    ['without the labs flag', { labs: false }],
    ['outside a secure context', { secure: false }],
  ])('is false %s', (_, change) => {
    expect(googleConnectionEnabled({ ...all, ...change })).toBe(false)
  })
})

describe('the labs flag', () => {
  it('is set by ?labs=google-calendar, which then leaves the address', () => {
    const storage = memoryStorage()
    const replaceState = vi.fn()
    captureLabsFlag({ href: 'https://weeklid.crexative.com/?labs=google-calendar#/week' }, { replaceState }, storage)
    expect(storage.values.get(GOOGLE_LABS_KEY)).toBe('1')
    expect(readLabsFlag(storage)).toBe(true)
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://weeklid.crexative.com/#/week')
  })

  it('ignores any other labs value and a page without the parameter', () => {
    const storage = memoryStorage()
    const replaceState = vi.fn()
    captureLabsFlag({ href: 'https://weeklid.crexative.com/?labs=other' }, { replaceState }, storage)
    captureLabsFlag({ href: 'https://weeklid.crexative.com/#/week' }, { replaceState }, storage)
    expect(readLabsFlag(storage)).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('is a next168- key, so Delete all data removes it with the rest', () => {
    expect(GOOGLE_LABS_KEY.startsWith('next168-')).toBe(true)
  })
})

// A-14, second half: the token source over design 2.1 and the three valid flag rows.
describe('googleTokenSource', () => {
  const CHROME_BRANDS = ['Not A;Brand', 'Chromium', 'Google Chrome']
  const UA = {
    desktopChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    firefoxWebView: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0; wv) Gecko/130.0 Firefox/130.0',
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/130.0.0.0 Mobile/15E148 Safari/604.1',
    iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
    iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Instagram 300.0.0',
    iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
    iphoneGmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 GSA/300.0',
    iphoneBareWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  }
  const tab: SourceInput = {
    server: true, installedServer: false, topLevel: true, browserDisplay: true, installedDisplay: false, navigatorStandalone: false,
    referrer: '', userAgent: UA.desktopChrome, brands: CHROME_BRANDS,
  }
  const sourceOf = (change: Partial<SourceInput>): TokenSource => googleTokenSource({ ...tab, ...change })

  it.each([
    ['desktop Chrome', { userAgent: UA.desktopChrome, brands: CHROME_BRANDS }],
    ['desktop or Android Edge', { userAgent: UA.androidChrome, brands: ['Chromium', 'Microsoft Edge'] }],
    ['Android Chrome', { userAgent: UA.androidChrome, brands: CHROME_BRANDS }],
    ['Firefox', { userAgent: UA.firefox, brands: [] }],
    ['macOS Safari', { userAgent: UA.macSafari, brands: [] }],
    ['iPhone Safari', { userAgent: UA.iphoneSafari, brands: [] }],
    ['iPhone Chrome', { userAgent: UA.iphoneChrome, brands: [] }],
    ['iPhone Edge', { userAgent: UA.iphoneEdge, brands: [] }],
    ['iPhone Firefox', { userAgent: UA.iphoneFirefox, brands: [] }],
  ])('a browser tab in %s → server', (_, change) => {
    expect(sourceOf(change)).toBe('server')
  })

  it.each([
    ['the Android WebView', { userAgent: UA.androidWebView, brands: ['Android WebView', 'Chromium'] }],
    ['a Firefox WebView', { userAgent: UA.firefoxWebView, brands: [] }],
    ['Instagram on iPhone', { userAgent: UA.iphoneInstagram, brands: [] }],
    ['Facebook on iPhone', { userAgent: UA.iphoneFacebook, brands: [] }],
    ['Gmail or Google app on iPhone', { userAgent: UA.iphoneGmail, brands: [] }],
    ['a bare iPhone WebView', { userAgent: UA.iphoneBareWebView, brands: [] }],
    ['Samsung Internet or Brave (Chromium without the allowed brands)', { userAgent: UA.androidChrome, brands: ['Chromium', 'Brave'] }],
    ['an unknown browser', { userAgent: 'Mozilla/5.0 (compatible; Odd/1.0)', brands: [] }],
    ['no user agent at all', { userAgent: '', brands: [] }],
    ['Instagram even with a Chrome brand', { userAgent: UA.iphoneInstagram, brands: CHROME_BRANDS }],
    ['a frame', { topLevel: false }],
    ['a window that is not a browser tab', { browserDisplay: false }],
    ['a home-screen app, without the installed flag', { browserDisplay: false, navigatorStandalone: true, userAgent: UA.iphoneSafari, brands: [] }],
    ['a tab with navigator.standalone', { navigatorStandalone: true }],
    ['a Trusted Web Activity', { referrer: 'android-app://com.example.twa' }],
  ])('%s → gis', (_, change) => {
    expect(sourceOf(change)).toBe('gis')
  })

  it('a build without the server flag is gis in every context', () => {
    expect(sourceOf({ server: false })).toBe('gis')
    expect(sourceOf({ server: false, installedServer: true, navigatorStandalone: true })).toBe('gis')
  })

  describe('installed apps', () => {
    const iosApp: Partial<SourceInput> = { browserDisplay: false, installedDisplay: true, navigatorStandalone: true, userAgent: UA.iphoneSafari, brands: [] }
    const androidApp: Partial<SourceInput> = { browserDisplay: false, installedDisplay: true, userAgent: UA.androidChrome, brands: CHROME_BRANDS }

    it.each([['an iPhone home-screen app', iosApp], ['an Android or desktop installed Chrome app', androidApp]])('%s → gis without INSTALLED', (_, change) => {
      expect(sourceOf({ ...change, installedServer: false })).toBe('gis')
    })

    it.each([['an iPhone home-screen app', iosApp], ['an Android or desktop installed Chrome app', androidApp]])('%s → server with INSTALLED', (_, change) => {
      expect(sourceOf({ ...change, installedServer: true })).toBe('server')
    })

    it('an installed context with another brand → gis even with INSTALLED', () => {
      expect(sourceOf({ ...androidApp, installedServer: true, brands: ['Chromium', 'Brave'] })).toBe('gis')
      expect(sourceOf({ ...androidApp, installedServer: true, brands: [] })).toBe('gis')
    })

    it('an installed app in a frame → gis', () => {
      expect(sourceOf({ ...iosApp, installedServer: true, topLevel: false })).toBe('gis')
    })

    it('INSTALLED never admits a plain tab that the allowlist excludes', () => {
      expect(sourceOf({ installedServer: true, userAgent: UA.iphoneInstagram, brands: [] })).toBe('gis')
    })
  })
})

describe('the address Google returns to', () => {
  const run = async (href: string) => {
    const replaceState = vi.fn()
    const gate = await import('./googleGate')
    gate.captureGoogleReturn({ href }, { replaceState })
    return { replaceState, taken: gate.takeGoogleReturn() }
  }

  it('reads the result once and drops the parameter from the address, keeping the hash', async () => {
    const { replaceState, taken } = await run('https://weeklid.crexative.com/?google=connected#/settings/calendars')
    expect(taken).toBe('connected')
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://weeklid.crexative.com/#/settings/calendars')
    const gate = await import('./googleGate')
    expect(gate.takeGoogleReturn()).toBeUndefined()
  })

  it('drops an unknown value without keeping it', async () => {
    const { replaceState, taken } = await run('https://weeklid.crexative.com/?google=%3Cscript%3E#/week')
    expect(taken).toBeUndefined()
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://weeklid.crexative.com/#/week')
  })

  it('leaves an address without the parameter alone', async () => {
    const { replaceState, taken } = await run('https://weeklid.crexative.com/#/week')
    expect(taken).toBeUndefined()
    expect(replaceState).not.toHaveBeenCalled()
  })
})
