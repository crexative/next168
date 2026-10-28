import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { onlyProject, openTab, seedKey, TABS, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'
import {
  EVENTS_READONLY, SECRET_TOKEN, expectNoStrayGoogleTraffic, fakeGoogle, everythingStored, gisRecord, releaseToken, setGisPlan,
  withPrivateFields, type CalendarEvent, type GoogleFake,
} from './support/googleCalendar'

// Google Calendar, Slice 1 (read-only, primary calendar, memory only): acceptance A1, A3–A12 of the Slice 1 spec.
// The build under test carries the fake client ID (playwright.config.ts); Google is faked at its real addresses.

// Monday 2026-10-19 12:00 UTC; the planner and the browser use UTC.
const NOW = new Date('2026-10-19T12:00:00.000Z')
const TUESDAY = '2026-10-20'
const STANDUP: CalendarEvent = withPrivateFields({ id: 'evt-standup', summary: 'Standup GCal', start: { dateTime: `${TUESDAY}T09:30:00Z` }, end: { dateTime: `${TUESDAY}T10:00:00Z` } })
const PRIVATE = ['ana.private@example.com', 'owner@example.com', 'Secret agenda description', 'Hidden Office 42', 'meet.google.com']
const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }
const FOCUS = { id: 'b-focus', categoryId: 'c-work', title: 'Focus', days: [2], start: 540, end: 660 }
const BRIEF = { id: 't-brief', title: 'Write brief', categoryId: 'c-work', durationMin: 90, priority: 1, createdAt: '2026-10-19T08:00:00.000Z' }
const WITH_BLOCK = { categories: [WORK], blocks: [FOCUS], tasks: [BRIEF] }
const GOOGLE_ONLY = { categories: [WORK] }
const LABS = './?labs=google-calendar'

test.use({ serviceWorkers: 'block', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(onlyProject('desktop'))

let google: GoogleFake
let pages: Page[] = []

async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: unknown[] = []
    Object.assign(window, { __cspViolations: seen })
    document.addEventListener('securitypolicyviolation', (event) => { seen.push({ directive: event.violatedDirective, blocked: event.blockedURI }) })
  })
}

async function open(context: BrowserContext, page: Page, document: Record<string, unknown>, options: { gisDelayMs?: number; labs?: boolean; hash?: string } = {}): Promise<Page> {
  google ??= await fakeGoogle(context, { gisDelayMs: options.gisDelayMs, events: [STANDUP] })
  await page.clock.install({ time: NOW })
  await recordViolations(page)
  await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ workspaceId: 'ws-google', ...document })))
  await page.addInitScript(() => {
    const copied: string[] = []
    Object.assign(window, { __copied: copied })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text) } } })
  })
  await page.goto(`${options.labs === false ? './' : LABS}#/settings/calendars`)
  await expect(page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
  pages.push(page)
  return page
}

async function connect(page: Page): Promise<void> {
  await page.getByTestId('google-connect').click()
  const continueButton = page.getByTestId('google-continue')
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
}

async function connected(page: Page, count = 1): Promise<void> {
  await expect(page.getByTestId('google-status')).toContainText(count === 1 ? '1 event' : `${count} events`)
}

async function week(page: Page): Promise<void> {
  await page.evaluate(() => { location.hash = '#/week' })
  await expect(page.getByRole('heading', { level: 1, name: 'Week' })).toBeVisible()
}

async function settingsPage(page: Page, name: 'calendars' | 'data' | 'ai'): Promise<void> {
  await page.evaluate((next) => { location.hash = `#/settings/${next}` }, name)
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
}

const standupOverlay = (page: Page) => page.locator(`.day-column[data-date="${TUESDAY}"] [data-testid=busy-overlay]`).filter({ hasText: 'Standup GCal' })

test.afterEach(async () => {
  for (const page of pages) {
    if (page.isClosed()) continue
    expect(await page.evaluate(() => (window as unknown as { __cspViolations: unknown[] }).__cspViolations), 'CSP violations').toEqual([])
  }
  if (google) expectNoStrayGoogleTraffic(google)
  pages = []
  google = undefined as unknown as GoogleFake
})

