import { expect as baseExpect, test, type BrowserContext, type Page } from '@playwright/test'
import { onlyProject, openTab, seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'
import {
  SAVED_GOOGLE_DATABASE, cachedUrls, everythingStored, expectNoStrayGoogleTraffic, fakeGoogle, gisRecord, savedGoogleCopy, withPrivateFields,
  type CalendarEvent, type GoogleFake,
} from './support/googleCalendar'
import { AUTH_URL, fakeGoogleServer, newWorld, type GoogleServerFake, type World } from './support/googleServer'
import { previewPorts } from './support/ports'

// Google Calendar through the Weeklid server (design S1b): acceptance A-3 to A-11 and A-13 over the build with
// VITE_GOOGLE_SERVER=1. Google and the Weeklid server are faked at their real addresses (support/googleCalendar.ts,
// support/googleServer.ts); the contexts are made to match the allowlist of design 2.1.

// CI runs every spec in parallel on shared runners; these flows cross two servers and several tabs.
const expect = baseExpect.configure({ timeout: 15_000 })

const NOW = new Date('2026-10-19T12:00:00.000Z')
const TUESDAY = '2026-10-20'
const STANDUP: CalendarEvent = withPrivateFields({ id: 'evt-standup', summary: 'Standup GCal', start: { dateTime: `${TUESDAY}T09:30:00Z` }, end: { dateTime: `${TUESDAY}T10:00:00Z` } })
const PRIVATE = ['ana.private@example.com', 'owner@example.com', 'Secret agenda description', 'Hidden Office 42', 'meet.google.com']
const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }
const DOCUMENT = { categories: [WORK] }
const LABS = './?labs=google-calendar'
const PERMISSIONS = 'https://myaccount.google.com/connections'
const SERVER_BASE = `http://127.0.0.1:${previewPorts().server}/`
const TWO_HOURS = 2 * 3600 * 1000

test.use({ baseURL: SERVER_BASE, serviceWorkers: 'block', launchOptions: { args: ['--disable-features=WebGPU'] } })

interface Rig { context: BrowserContext; page: Page; google: GoogleFake; server: GoogleServerFake; console: string[] }

let rigs: Rig[] = []
let opened: Page[] = []

// Chrome's own brand, which the allowlist admits; the bundled Chromium reports "Chromium".
function browserTabChrome(): void {
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { brands: [{ brand: 'Google Chrome', version: '130' }, { brand: 'Chromium', version: '130' }], mobile: false, platform: 'macOS' } })
}

// An installed app: the window is not a browser tab, so the allowlist keeps it on Google Identity Services.
function installedApp(): void {
  const original = window.matchMedia.bind(window)
  window.matchMedia = (query: string) => {
    const real = original(query)
    const mode = /display-mode:\s*(\w[\w-]*)/.exec(query)?.[1]
    if (!mode) return real
    return { matches: mode === 'standalone', media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList
  }
}

function networkSwitch(): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !(window as unknown as { __offline?: boolean }).__offline })
}

async function newRig(context: BrowserContext, world: World, options: { device?: string; kind?: 'tab' | 'installed'; connected?: boolean; page?: Page } = {}): Promise<Rig> {
  const device = options.device ?? 'device'
  const installed = options.kind === 'installed'
  await context.addInitScript(browserTabChrome)
  await context.addInitScript(networkSwitch)
  if (installed) await context.addInitScript(installedApp)
  // Google judges tokens by what the server fake issued, which is registered right after it.
  const issued = new Set<GoogleServerFake>()
  const google = await fakeGoogle(context, { events: [STANDUP], authorize: installed ? undefined : (token) => [...issued].some((fake) => fake.tokenIsValid(token)) })
  const server = await fakeGoogleServer(context, world, device)
  issued.add(server)
  server.connected = options.connected ?? false
  const page = options.page ?? await context.newPage()
  const rig: Rig = { context, page, google, server, console: [] }
  page.on('console', (message) => rig.console.push(message.text()))
  rigs.push(rig)
  return rig
}

