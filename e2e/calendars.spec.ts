import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import ICAL from 'ical.js'
import { seedKey, V2_KEY, openTab } from './fixtures'

const fixturePath = 'src/core/__fixtures__/ics/google.ics'
const document = {
  schemaVersion: 2, workspaceId: 'calendar-e2e', revision: 0, updatedAt: '2026-10-19T00:00:00.000Z',
  settings: { locale: 'en', timeZone: 'America/Bogota', weekStartsOn: 1, onboardingDone: true, theme: 'system' },
  categories: [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'focus', title: 'Focus', categoryId: 'work', days: [1], start: 540, end: 600 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}
async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') })
  await seedKey(page, V2_KEY, JSON.stringify(document))
  await openTab(page, 'settings')
}
const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:local-server\r\nDTSTART:20261019T140000Z\r\nDTEND:20261019T150000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
async function serve(body: () => string, cors: boolean): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/calendar')
    if (cors) response.setHeader('Access-Control-Allow-Origin', '*')
    response.end(body())
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test feed server has no TCP address')
  return { server, url: `http://127.0.0.1:${address.port}/feed.ics` }
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
async function subscribe(page: Page, url: string) {
  await page.getByLabel('Calendar name', { exact: true }).fill('Team feed')
  await page.getByLabel('Subscription URL', { exact: true }).fill(url)
  await page.getByRole('button', { name: 'Add subscription', exact: true }).click()
}

test('calendar settings fit from 320 to 1920 px with a long source name and URL', async ({ page }) => {
  const sourceName = 'UnbrokenCalendarName'.repeat(4)
  const url = `https://calendars.example.invalid/${'unbroken-feed-path'.repeat(40)}.ics?token=${'x'.repeat(200)}`
  const eventTitle = 'UnbrokenEventTitle'.repeat(6)
  await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') })
  await page.route(url, route => route.fulfill({ contentType: 'text/calendar', body: feed(eventTitle) }))
  await seedKey(page, V2_KEY, JSON.stringify({
    ...document,
    calendarSources: [{ id: 'long-source', name: sourceName, kind: 'url', url, colorKey: 'purple' }],
    events: [{ id: 'long-event', title: eventTitle, start: '2026-10-20T14:30:00.000Z', end: '2026-10-20T15:30:00.000Z', allDay: false, attendees: [] }],
  }))
  await page.setViewportSize({ width: 320, height: 900 })
  await openTab(page, 'settings')
  const source = page.getByTestId('calendar-source')
  await expect(source).toBeVisible()
  await expect(source.getByRole('textbox', { name: `Rename ${sourceName}`, exact: true })).toHaveValue(sourceName)
  await expect(page.getByTestId('calendar-occurrence')).toContainText(eventTitle)
  await expect(page.getByTestId('planner-event')).toContainText(eventTitle)
  await page.getByLabel('Calendar name', { exact: true }).fill(sourceName)
  await page.getByLabel('Subscription URL', { exact: true }).fill(url)
  await expect(page.getByLabel('Subscription URL', { exact: true })).toHaveValue(url)
  await expect(page.getByLabel('Import .ics file', { exact: true })).toBeEnabled()
  for (const width of [320, 375, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => window.document.scrollingElement!.scrollWidth - window.innerWidth), `calendar settings at ${width}px`).toBeLessThanOrEqual(0)
  }
})

// Integration: the Week view (S1) renders the occurrence source S3 registers with the shell.
test('import file → preview and Week show events with a conflict against the plan', async ({ page }) => {
  await setup(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles(fixturePath)
  await expect(page.getByTestId('calendar-occurrence').filter({ hasText: 'Project review' })).toBeVisible()
  await expect(page.getByTestId('calendar-conflict')).toHaveCount(1)
  await openTab(page, 'week')
  await expect(page.getByText('Project review', { exact: true })).toBeVisible()
  await expect(page.getByTestId('calendar-conflict').first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('Project review', { exact: true })).toBeVisible()
})

test('URL without CORS returns a friendly explanation and file-import suggestion', async ({ page }) => {
  const { server, url } = await serve(() => feed('Blocked feed'), false)
  try {
    await setup(page)
    await subscribe(page, url)
    await expect(page.getByRole('alert').filter({ hasText: 'CORS or network error' })).toContainText('Use Import .ics file')
    await expect(page.getByRole('alert').filter({ hasText: 'CORS or network error' })).toContainText('companion mode')
    await expect(page.getByLabel('Import .ics file', { exact: true })).toBeEnabled()
  } finally { await close(server) }
})

test('a changed subscription refreshes manually and on open, then works offline', async ({ page }) => {
  let title = 'First version'
  const { server, url } = await serve(() => feed(title), true)
  try {
    await setup(page)
    await subscribe(page, url)
    await expect(page.getByTestId('calendar-occurrence')).toContainText('First version')
    title = 'Manual refresh version'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByTestId('calendar-occurrence')).toContainText(title)
    title = 'On open version'
    await page.reload()
    await expect(page.getByTestId('calendar-occurrence')).toContainText(title)
    await page.context().setOffline(true)
    // IndexedDB expansion works without a server or reload/service-worker assumption.
    await page.getByLabel('First day of preview', { exact: true }).fill('2026-10-18')
    await page.getByLabel('First day of preview', { exact: true }).dispatchEvent('change')
    await expect(page.getByTestId('calendar-occurrence')).toContainText(title)
  } finally { await page.context().setOffline(false); await close(server) }
})