test.describe('A3 no traffic before opting in', () => {
  test('with the labs flag, visiting every tab makes no Google request; opening the sheet loads GIS exactly once', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await expect(page.getByTestId('google-calendar')).toBeVisible()
    for (const tab of TABS) await openTab(page, tab)
    await settingsPage(page, 'ai')
    await expect(page.getByTestId('any-ai-copy')).toBeVisible()
    expect(google.gisLoads).toBe(0)
    expect(google.apiRequests).toEqual([])
    await settingsPage(page, 'calendars')
    await page.getByTestId('google-connect').click()
    await expect(page.getByTestId('google-continue')).toBeEnabled()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByTestId('google-connect').click()
    await expect(page.getByTestId('google-continue')).toBeEnabled()
    expect(google.gisLoads).toBe(1)
    expect(await page.locator('script[src="https://accounts.google.com/gsi/client"]').count()).toBe(1)
  })

  test('without the labs flag the section and the Week line are absent', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK, { labs: false })
    await expect(page.getByTestId('calendar-file').or(page.locator('.calendar-file'))).toBeVisible()
    await expect(page.getByTestId('google-calendar')).toHaveCount(0)
    await openTab(page, 'week')
    await expect(page.getByTestId('google-notice')).toHaveCount(0)
    expect(google.gisLoads).toBe(0)
  })
})

test.describe('A4 activation and configuration', () => {
  test('the button waits for GIS; one request per tap, inside the tap, with the narrow configuration; never by itself', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK, { gisDelayMs: 6_000 })
    await page.getByTestId('google-connect').click()
    const continueButton = page.getByTestId('google-continue')
    await expect(continueButton).toBeDisabled()
    await expect(continueButton).toHaveText('Loading Google…')
    await page.waitForTimeout(4_000)
    await expect(continueButton).toBeDisabled()
    await expect(continueButton).toBeEnabled({ timeout: 10_000 })
    await expect(continueButton).toHaveText('Continue with Google')
    expect((await gisRecord(page)).requests).toEqual([])
    await continueButton.click()
    await connected(page)
    const record = await gisRecord(page)
    expect(record.requests).toEqual([{ active: true }])
    expect(record.configs).toHaveLength(1)
    expect(record.configs[0]).toMatchObject({ scope: EVENTS_READONLY, include_granted_scopes: false, prompt: '' })
    expect(record.configs[0]).not.toHaveProperty('login_hint')
    expect(record.configs[0]!.client_id).toBe('000000000000-e2etest.apps.googleusercontent.com')
    const requestsAfterConnect = google.apiRequests.length
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
    })
    await page.clock.runFor(20 * 60_000)
    await page.clock.runFor(45 * 60_000)
    expect((await gisRecord(page)).requests).toHaveLength(1)
    expect(google.apiRequests).toHaveLength(requestsAfterConnect)
  })
})