async function boot(page: Page, planner: Record<string, unknown> = DOCUMENT, options: { hash?: string; url?: string } = {}): Promise<void> {
  await page.clock.install({ time: NOW })
  await page.addInitScript(() => {
    const seen: unknown[] = []
    Object.assign(window, { __cspViolations: seen })
    document.addEventListener('securitypolicyviolation', (event) => { seen.push({ directive: event.violatedDirective, blocked: event.blockedURI }) })
  })
  await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ workspaceId: 'ws-google', ...planner })))
  await page.goto(`${options.url ?? LABS}${options.hash ?? '#/settings/calendars'}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
  opened.push(page)
}

const connectedTo = (page: Page, count = 1) => expect(page.getByTestId('google-status')).toContainText(count === 1 ? '1 event' : `${count} events`)
const standupOverlay = (page: Page) => page.locator(`.day-column[data-date="${TUESDAY}"] [data-testid=busy-overlay]`).filter({ hasText: 'Standup GCal' })
const source = (page: Page) => page.getByTestId('google-details').locator('dt', { hasText: 'Connection source' }).locator('xpath=following-sibling::dd[1]')
const week = async (page: Page) => {
  await page.evaluate(() => { location.hash = '#/week' })
  await expect(page.getByRole('heading', { level: 1, name: 'Week' })).toBeVisible()
}
const calendars = async (page: Page) => {
  await page.evaluate(() => { location.hash = '#/settings/calendars' })
  await expect(page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
}
const goOffline = (page: Page) => page.evaluate(() => { (window as unknown as { __offline: boolean }).__offline = true; window.dispatchEvent(new Event('offline')) })
const goOnline = (page: Page) => page.evaluate(() => { (window as unknown as { __offline: boolean }).__offline = false; window.dispatchEvent(new Event('online')) })

// The callback is simulated: the server fake commits the consent, then the page returns to the address the real callback uses.
async function returnFromGoogle(rig: Rig, result = 'connected'): Promise<void> {
  if (result === 'connected') rig.server.completeConsent()
  await rig.page.goto(`./?google=${result}#/settings/calendars`)
  await expect(rig.page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
}

async function disconnect(page: Page): Promise<void> {
  await page.getByTestId('google-disconnect').click()
  await page.getByTestId('google-disconnect-confirm').click()
}

async function nothingStored(rig: Rig, extra: string[] = []): Promise<void> {
  const everything = await everythingStored(rig.page)
  for (const secret of ['Standup GCal', 'evt-standup', 'at-device', 'tok-SECRET', ...PRIVATE, ...extra]) expect(everything, secret).not.toContain(secret)
  expect(await savedGoogleCopy(rig.page)).not.toContain('Standup GCal')
  expect((await cachedUrls(rig.page)).filter((url) => /(^|\.)google(apis)?\.com$/.test(new URL(url).hostname))).toEqual([])
  for (const line of rig.console) for (const secret of ['Standup GCal', 'at-device', 'tok-SECRET']) expect(line, secret).not.toContain(secret)
}

test.beforeEach(({ browserName }, testInfo) => {
  if (testInfo.title.includes('@smoke')) test.skip(!['desktop', 'webkit-phone'].includes(testInfo.project.name), 'smoke runs on desktop and WebKit')
  else onlyProject('desktop')({ browserName }, testInfo)
})

test.afterEach(async () => {
  for (const page of opened) {
    if (page.isClosed()) continue
    expect(await page.evaluate(() => (window as unknown as { __cspViolations: unknown[] }).__cspViolations), 'CSP violations').toEqual([])
  }
  for (const rig of rigs) expectNoStrayGoogleTraffic(rig.google)
  rigs = []
  opened = []
})

test.describe('A-4 Connect', () => {
  test('goes to the server, then the whole page goes to Google; Google Identity Services never loads', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    await expect(rig.page.getByTestId('google-message')).toHaveCount(0)
    await expect.poll(() => rig.server.count('token')).toBe(1)
    await rig.page.getByTestId('google-connect').click()
    const sheet = rig.page.getByTestId('google-connect-sheet')
    await expect(sheet).toContainText('A Weeklid server keeps Google\'s permission for this device, encrypted.')
    await expect(sheet).toContainText('You\'ll go to Google and come back here.')
    await expect(sheet).toContainText('are not saved on this device')
    await expect(sheet).not.toContainText('A copy of your events is saved')
    await rig.page.getByTestId('google-continue').click()
    await rig.page.waitForURL(AUTH_URL)
    const [connect] = rig.server.requests.filter((request) => request.route === 'connect')
    expect(rig.server.count('connect')).toBe(1)
    expect(connect!.body).toEqual({ from: 'app', epoch: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) })
    expect(rig.google.gisLoads).toBe(0)
    expect(await rig.page.locator('script[src="https://accounts.google.com/gsi/client"]').count()).toBe(0)
  })

  test('another Connect uses a fresh epoch each time', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await rig.page.goto(`${LABS}#/settings/calendars`)
      await rig.page.getByTestId('google-connect').click()
      await rig.page.getByTestId('google-continue').click()
      await rig.page.waitForURL(AUTH_URL)
    }
    const epochs = rig.server.requests.filter((request) => request.route === 'connect').map((request) => request.body!.epoch)
    expect(new Set(epochs).size).toBe(2)
  })
})

