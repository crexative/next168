import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import ICAL from 'ical.js'
import { seedKey, V2_KEY, openSettingsPage, openTab } from './fixtures'
import { storedPlanner } from './support/indexedDb'

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
  await openSettingsPage(page, 'calendars')
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
  await openSettingsPage(page, 'calendars')
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

test('every settings section keeps a 16 px side gutter', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
  const edges: { name: string; left: number; right: number }[] = []
  for (const name of ['calendars', 'data', 'advanced'] as const) {
    if (name !== 'calendars') await openSettingsPage(page, name)
    const main = await page.locator('main').evaluate((node) => node.getBoundingClientRect().left)
    edges.push(...await page.evaluate((offset) => {
      const width = window.innerWidth
      return Array.from(window.document.querySelectorAll('main h2, main .list-card, main .calendar-file, main .calendar-form input, main .connect-card'))
        .map((node) => { const box = node.getBoundingClientRect(); return { name: `${node.tagName}.${node.className} ${node.textContent?.slice(0, 20)}`, left: box.left - offset, right: width - box.right } })
    }, main))
  }
  expect(edges.length).toBeGreaterThan(5)
  for (const edge of edges) {
    expect(edge.left, `${edge.name} left gutter`).toBeGreaterThanOrEqual(15.5)
    expect(edge.right, `${edge.name} right gutter`).toBeGreaterThanOrEqual(15.5)
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
  // toBeVisible ignores occlusion: the event title and the Conflict mark must be what is painted at their own center.
  // In a lane too narrow for the whole title it is not drawn and stays in the event's accessible name (Week items rule).
  await expect(page.locator('[data-testid=busy-overlay].is-conflict').first()).toContainText('Project review')
  for (const selector of ['[data-testid=busy-overlay].is-conflict .busy-title', '[data-testid=busy-overlay].is-conflict [data-testid=calendar-conflict]']) {
    if (await page.locator(selector).first().evaluate((node) => Boolean(node.closest('.visually-hidden')))) continue
    const topmost = await page.locator(selector).first().evaluate((node) => {
      node.scrollIntoView({ block: 'center' })
      const lines = node.getClientRects()
      const box = lines[lines.length - 1] ?? node.getBoundingClientRect()
      const hit = window.document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return !!hit && (hit === node || node.contains(hit)) ? 'ok' : (hit?.outerHTML ?? 'null').slice(0, 200) + JSON.stringify(box)
    })
    expect(topmost, `${selector} is the topmost element at its center`).toBe('ok')
  }
  await page.reload()
  await expect(page.getByText('Project review', { exact: true })).toBeVisible()
})