test.describe('A7 Week and scheduling', () => {
  test('a week with only Google events still shows its grid and the event', async ({ context, page }) => {
    await open(context, page, GOOGLE_ONLY)
    await connect(page)
    await connected(page)
    await week(page)
    await expect(standupOverlay(page)).toBeVisible()
    await expect(page.getByTestId('google-notice')).toHaveCount(0)
    // Review finding 5: after a reload the week is empty again, and it must still say why and offer Update.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Week' })).toBeVisible()
    await expect(page.getByTestId('google-notice')).toContainText("Google Calendar isn't loaded")
    await expect(page.getByTestId('google-notice')).toBeInViewport()
    await expect(page.getByTestId('google-notice-update')).toBeEnabled()
  })

  test('a 15-minute free Google event shows its title in one line instead of an initial', async ({ context, page }) => {
    const short: CalendarEvent = { id: 'evt-short', summary: 'Publish the update', transparency: 'transparent', start: { dateTime: `${TUESDAY}T19:00:00Z` }, end: { dateTime: `${TUESDAY}T19:15:00Z` } }
    google = await fakeGoogle(context, { events: [short] })
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(context, page, GOOGLE_ONLY)
    await connect(page)
    await connected(page)
    await week(page)
    const item = page.locator(`.day-column[data-date="${TUESDAY}"] [data-testid=busy-overlay].is-free`).filter({ hasText: 'Publish the update' })
    await item.scrollIntoViewIfNeeded()
    await expect(item.locator('.busy-title')).toHaveText('Publish the update')
    await expect(item.locator('.busy-title')).not.toHaveClass(/visually-hidden/)
    await expect(item.locator('.item-glyph')).toHaveCount(0)
    const fits = await item.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node.querySelector('.busy-title')!)
      const words = range.getBoundingClientRect()
      const box = node.getBoundingClientRect()
      return words.top >= box.top - 0.5 && words.bottom <= box.bottom + 0.5 && words.right <= box.right + 0.5
    })
    expect(fits, 'the title is inside its box').toBe(true)
  })

  test('the event marks its conflict with a block, and a task is fitted around it', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await week(page)
    const task = page.locator(`.day-column[data-date="${TUESDAY}"] [data-task-id="t-brief"]`)
    await expect(task.first()).toHaveAttribute('data-start-minute', '540')
    await expect(page.getByTestId('google-notice')).toContainText("Google Calendar isn't loaded: your tasks might land on top of meetings.")
    await settingsPage(page, 'calendars')
    await connect(page)
    await connected(page)
    await week(page)
    await expect(standupOverlay(page).getByTestId('calendar-conflict')).toHaveCount(1)
    // The task's placed minutes, not its drawn box (a short chunk is drawn taller than its length to stay legible).
    const chunks = async () => task.evaluateAll((items) => items.map((item) => [Number(item.getAttribute('data-start-minute')), Number(item.getAttribute('data-end-minute'))]))
    await expect.poll(async () => JSON.stringify(await chunks())).toBe('[[540,570],[600,660]]')
    const [eventStart, eventEnd] = [9 * 60 + 30, 10 * 60]
    for (const [start, end] of await chunks()) expect(start! < eventEnd && end! > eventStart, `task ${start}-${end} overlaps the event`).toBe(false)
  })
})

test.describe('A8 memory only', () => {
  test('neither the token nor an event title is stored anywhere; a reload starts with nothing and says so', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await week(page)
    await expect(standupOverlay(page)).toBeVisible()
    const stored = await everythingStored(page)
    expect(stored).toContain('next168-labs-google')
    for (const secret of [SECRET_TOKEN, 'Standup GCal', 'evt-standup', ...PRIVATE]) expect(stored, secret).not.toContain(secret)
    const requests = google.apiRequests.length
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Week' })).toBeVisible()
    await expect(page.getByTestId('google-notice')).toContainText("Google Calendar isn't loaded")
    // Week opens scrolled to the current hour: the line lives in the sticky head so it is actually on screen.
    await expect(page.getByTestId('google-notice')).toBeInViewport()
    await expect(page.getByText('Standup GCal')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(google.apiRequests).toHaveLength(requests)
    expect(google.gisLoads).toBe(1)
  })
})