test.describe('A-3 what every call looks like', () => {
  test('POST with the guard header, JSON only with a body, no credentials in headers, nothing cached', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    // What the page asked of fetch itself: the browser decides the rest of the headers.
    await context.addInitScript(() => {
      const asked: { url: string; cache: string | undefined; credentials: string | undefined }[] = []
      Object.assign(window, { __asked: asked })
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        asked.push({ url: String(input), cache: init?.cache, credentials: init?.credentials })
        return original(input, init)
      }
    })
    await boot(rig.page)
    await connectedTo(rig.page)
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    const asked = (await rig.page.evaluate(() => (window as unknown as { __asked: { url: string; cache: string; credentials: string }[] }).__asked)).filter((call) => call.url.startsWith('/api/google/'))
    expect(asked.map((call) => call.url)).toEqual(['/api/google/token', '/api/google/status', '/api/google/disconnect'])
    for (const call of asked) expect(call).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
    expect(rig.server.requests.map((request) => request.route)).toEqual(['token', 'status', 'disconnect'])
    for (const request of rig.server.requests) {
      expect(request.method).toBe('POST')
      expect(request.headers['x-weeklid']).toBe('1')
      expect(request.headers).not.toHaveProperty('authorization')
    }
    const withBody = rig.server.requests.filter((request) => request.body !== null).map((request) => request.route)
    expect(withBody).toEqual(['disconnect'])
    expect(rig.server.requests.find((request) => request.route === 'disconnect')!.headers['content-type']).toMatch(/^application\/json/)
  })

  test('without navigator.locks nothing is sent and the person is told why', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }) })
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('This browser can\'t connect Google Calendar safely.')
    expect(rig.server.requests).toEqual([])
    expect(rig.google.apiRequests).toEqual([])
  })
})

test.describe('A-5 stays connected', () => {
  test('after the return from Google and after every reload: one token and one read, no consent, the parameter stripped', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    await returnFromGoogle(rig)
    await connectedTo(rig.page)
    expect(rig.page.url()).not.toContain('google=')
    expect(rig.server.count('token')).toBe(2)
    expect(rig.google.apiRequests).toHaveLength(1)
    for (let reload = 1; reload <= 2; reload += 1) {
      await rig.page.reload()
      await connectedTo(rig.page)
      expect(rig.server.count('token')).toBe(2 + reload)
      expect(rig.google.apiRequests).toHaveLength(1 + reload)
    }
    expect(rig.server.count('connect')).toBe(0)
    expect(rig.google.gisLoads).toBe(0)
    await expect(rig.page.getByTestId('google-message')).toHaveCount(0)
    await week(rig.page)
    await expect(standupOverlay(rig.page)).toBeVisible()
  })

  test('a result other than connected only adds its message', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    await returnFromGoogle(rig, 'denied')
    await expect(rig.page.getByTestId('google-message')).toContainText('Nothing was connected.')
    await returnFromGoogle(rig, 'exchange')
    await expect(rig.page.getByTestId('google-message')).toContainText('Google didn\'t complete the connection (exchange).')
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    expect(rig.page.url()).not.toContain('google=')
  })

  test('Details names the source and the last server answer', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    await rig.page.getByTestId('google-details').locator('summary').click()
    await expect(source(rig.page)).toHaveText('server')
    await expect(rig.page.getByTestId('google-details')).toContainText('Last server answer')
  })

  test('@smoke connect once, reload, still connected (WebKit and Chromium)', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    await returnFromGoogle(rig)
    await connectedTo(rig.page)
    await rig.page.reload()
    await connectedTo(rig.page)
    expect(rig.google.gisLoads).toBe(0)
    expect(rig.server.count('connect')).toBe(0)
    await nothingStored(rig)
  })
})