test('create and edit a two-attendee meeting → portable ICS and encoded provider links', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'New event', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Title', { exact: true }).fill('Design & review, café')
  await sheet.getByLabel('Date', { exact: true }).fill('2026-10-20')
  await sheet.getByLabel('Time', { exact: true }).fill('09:30')
  await sheet.getByLabel('Duration (minutes)', { exact: true }).fill('60')
  await sheet.getByLabel('Location', { exact: true }).fill('Room 2')
  await sheet.getByLabel('Notes', { exact: true }).fill('Bring a draft')
  await sheet.getByLabel('Attendees (email addresses)', { exact: true }).fill('one@example.invalid, two@example.invalid')
  await sheet.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(sheet).toBeHidden()
  const meeting = page.getByTestId('planner-event')
  await expect(meeting).toContainText('Design & review, café')
  const google = new URL((await meeting.getByRole('link', { name: 'Add to Google Calendar' }).getAttribute('href'))!)
  const outlook = new URL((await meeting.getByRole('link', { name: 'Add to Outlook', exact: true }).getAttribute('href'))!)
  expect(google.searchParams.get('text')).toBe('Design & review, café')
  expect(google.searchParams.get('dates')).toBe('20261020T143000Z/20261020T153000Z')
  expect(google.searchParams.get('add')).toBe('one@example.invalid,two@example.invalid')
  expect(outlook.searchParams.get('subject')).toBe('Design & review, café')
  expect(outlook.searchParams.get('startdt')).toBe('2026-10-20T14:30:00.000Z')
  expect(outlook.searchParams.get('to')).toBe('one@example.invalid;two@example.invalid')
  const downloadPromise = page.waitForEvent('download')
  await meeting.getByRole('button', { name: 'Download .ics', exact: true }).click()
  const download = await downloadPromise, downloadedPath = await download.path()
  const raw = await readFile(downloadedPath!, 'utf8')
  // Independent of Next168's import function: Python icalendar is absent on the executor.
  const parsed = new ICAL.Event(new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent')!)
  expect(parsed.summary).toBe('Design & review, café')
  expect(parsed.startDate.toJSDate().toISOString()).toBe('2026-10-20T14:30:00.000Z')
  expect(parsed.endDate.toJSDate().toISOString()).toBe('2026-10-20T15:30:00.000Z')
  expect(parsed.attendees.map(property => property.getFirstValue())).toEqual(['mailto:one@example.invalid', 'mailto:two@example.invalid'])
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'meeting.ics', mimeType: 'text/calendar', buffer: Buffer.from(raw) })
  await expect(page.getByTestId('calendar-occurrence')).toContainText('Design & review, café')
  await meeting.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sheet.getByLabel('Attendees (email addresses)', { exact: true })).toHaveValue('one@example.invalid, two@example.invalid')
  await sheet.getByLabel('Title', { exact: true }).fill('Updated review')
  await sheet.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(meeting).toContainText('Updated review')
})

// An explicit browser probe, separate from deterministic local acceptance. Run it with
// NEXT168_CALENDAR_PROVIDER_PROBE=1 npx playwright test e2e/calendars.spec.ts --grep @providers --project desktop.
test('public Google and Outlook browser CORS matrix @providers', async ({ page, request }, testInfo) => {
  test.skip(process.env.NEXT168_CALENDAR_PROVIDER_PROBE !== '1', 'Live-provider evidence is an explicit probe; local acceptance uses real local HTTP servers')
  await page.goto('./')
  const feeds = [
    { provider: 'Google US holidays', url: 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' },
    { provider: 'Outlook UCT public holidays', url: 'https://outlook.office365.com/owa/calendar/f3b8cd563e9b4735b7f0479af9c85a48@uct.ac.za/2fdce791158d4b3c863d711af36d3a7611923565644488696156/calendar.ics' },
  ]
  const results = []
  for (const feed of feeds) {
    const response = await request.get(feed.url)
    expect(response.ok()).toBe(true)
    expect(await response.text()).toContain('BEGIN:VCALENDAR')
    const browser = await page.evaluate(async url => {
      try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15000) })
        const text = await response.text()
        return { allowed: response.ok && text.includes('BEGIN:VCALENDAR'), status: response.status, error: null }
      } catch (error) { return { allowed: false, status: null, error: String(error) } }
    }, feed.url)
    results.push({ ...feed, utc: new Date().toISOString(), serverStatus: response.status(), allowOrigin: response.headers()['access-control-allow-origin'] ?? null, browser })
  }
  await testInfo.attach('provider-cors-matrix.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
})