test.describe('A9 late answers lose to Disconnect, Delete all data and import', () => {
  async function expectNothingAfter(page: Page, apiRequests: number): Promise<void> {
    await page.waitForTimeout(500)
    expect(google.apiRequests).toHaveLength(apiRequests)
    await week(page)
    await expect(page.getByText('Standup GCal')).toHaveCount(0)
  }

  test('(i) a token asked for before Disconnect is given back unused', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await page.clock.runFor(61 * 60_000)
    await setGisPlan(page, { hold: true, response: { access_token: 'tok-LATE-1', expires_in: 3599, scope: EVENTS_READONLY } })
    await page.getByTestId('google-update').click()
    await expect.poll(async () => (await gisRecord(page)).held).toBe(1)
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(page.getByTestId('google-message')).toBeVisible()
    const requests = google.apiRequests.length
    await releaseToken(page)
    await expect.poll(async () => (await gisRecord(page)).revokes).toContain('tok-LATE-1')
    await expectNothingAfter(page, requests)
  })

  test('(ii) a token asked for before Delete all data is given back unused', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await setGisPlan(page, { hold: true, response: { access_token: 'tok-LATE-2', expires_in: 3599, scope: EVENTS_READONLY } })
    await connect(page)
    await expect.poll(async () => (await gisRecord(page)).held).toBe(1)
    await settingsPage(page, 'data')
    await page.getByRole('button', { name: 'Delete all data…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
    await dialog.getByRole('textbox').fill('DELETE')
    await dialog.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.getByTestId('data-notice')).toBeVisible()
    await releaseToken(page)
    await expect.poll(async () => (await gisRecord(page)).revokes).toEqual(['tok-LATE-2'])
    await expectNothingAfter(page, 0)
    expect(await page.evaluate(() => localStorage.getItem('next168-labs-google'))).toBeNull()
  })

  test('(iii) a token asked for before importing a backup of the same workspace is given back unused', async ({ context, page }, testInfo) => {
    await open(context, page, WITH_BLOCK)
    await settingsPage(page, 'data')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup' }).click()
    const file = testInfo.outputPath('same-workspace.json')
    await (await download).saveAs(file)
    expect(JSON.parse(readFileSync(file, 'utf8')).document.workspaceId).toBe('ws-google')
    await settingsPage(page, 'calendars')
    await setGisPlan(page, { hold: true, response: { access_token: 'tok-LATE-3', expires_in: 3599, scope: EVENTS_READONLY } })
    await connect(page)
    await expect.poll(async () => (await gisRecord(page)).held).toBe(1)
    await settingsPage(page, 'data')
    await page.getByLabel('Choose a Weeklid export file').setInputFiles(file)
    await page.getByTestId('import-preview').getByRole('button', { name: 'Replace my data' }).click()
    await expect(page.getByTestId('data-notice')).toContainText('Imported and verified')
    await releaseToken(page)
    await expect.poll(async () => (await gisRecord(page)).revokes).toEqual(['tok-LATE-3'])
    await expectNothingAfter(page, 0)
  })

  test('(iv) events still on their way when Disconnect is tapped are dropped', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    const release = google.holdApi()
    await page.getByTestId('google-update').click()
    await expect.poll(() => google.apiRequests.length).toBe(2)
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(page.getByTestId('google-message')).toContainText('Disconnected. Google confirmed it withdrew access.')
    google.events = [{ ...STANDUP, id: 'evt-late', summary: 'Late Standup' }]
    release()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('google-status')).not.toContainText('1 event')
    await expectNothingAfter(page, 2)
    await expect(page.getByText('Late Standup')).toHaveCount(0)
  })

  // Review finding 1: an answer to a request made before Disconnect must not take the place of a newer request.
  test('(vi) after Disconnect and a new request, the older answer is given back and the newer one is used', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await page.clock.runFor(61 * 60_000)
    await setGisPlan(page, { hold: true, response: { access_token: 'tok-OLD', expires_in: 3599, scope: EVENTS_READONLY } })
    await page.getByTestId('google-update').click()
    await expect.poll(async () => (await gisRecord(page)).held).toBe(1)
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(page.getByTestId('google-message')).toBeVisible()
    await setGisPlan(page, { hold: true, response: { access_token: 'tok-NEW', expires_in: 3599, scope: EVENTS_READONLY } })
    await connect(page)
    await expect.poll(async () => (await gisRecord(page)).held).toBe(2)
    const requests = google.apiRequests.length
    await releaseToken(page, 'first')
    await expect.poll(async () => (await gisRecord(page)).revokes).toEqual(['tok-OLD'])
    await page.waitForTimeout(300)
    expect(google.apiRequests).toHaveLength(requests)
    await releaseToken(page, 'first')
    await connected(page)
    expect((await gisRecord(page)).revokes).toEqual(['tok-OLD'])
    expect(google.apiRequests).toHaveLength(requests + 1)
  })

  // Review finding 2: what Disconnect forgets must also leave sheets that show it.
  test('(vii) Disconnect in another tab closes the details of a Google event that were open', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    const other = await open(context, await context.newPage(), WITH_BLOCK)
    for (const tab of [page, other]) {
      await connect(tab)
      await connected(tab)
    }
    await week(other)
    await standupOverlay(other).click()
    const details = other.getByRole('dialog').filter({ hasText: 'Standup GCal' })
    await expect(details).toBeVisible()
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(details).toHaveCount(0)
    await expect(other.getByText('Standup GCal')).toHaveCount(0)
  })

  test('(viii) Disconnect in another tab closes a chooser that offers a Google event', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    const other = await open(context, await context.newPage(), WITH_BLOCK)
    // Three short meetings over a block crowd the column, so a press there asks which item to open.
    const short = (id: string, start: string, end: string): CalendarEvent => ({ id, summary: `Crowded ${id}`, start: { dateTime: `${TUESDAY}T${start}:00Z` }, end: { dateTime: `${TUESDAY}T${end}:00Z` } })
    google.events = [short('a', '09:30', '09:45'), short('b', '09:30', '09:45'), short('c', '09:35', '09:50')]
    for (const tab of [page, other]) {
      await connect(tab)
      await connected(tab, 3)
    }
    await week(other)
    const shared = other.locator(`.day-column[data-date="${TUESDAY}"] [data-shared-target][data-shared-items*="e:google:primary"]`).first()
    await expect(shared).toBeAttached()
    await shared.dispatchEvent('click')
    const chooser = other.getByRole('dialog').filter({ hasText: 'Crowded a' })
    await expect(chooser).toBeVisible()
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(chooser).toHaveCount(0)
    await expect(other.getByText('Crowded a')).toHaveCount(0)
  })

  test('(v) Disconnect in one tab clears the events of another', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    const other = await open(context, await context.newPage(), WITH_BLOCK)
    for (const tab of [page, other]) {
      await connect(tab)
      await connected(tab)
    }
    await week(other)
    await expect(standupOverlay(other)).toBeVisible()
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(standupOverlay(other)).toHaveCount(0)
    await expect(other.getByText('Standup GCal')).toHaveCount(0)
  })
})