test.describe('A-6 nothing Google is persisted in a server build, in either source', () => {
  test('a server tab and an installed app that stays on Google Identity Services', async ({ browser }) => {
    const world = newWorld()
    const tabContext = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const tab = await newRig(tabContext, world, { connected: true })
    await boot(tab.page)
    await connectedTo(tab.page)
    await week(tab.page)
    await expect(standupOverlay(tab.page)).toBeVisible()
    await tab.page.reload()
    await calendars(tab.page)
    await connectedTo(tab.page)
    await nothingStored(tab)
    await tab.page.getByTestId('google-details').locator('summary').click()
    await expect(source(tab.page)).toHaveText('server')

    const appContext = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const app = await newRig(appContext, world, { kind: 'installed', device: 'installed' })
    await boot(app.page)
    await app.page.getByTestId('google-details').locator('summary').click()
    await expect(source(app.page)).toHaveText('gis')
    await expect(app.page.getByTestId('google-installed-note')).toContainText('To stay connected, open Weeklid in Safari, Chrome, Edge or Firefox.')
    await app.page.getByTestId('google-connect').click()
    await expect(app.page.getByTestId('google-connect-sheet')).toContainText('your events aren\'t saved between visits')
    await expect(app.page.getByTestId('google-connect-sheet')).not.toContainText('A copy of your events is saved')
    await expect(app.page.getByTestId('google-continue')).toBeEnabled()
    await app.page.getByTestId('google-continue').click()
    await connectedTo(app.page)
    expect(app.google.gisLoads).toBe(1)
    expect(app.server.requests).toEqual([])
    await week(app.page)
    await expect(standupOverlay(app.page)).toBeVisible()
    await nothingStored(app)
    await app.page.reload()
    await expect(app.page.getByRole('heading', { level: 1, name: 'Week' })).toBeVisible()
    await expect(standupOverlay(app.page)).toHaveCount(0)
    await nothingStored(app)
    await tabContext.close()
    await appContext.close()
  })
})

test.describe('A-7 mixed modes', () => {
  async function seedGisEraCopy(page: Page): Promise<void> {
    await page.goto('./favicon.svg')
    await page.evaluate(async (name) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name, 1)
        open.onupgradeneeded = () => open.result.createObjectStore('saved')
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      const store = db.transaction('saved', 'readwrite').objectStore('saved')
      store.put({
        format: 1, workspaceId: 'ws-google', plannerGeneration: 0,
        coverage: { start: '2026-10-12', end: '2026-11-30', timeZone: 'UTC', fetchedAt: '2026-10-19T08:00:00.000Z' },
        occurrences: [{ sourceId: 'google:primary', uid: 'old-uid', title: 'Seeded Old Event', start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:00:00.000Z', allDay: false, busy: true }],
      }, 'primary')
      store.put('epoch-seed', 'epoch')
      await new Promise<void>((resolve) => { store.transaction.oncomplete = () => resolve() })
      db.close()
    }, SAVED_GOOGLE_DATABASE)
    expect(await savedGoogleCopy(page)).toContain('Seeded Old Event')
  }

  for (const kind of ['tab', 'installed'] as const) {
    test(`a seeded GIS-era copy is deleted at the boot of ${kind === 'tab' ? 'a browser tab (server source)' : 'an installed app (GIS source)'}`, async ({ context }) => {
      const rig = await newRig(context, newWorld(), { kind })
      await seedKey(rig.page, V2_KEY, JSON.stringify(onboardedDocument({ workspaceId: 'ws-google', ...DOCUMENT })))
      await seedGisEraCopy(rig.page)
      await boot(rig.page)
      await expect.poll(() => savedGoogleCopy(rig.page)).not.toContain('Seeded Old Event')
      expect(await everythingStored(rig.page)).not.toContain('Seeded Old Event')
      await week(rig.page)
      await expect(rig.page.getByText('Seeded Old Event')).toHaveCount(0)
    })
  }

  test('then the installed app connects through GIS and reads, and a reload of each context finds no copy', async ({ browser }) => {
    const world = newWorld()
    const appContext = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const app = await newRig(appContext, world, { kind: 'installed', device: 'installed' })
    await seedKey(app.page, V2_KEY, JSON.stringify(onboardedDocument({ workspaceId: 'ws-google', ...DOCUMENT })))
    await seedGisEraCopy(app.page)
    await boot(app.page)
    await app.page.getByTestId('google-connect').click()
    await expect(app.page.getByTestId('google-continue')).toBeEnabled()
    await app.page.getByTestId('google-continue').click()
    await connectedTo(app.page)
    await nothingStored(app, ['Seeded Old Event'])
    await app.page.reload()
    await expect(app.page.getByTestId('google-connect')).toBeVisible()
    await nothingStored(app, ['Seeded Old Event'])

    const tabContext = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const tab = await newRig(tabContext, world, { connected: true })
    await boot(tab.page)
    await connectedTo(tab.page)
    await tab.page.reload()
    await connectedTo(tab.page)
    await nothingStored(tab, ['Seeded Old Event'])
    await appContext.close()
    await tabContext.close()
  })
})