// verify10 C6: Week drew only busy timed events; holidays (all-day) and events marked free (transparent) showed only on
// Today and in Settings.
test('Week shows all-day events under its day headings and free events as outlines that never conflict', async ({ page }) => {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:holiday@example.invalid', 'DTSTART;VALUE=DATE:20261019', 'DTEND;VALUE=DATE:20261020', 'SUMMARY:Founders Day', 'TRANSP:TRANSPARENT', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:free@example.invalid', 'DTSTART:20261019T141500Z', 'DTEND:20261019T144500Z', 'SUMMARY:Optional coffee', 'TRANSP:TRANSPARENT', 'END:VEVENT',
    'END:VCALENDAR', ''].join('\r\n')
  await setup(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'holidays.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) })
  await expect(page.getByTestId('calendar-occurrence').filter({ hasText: 'Optional coffee' })).toBeVisible()
  await openTab(page, 'week')
  const holiday = page.locator('[data-testid=all-day-cell][data-date="2026-10-19"] [data-testid=all-day-item]').filter({ visible: true })
  await expect(holiday).toHaveCount(1)
  await expect(holiday).toHaveAccessibleName('Founders Day, all day')
  await expect(holiday).toContainText('Founders')
  expect((await holiday.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await holiday.click()
  const details = page.getByTestId('busy-details')
  await expect(details).toContainText('All day')
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  // The free event overlaps Focus (9:00–10:00 in Bogotá) but takes no time from it: an outline, no conflict.
  const free = page.locator('[data-testid=busy-overlay].is-free').filter({ visible: true })
  await expect(free).toHaveCount(1)
  await expect(free).toHaveAttribute('title', 'Optional coffee')
  await expect(page.getByTestId('calendar-conflict')).toHaveCount(0)
})

// verify12: one sheet handing off to the next must leave focus in the newest one. The details of a conflicting event
// open the routine it conflicts with; that editor closes on Escape and gives focus back to the event.
test('the routine opened from a conflict\'s details keeps focus, closes on Escape and gives focus back to the event', async ({ page }) => {
  await setup(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles(fixturePath)
  await expect(page.getByTestId('calendar-conflict')).toHaveCount(1)
  await openTab(page, 'week')
  const conflict = page.locator('[data-testid=busy-overlay].is-conflict').filter({ visible: true }).first()
  await conflict.scrollIntoViewIfNeeded()
  await conflict.click()
  const details = page.getByTestId('busy-details')
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: /Conflicts with/ }).click()
  const editor = page.getByRole('dialog', { name: 'Edit routine' })
  await expect(editor).toBeVisible()
  await page.waitForTimeout(400)
  expect(await editor.evaluate((dialog) => dialog.contains(dialog.ownerDocument.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(conflict).toBeFocused()
})

test('deleting a calendar source in another tab removes its events from the open Week without navigation', async ({ page, context }) => {
  await setup(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'team.ics', mimeType: 'text/calendar', buffer: Buffer.from(feed('Removed team meeting')) })
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
  await openTab(page, 'week')
  const overlay = page.getByText('Removed team meeting', { exact: true })
  await expect(overlay).toBeVisible()
  const weekUrl = page.url()
  // Keep an element handle: re-navigation or replacing the Week root must not satisfy this case.
  const weekRoot = await page.locator('.week-view').elementHandle()
  const settings = await context.newPage()
  try {
    await settings.clock.install({ time: new Date('2026-10-19T12:00:00Z') })
    await openSettingsPage(settings, 'calendars')
    await settings.getByTestId('calendar-source').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(settings.getByTestId('calendar-source')).toHaveCount(0)

    await expect(overlay).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Week', exact: true })).toBeVisible()
    expect(page.url()).toBe(weekUrl)
    expect(await weekRoot!.evaluate(node => node.isConnected)).toBe(true)
  } finally { await settings.close() }
})

test('delete all data leaves no calendar source, neither in the plan nor in the cached texts', async ({ page }) => {
  await setup(page)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles(fixturePath)
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
  const cachedKeys = () => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('next168-calendars')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = open.result.transaction('sources').objectStore('sources').getAllKeys()
      request.onsuccess = () => { open.result.close(); resolve(request.result.map(String)) }
      request.onerror = () => reject(request.error)
    }
  }))
  expect(await cachedKeys()).toHaveLength(1)
  await openSettingsPage(page, 'data')
  await page.getByRole('button', { name: 'Delete all data…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete everything' }).click()
  await expect(page.getByTestId('data-notice')).toContainText('All data was deleted')
  await openSettingsPage(page, 'calendars')
  await expect(page.getByTestId('calendar-source')).toHaveCount(0)
  expect(await cachedKeys()).toEqual([])
  expect((await storedPlanner<{ calendarSources: unknown[] }>(page)).calendarSources).toEqual([])
  await page.reload()
  await expect(page.getByRole('heading', { level: 2, name: 'Calendars', exact: true })).toBeVisible()
  await expect(page.getByTestId('calendar-source')).toHaveCount(0)
  expect(await cachedKeys()).toEqual([])
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

test('create and edit a meeting → portable ICS and encoded provider links', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'New event', exact: true }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Title', { exact: true }).fill('Design & review, café')
  await sheet.getByLabel('Day', { exact: true }).fill('2026-10-20')
  await sheet.getByLabel('From', { exact: true }).fill('09:30')
  await sheet.getByLabel('To', { exact: true }).fill('10:30')
  // Guests, location and notes are one level deeper; the time zone is not asked for at all.
  await expect(sheet.getByLabel('Location', { exact: true })).toBeHidden()
  await expect(sheet.getByLabel('Guests', { exact: true })).toBeHidden()
  await expect(sheet.getByText(/Time zone/)).toHaveCount(0)
  await sheet.getByRole('button', { name: 'More' }).click()
  const guests = sheet.getByLabel('Guests', { exact: true })
  await guests.fill('ana@example.com')
  await guests.press('Enter')
  await guests.fill('not-an-email')
  await guests.press('Enter')
  await expect(sheet.getByText('Enter an email address, like name@example.com.')).toBeVisible()
  await guests.fill('luis@example.org')
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(sheet.getByTestId('event-guests').getByRole('listitem')).toHaveText(['ana@example.com', 'luis@example.org'])
  // Every guest control is a full 44 px target.
  for (const control of [sheet.getByRole('button', { name: 'Remove ana@example.com' }), sheet.getByRole('button', { name: 'Add', exact: true }), guests]) {
    const box = (await control.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  await sheet.getByLabel('Location', { exact: true }).fill('Room 2')
  await sheet.getByLabel('Notes', { exact: true }).fill('Bring a draft')
  await sheet.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(sheet).toBeHidden()
  const meeting = page.getByTestId('planner-event')
  await expect(meeting).toContainText('Design & review, café')
  const google = new URL((await meeting.getByRole('link', { name: 'Add to Google Calendar' }).getAttribute('href'))!)
  const outlook = new URL((await meeting.getByRole('link', { name: 'Add to Outlook', exact: true }).getAttribute('href'))!)
  expect(google.searchParams.get('text')).toBe('Design & review, café')
  expect(google.searchParams.get('dates')).toBe('20261020T143000Z/20261020T153000Z')
  expect(google.searchParams.get('add')).toBe('ana@example.com,luis@example.org')
  expect(outlook.searchParams.get('subject')).toBe('Design & review, café')
  expect(outlook.searchParams.get('startdt')).toBe('2026-10-20T14:30:00.000Z')
  expect(outlook.searchParams.get('to')).toBe('ana@example.com;luis@example.org')
  const downloadPromise = page.waitForEvent('download')
  await meeting.getByRole('button', { name: 'Download .ics', exact: true }).click()
  const download = await downloadPromise, downloadedPath = await download.path()
  const raw = await readFile(downloadedPath!, 'utf8')
  // Independent of Next168's import function: Python icalendar is absent on the executor.
  const parsed = new ICAL.Event(new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent')!)
  expect(parsed.summary).toBe('Design & review, café')
  expect(parsed.startDate.toJSDate().toISOString()).toBe('2026-10-20T14:30:00.000Z')
  expect(parsed.endDate.toJSDate().toISOString()).toBe('2026-10-20T15:30:00.000Z')
  expect(parsed.attendees.map((attendee) => attendee.getFirstValue())).toEqual(['mailto:ana@example.com', 'mailto:luis@example.org'])
  expect(raw.split('\r\n').filter((line) => line.startsWith('ATTENDEE'))).toHaveLength(2)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles({ name: 'meeting.ics', mimeType: 'text/calendar', buffer: Buffer.from(raw) })
  await expect(page.getByTestId('calendar-occurrence')).toContainText('Design & review, café')
  await meeting.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(sheet.getByLabel('Location', { exact: true })).toHaveValue('Room 2')
  await expect(sheet.getByTestId('event-guests').getByRole('listitem')).toHaveText(['ana@example.com', 'luis@example.org'])
  await sheet.getByLabel('Title', { exact: true }).fill('Updated review')
  await sheet.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(meeting).toContainText('Updated review')
  const edited = new URL((await meeting.getByRole('link', { name: 'Add to Google Calendar' }).getAttribute('href'))!)
  expect(edited.searchParams.get('add')).toBe('ana@example.com,luis@example.org')
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