test.describe('A10 scope downgrade', () => {
  test('a token without the events scope reads nothing, is given back and is explained', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await setGisPlan(page, { response: { access_token: 'tok-NARROW', expires_in: 3599, scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly' } })
    await connect(page)
    await expect(page.getByTestId('google-message')).toHaveText('Weeklid needs permission to see your events. Connect again and leave that box checked.')
    expect((await gisRecord(page)).revokes).toEqual(['tok-NARROW'])
    await page.waitForTimeout(300)
    expect(google.apiRequests).toEqual([])
  })
})

test.describe('A11 the revocation result decides what Disconnect says', () => {
  const UNCONFIRMED = "Disconnected on this device. We couldn't confirm it with Google: check your account permissions."

  async function disconnect(page: Page): Promise<void> {
    await page.getByTestId('google-disconnect').click()
    await expect(page.getByRole('dialog', { name: 'Disconnect Google Calendar?' })).toBeVisible()
    await page.getByTestId('google-disconnect-confirm').click()
  }

  test('confirmed by Google', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await disconnect(page)
    await expect(page.getByTestId('google-message')).toContainText('Disconnected. Google confirmed it withdrew access.')
    await expect(page.getByTestId('google-permissions')).toHaveCount(0)
    expect((await gisRecord(page)).revokes).toEqual([SECRET_TOKEN])
  })

  for (const [name, plan] of [['refused by Google', 'fail'], ['unanswered for 10 s', 'never']] as const) {
    test(`not confirmed when ${name}`, async ({ context, page }) => {
      await open(context, page, WITH_BLOCK)
      await connect(page)
      await connected(page)
      await setGisPlan(page, { revoke: plan })
      await disconnect(page)
      if (plan === 'never') {
        await page.waitForTimeout(200)
        await expect(page.getByTestId('google-message')).toHaveCount(0)
        await page.clock.runFor(10_000)
      }
      await expect(page.getByTestId('google-message')).toContainText(UNCONFIRMED)
      await expect(page.getByTestId('google-permissions')).toHaveAttribute('href', 'https://myaccount.google.com/connections')
    })
  }

  test('not confirmed without a live token, and Google is not asked', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    google.apiStatus = { status: 401, body: { error: { code: 401 } } }
    await page.getByTestId('google-update').click()
    await expect(page.getByTestId('google-message')).toContainText("Google's permission expired.")
    await expect(page.getByTestId('google-update')).toContainText('Reconnect')
    await disconnect(page)
    await expect(page.getByTestId('google-message')).toContainText(UNCONFIRMED)
    await expect(page.getByTestId('google-permissions')).toHaveAttribute('href', 'https://myaccount.google.com/connections')
    expect((await gisRecord(page)).revokes).toEqual([])
  })
})