test.describe('A-8 offline', () => {
  test('offline at open: no request at all, Week and Today say Google needs internet; online, Update brings the events', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await context.addInitScript(() => { (window as unknown as { __offline: boolean }).__offline = true })
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('Couldn\'t reach Google.')
    await week(rig.page)
    await expect(rig.page.getByTestId('google-notice')).toContainText('Google Calendar needs internet: your tasks might land on top of meetings.')
    await openTab(rig.page, 'today')
    await expect(rig.page.getByTestId('google-notice')).toContainText('Google Calendar needs internet')
    expect(rig.server.requests).toEqual([])
    expect(rig.google.apiRequests).toEqual([])
    await calendars(rig.page)
    await rig.page.getByTestId('google-update').click()
    expect(rig.server.requests).toEqual([])
    await goOnline(rig.page)
    await rig.page.getByTestId('google-update').click()
    await connectedTo(rig.page)
    expect(rig.server.count('token')).toBe(1)
    await week(rig.page)
    await expect(standupOverlay(rig.page)).toBeVisible()
    await expect(rig.page.getByTestId('google-notice')).toHaveCount(0)
  })
})

test.describe('A-9 server answers', () => {
  for (const name of ['noDevice', 'notConnected', 'reconnect']) {
    test(`a 401 ${name} → Connect and no message when the tab never connected`, async ({ context }) => {
      const rig = await newRig(context, newWorld())
      rig.server.reply('token', { status: 401, body: { code: name } })
      await boot(rig.page)
      await expect(rig.page.getByTestId('google-connect')).toBeVisible()
      await expect(rig.page.getByTestId('google-message')).toHaveCount(0)
      expect(rig.google.apiRequests).toEqual([])
    })
  }

  test('a 5xx → serverUnavailable and Update retries; disabled → serverPaused', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    rig.server.reply('token', { status: 503, body: { code: 'storage' } })
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('Couldn\'t reach Weeklid\'s Google connection. Try again later.')
    await expect(rig.page.getByTestId('google-update')).toBeVisible()
    rig.server.reply('token', { status: 503, body: { code: 'disabled' } })
    await rig.page.getByTestId('google-update').click()
    await expect(rig.page.getByTestId('google-message')).toContainText('The Google Calendar connection is paused for now.')
    await rig.page.getByTestId('google-update').click()
    await connectedTo(rig.page)
    await expect(rig.page.getByTestId('google-message')).toHaveCount(0)
  })

  test('a network failure and an HTML answer are unavailable, never connected', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    rig.server.reply('token', 'abort')
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('Try again later.')
    expect(rig.google.apiRequests).toEqual([])
  })

  test('connected earlier in this tab, a later 401 → disconnected with the reconnect message', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    rig.server.connected = false
    await rig.page.clock.fastForward(TWO_HOURS)
    await rig.page.getByTestId('google-update').click()
    await expect(rig.page.getByTestId('google-message')).toContainText('This device is no longer connected to Google Calendar. Connect again to see your events.')
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
  })
})