test.describe('A12 AI routes', () => {
  test('with only Google connected, the any-AI prompt has the meeting as Busy and nothing private', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await settingsPage(page, 'ai')
    await expect(page.getByTestId('any-ai-google-note')).toHaveText('Google meetings: only as “Busy”.')
    await page.getByTestId('any-ai-copy').click()
    await expect(page.getByTestId('any-ai-copied')).toBeVisible()
    const [prompt] = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
    expect(prompt).toContain(`${TUESDAY} 09:30-10:00 "Busy"`)
    for (const secret of ['Standup GCal', 'evt-standup', ...PRIVATE]) expect(prompt, secret).not.toContain(secret)
  })
})

test.describe('A1 Content Security Policy with Google connected', () => {
  test('every tab, the any-AI panel, connect, update and disconnect raise no violation', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    await page.getByTestId('google-update').click()
    await connected(page)
    for (const tab of TABS) {
      await page.evaluate((next) => { location.hash = `#/${next}` }, tab)
      await expect(page.locator('h1')).toBeVisible()
    }
    await settingsPage(page, 'ai')
    await page.getByTestId('any-ai-copy').click()
    await settingsPage(page, 'calendars')
    await page.getByTestId('google-disconnect').click()
    await page.getByTestId('google-disconnect-confirm').click()
    await expect(page.getByTestId('google-message')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __cspViolations: unknown[] }).__cspViolations)).toEqual([])
    expect(google.gisLoads).toBe(1)
  })
})

test('A2 the build under test ships the Google chunk because it has a client ID', () => {
  const assets = join('dist', 'assets')
  const withGis = readdirSync(assets).filter((name) => name.endsWith('.js') && readFileSync(join(assets, name), 'utf8').includes('accounts.google.com/gsi/client'))
  expect(withGis.length).toBeGreaterThan(0)
  const entry = readdirSync(assets).find((name) => /^index-.*\.js$/.test(name))!
  expect(readFileSync(join(assets, entry), 'utf8')).not.toContain('gsi/client')
})

test.describe('errors keep what was there', () => {
  test('a blocked pop-up says how to allow it; a closed one says nothing', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await setGisPlan(page, { error: 'popup_failed_to_open' })
    await connect(page)
    await expect(page.getByTestId('google-message')).toContainText('Your browser blocked Google\'s window. Allow pop-ups for 127.0.0.1')
    await setGisPlan(page, { error: 'popup_closed' })
    await connect(page)
    await expect(page.getByTestId('google-message')).toHaveCount(0)
    await expect(page.getByTestId('google-connect')).toBeEnabled()
  })

  test('a busy Google is reported once, without retrying, and the events stay', async ({ context, page }) => {
    await open(context, page, WITH_BLOCK)
    await connect(page)
    await connected(page)
    google.apiStatus = { status: 429, body: { error: { code: 429 } } }
    await page.getByTestId('google-update').click()
    await expect(page.getByTestId('google-message')).toHaveText('Google is busy; try again in a few minutes.')
    await page.waitForTimeout(500)
    expect(google.apiRequests).toHaveLength(2)
    await connected(page)
  })
})