test.describe('A-10 Disconnect', () => {
  test('is disabled offline, with the reason', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    await goOffline(rig.page)
    await expect(rig.page.getByTestId('google-disconnect')).toBeDisabled()
    await expect(rig.page.getByTestId('google-disconnect-offline')).toHaveText('Disconnecting needs internet.')
    await goOnline(rig.page)
    await expect(rig.page.getByTestId('google-disconnect')).toBeEnabled()
  })

  test('online: status, then disconnect with revoke and the generation; the tab forgets only after the terminal answer', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    await rig.page.getByTestId('google-disconnect').click()
    await expect(rig.page.getByRole('dialog', { name: 'Disconnect Google Calendar?' })).toContainText('Weeklid will lose access to this Google account. If you connected Weeklid with the same account on other devices, they will need to connect again.')
    const release = rig.server.hold('disconnect')
    await rig.page.getByTestId('google-disconnect-confirm').click()
    await expect.poll(() => rig.server.count('disconnect')).toBe(1)
    await connectedTo(rig.page)
    await expect(rig.page.getByTestId('google-connect')).toHaveCount(0)
    release()
    await expect(rig.page.getByTestId('google-message')).toContainText('Disconnected. Google confirmed it withdrew access.')
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    expect(rig.server.requests.map((request) => request.route)).toEqual(['token', 'status', 'disconnect'])
    expect(rig.server.requests[2]!.body).toEqual({ revoke: true, gen: 'CCCCCCCCCCCCCCCCCCCCCC.-' })
    await week(rig.page)
    await expect(standupOverlay(rig.page)).toHaveCount(0)
    await nothingStored(rig)
  })

  test('an unconfirmed revoke says so and names the permissions page', async ({ context }) => {
    const world = newWorld()
    world.revokeAnswer = 'fail'
    const rig = await newRig(context, world, { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('We couldn\'t confirm with Google that Weeklid lost access to your account')
    await expect(rig.page.getByTestId('google-permissions')).toHaveAttribute('href', PERMISSIONS)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
  })

  test('a request that does not get through leaves the tab connected, with disconnectFailed', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    rig.server.reply('disconnect', 'abort')
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('Couldn\'t disconnect: Weeklid didn\'t get an answer. You\'re still connected; try again.')
    await connectedTo(rig.page)
    await expect(rig.page.getByTestId('google-disconnect')).toBeEnabled()
    expect(rig.server.connected).toBe(true)
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
  })
})

test.describe('A-11 late results across a Disconnect', () => {
  // Two tabs of one browser (the second may lack BroadcastChannel) and, for (c), a second device on the same account.
  async function twoTabs(context: BrowserContext, world: World, broadcast: boolean): Promise<{ a: Rig; b: Rig }> {
    const a = await newRig(context, world, { connected: true })
    await boot(a.page)
    await connectedTo(a.page)
    const pageB = await context.newPage()
    if (!broadcast) await pageB.addInitScript(() => { delete (window as unknown as { BroadcastChannel?: unknown }).BroadcastChannel })
    const b: Rig = { ...a, page: pageB, console: [] }
    pageB.on('console', (message) => b.console.push(message.text()))
    await boot(pageB)
    await connectedTo(pageB)
    return { a, b }
  }

  async function afterwards(a: Rig, b: Rig): Promise<void> {
    // The next mint, started after the terminal answer and with no new Connect, fails.
    await b.page.reload()
    await expect(b.page.getByTestId('google-connect')).toBeVisible()
    await expect(b.page.getByTestId('google-status')).not.toContainText(/\d+ events?/)
    expect(a.server.connected).toBe(false)
    await nothingStored(b)
    await nothingStored(a)
  }

  for (const broadcast of [true, false]) {
    for (const revokeAnswer of ['ok', 'fail'] as const) {
      const name = `${broadcast ? 'with' : 'without'} BroadcastChannel, revoke ${revokeAnswer === 'ok' ? 'confirmed' : 'unconfirmed'}`

      test(`(a) a token minted in tab B and held: the shared lock makes tab A's Disconnect wait for it (${name})`, async ({ context }) => {
        const world = newWorld()
        world.revokeAnswer = revokeAnswer
        const { a, b } = await twoTabs(context, world, broadcast)
        await b.page.clock.fastForward(TWO_HOURS)
        const release = b.server.hold('token', 'afterMint')
        await b.page.getByTestId('google-update').click()
        await expect.poll(() => b.server.count('token')).toBe(3)
        await disconnect(a.page)
        await a.page.waitForTimeout(500)
        expect(a.server.count('status'), 'Disconnect must not start while the mint holds the lock').toBe(0)
        release()
        await expect(a.page.getByTestId('google-connect')).toBeVisible()
        expect(a.server.requests.map((request) => request.route)).toEqual(['token', 'token', 'token', 'status', 'disconnect'])
        if (broadcast) {
          await expect(b.page.getByTestId('google-connect')).toBeVisible()
          await expect(b.page.getByTestId('google-status')).not.toContainText(/\d+ events?/)
        } else {
          // The residual of design 4-1: what is already on screen stays until a reload.
          await connectedTo(b.page)
        }
        await afterwards(a, b)
      })

      for (const [label, at] of [['(a)', 'afterMint'], ['(d)', 'afterRead']] as const) {
        test(`${label} a mint that outlives the lock's 15 s abort overlaps the Disconnect, and its reply reaches no one (${name})`, async ({ context }) => {
          const world = newWorld()
          world.revokeAnswer = revokeAnswer
          const { a, b } = await twoTabs(context, world, broadcast)
          await b.page.clock.fastForward(TWO_HOURS)
          const release = b.server.hold('token', at)
          await b.page.getByTestId('google-update').click()
          await expect.poll(() => b.server.count('token')).toBe(3)
          await b.page.clock.fastForward(16_000)
          await expect(b.page.getByTestId('google-message')).toContainText('Try again later.')
          await disconnect(a.page)
          await expect(a.page.getByTestId('google-connect')).toBeVisible()
          expect(a.server.connected).toBe(false)
          const reads = b.google.apiRequests.length
          release()
          await b.page.waitForTimeout(300)
          expect(b.google.apiRequests, 'the late reply was dropped with its request').toHaveLength(reads)
          if (broadcast) await expect(b.page.getByTestId('google-connect')).toBeVisible()
          expect(a.server.connected).toBe(false)
          await afterwards(a, b)
        })
      }

      test(`(b) a Google read held in tab B while tab A disconnects (${name})`, async ({ context }) => {
        const world = newWorld()
        world.revokeAnswer = revokeAnswer
        const { a, b } = await twoTabs(context, world, broadcast)
        const releaseRead = b.google.holdApi()
        await b.page.getByTestId('google-update').click()
        await expect.poll(() => b.google.apiRequests.length).toBeGreaterThan(2)
        await disconnect(a.page)
        await expect(a.page.getByTestId('google-connect')).toBeVisible()
        releaseRead()
        if (broadcast) {
          await expect(b.page.getByTestId('google-connect')).toBeVisible()
          await b.page.waitForTimeout(300)
          await expect(b.page.getByTestId('google-status')).not.toContainText(/\d+ events?/)
        } else {
          await connectedTo(b.page)
        }
        await afterwards(a, b)
      })

    }
  }

  test('(c) a second device on the same account keeps what is on screen, and its next mint and read fail after a confirmed revoke', async ({ browser }) => {
    const world = newWorld()
    const first = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const second = await browser.newContext({ baseURL: SERVER_BASE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' })
    const one = await newRig(first, world, { device: 'one', connected: true })
    const two = await newRig(second, world, { device: 'two', connected: true })
    await boot(one.page)
    await boot(two.page)
    await connectedTo(one.page)
    await connectedTo(two.page)
    await disconnect(one.page)
    await expect(one.page.getByTestId('google-message')).toContainText('Disconnected. Google confirmed it withdrew access.')
    expect(world.grantRevoked).toBe(true)
    await connectedTo(two.page)
    await two.page.getByTestId('google-update').click()
    await expect(two.page.getByTestId('google-message')).toContainText('Google\'s permission expired.')
    await two.page.clock.fastForward(TWO_HOURS)
    await two.page.getByTestId('google-update').click()
    await expect(two.page.getByTestId('google-message')).toContainText('This device is no longer connected to Google Calendar.')
    await expect(two.page.getByTestId('google-connect')).toBeVisible()
    await nothingStored(two)
    await nothingStored(one)
    await first.close()
    await second.close()
  })
})

test.describe('A-13 Delete all data and Disconnect when the server cannot confirm', () => {
  async function deleteAll(page: Page): Promise<void> {
    await page.evaluate(() => { location.hash = '#/settings/data' })
    await expect(page.getByRole('heading', { level: 2, name: 'Your data', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Delete all data…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
    await dialog.getByRole('textbox').fill('DELETE')
    await dialog.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.getByTestId('data-notice')).toBeVisible()
  }

  test('online: the server forgets this device first, then the data goes; no Google message', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page, { ...DOCUMENT, tasks: [{ id: 't-1', title: 'Write brief', categoryId: 'c-work', durationMin: 30, priority: 1, createdAt: '2026-10-19T08:00:00.000Z' }] })
    await connectedTo(rig.page)
    const release = rig.server.hold('disconnect')
    await rig.page.evaluate(() => { location.hash = '#/settings/data' })
    await rig.page.getByRole('button', { name: 'Delete all data…' }).click()
    const dialog = rig.page.getByRole('dialog', { name: 'Delete everything?' })
    await dialog.getByRole('textbox').fill('DELETE')
    await dialog.getByRole('button', { name: 'Delete everything' }).click()
    await expect.poll(() => rig.server.count('disconnect')).toBe(1)
    await expect(rig.page.getByTestId('data-notice')).toHaveCount(0)
    release()
    await expect(rig.page.getByTestId('data-notice')).toBeVisible()
    expect(rig.server.requests.map((request) => request.route)).toEqual(['token', 'status', 'disconnect'])
    expect(rig.server.requests[2]!.body).toEqual({ revoke: false, gen: 'CCCCCCCCCCCCCCCCCCCCCC.-' })
    expect(rig.server.connected).toBe(false)
    await expect(rig.page.getByTestId('google-delete-note')).toHaveCount(0)
  })

  test('offline: the data goes anyway and the message names what remains, with the link', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    await goOffline(rig.page)
    const before = rig.server.requests.length
    await deleteAll(rig.page)
    await expect(rig.page.getByTestId('google-delete-note')).toContainText('Your data on this device was deleted, but Weeklid couldn\'t reach its server')
    await expect(rig.page.getByTestId('google-delete-permissions')).toHaveAttribute('href', PERMISSIONS)
    expect(rig.server.requests).toHaveLength(before)
    expect(rig.server.connected).toBe(true)
  })

  test('with the labs flag off and no saved-copy database the server is still asked', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page, DOCUMENT, { url: './' })
    await expect(rig.page.getByTestId('google-calendar')).toHaveCount(0)
    expect(await savedGoogleCopy(rig.page)).toBe('')
    await deleteAll(rig.page)
    expect(rig.server.count('status')).toBe(1)
    expect(rig.server.count('disconnect')).toBe(1)
    expect(rig.server.connected).toBe(false)
  })

  test('no cookie: none, then noDevice → access may remain, with the link and no success claim', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    rig.server.cookie = false
    await deleteAll(rig.page)
    await expect(rig.page.getByTestId('google-delete-note')).toContainText('Weeklid couldn\'t confirm that its access to your Google Calendar was removed.')
    await expect(rig.page.getByTestId('google-delete-note')).not.toContainText('was deleted')
    await expect(rig.page.getByTestId('google-delete-permissions')).toHaveAttribute('href', PERMISSIONS)
    expect(rig.server.requests.map((request) => request.route)).toEqual(['token', 'status', 'disconnect', 'token'])
  })

  test('a cookie with no credential: none, then notConnected → no Google message', async ({ context }) => {
    const rig = await newRig(context, newWorld())
    await boot(rig.page)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    rig.server.cookie = true
    await deleteAll(rig.page)
    await expect(rig.page.getByTestId('google-delete-note')).toHaveCount(0)
    expect(rig.server.requests.map((request) => request.route)).toEqual(['token', 'status', 'disconnect', 'token'])
  })

  test('Disconnect with no cookie → googleAccessMayRemain with the link; the tab still forgets', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    rig.server.cookie = false
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('Weeklid couldn\'t confirm that its access to your Google Calendar was removed.')
    await expect(rig.page.getByTestId('google-permissions')).toHaveAttribute('href', PERMISSIONS)
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
    await week(rig.page)
    await expect(standupOverlay(rig.page)).toHaveCount(0)
  })

  test('Disconnect with a cookie and no credential → the unconfirmed message', async ({ context }) => {
    const rig = await newRig(context, newWorld(), { connected: true })
    await boot(rig.page)
    await connectedTo(rig.page)
    rig.server.connected = false
    await disconnect(rig.page)
    await expect(rig.page.getByTestId('google-message')).toContainText('We couldn\'t confirm with Google that Weeklid lost access to your account')
    await expect(rig.page.getByTestId('google-connect')).toBeVisible()
  })
})

test('GIS controls: a build with the flag but a GIS context never calls the Weeklid server', async ({ context }) => {
  const rig = await newRig(context, newWorld(), { kind: 'installed' })
  await boot(rig.page)
  await rig.page.getByTestId('google-connect').click()
  await expect(rig.page.getByTestId('google-continue')).toBeEnabled()
  await rig.page.getByTestId('google-continue').click()
  await connectedTo(rig.page)
  expect((await gisRecord(rig.page)).requests).toHaveLength(1)
  expect(rig.server.requests).toEqual([])
})
