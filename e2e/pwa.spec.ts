import { expect, test, type Page } from '@playwright/test'
import { LEGACY_BLOCK_COUNT, onlyProject, seedKey, seedLegacy, V2_KEY } from './fixtures'
import { cachedUrls, expectNoStrayGoogleTraffic, fakeGoogle } from './support/googleCalendar'
import { previewPorts } from './support/ports'
import { onboardedDocument } from './support/seed'

const ports = previewPorts()

const BASES = [
  { name: 'root', url: `http://127.0.0.1:${ports.root}/` },
  { name: 'subpath', url: `http://127.0.0.1:${ports.subpath}/next168/` },
]

async function waitForActiveServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (registration.active?.state !== 'activated') {
      await new Promise<void>((resolve) => registration.active!.addEventListener('statechange', () => registration.active!.state === 'activated' && resolve()))
    }
  })
}

for (const base of BASES) {
  test.describe(`PWA served at ${base.name}`, () => {
    test.beforeEach(onlyProject('desktop'))

    test('manifest and icons are fetchable', async ({ page, request }) => {
      await page.goto(base.url)
      const href = await page.locator('link[rel=manifest]').getAttribute('href')
      const manifestUrl = new URL(href!, page.url()).toString()
      const manifest = await (await request.get(manifestUrl)).json()
      expect(manifest).toMatchObject({ name: 'Weeklid', short_name: 'Weeklid', display: 'standalone', start_url: './', scope: './' })
      expect(manifest.theme_color).toBeTruthy()
      expect(manifest.background_color).toBeTruthy()
      const purposes = manifest.icons.map((icon: { sizes: string; purpose?: string }) => `${icon.sizes}:${icon.purpose ?? 'any'}`)
      expect(purposes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
      for (const icon of manifest.icons) {
        const response = await request.get(new URL(icon.src, manifestUrl).toString())
        expect(response.status(), icon.src).toBe(200)
        expect(response.headers()['content-type']).toContain('image/png')
      }
      const touchIcon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href')
      expect((await request.get(new URL(touchIcon!, page.url()).toString())).status()).toBe(200)
    })

    test('service worker activates and Chrome reports no installability errors', async ({ page, context }) => {
      await page.goto(base.url)
      await waitForActiveServiceWorker(page)
      await page.reload()
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
      const session = await context.newCDPSession(page)
      const { installabilityErrors } = await session.send('Page.getInstallabilityErrors')
      expect(installabilityErrors).toEqual([])
    })

    test('offline reload shows the seeded data count', async ({ page, context }) => {
      await seedLegacy(page)
      await page.goto(`${base.url}#/week`)
      await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', String(LEGACY_BLOCK_COUNT))
      await waitForActiveServiceWorker(page)
      await page.reload()
      await context.setOffline(true)
      await page.reload()
      await expect(page.getByTestId('block-count')).toHaveAttribute('data-count', String(LEGACY_BLOCK_COUNT))
      await expect(page.getByTestId('block-count')).toHaveText('3 routines saved on this device')
      await context.setOffline(false)
    })

    test('api paths are never served from the cache', async ({ page }) => {
      await page.goto(base.url)
      await waitForActiveServiceWorker(page)
      await page.reload()
      const status = await page.evaluate(async () => (await fetch('./api/ping')).status)
      expect([404, 200]).toContain(status)
      const cached = await page.evaluate(async () => {
        const names = await caches.keys()
        const keys = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))
        return keys.flat().filter((url) => url.includes('/api/'))
      })
      expect(cached).toEqual([])
    })
  })
}

// Google Calendar under the controlling worker (Slice 1 spec §4 "Fetch", acceptance A13): the worker leaves every
// Google request to the network, so an Update is really fetched and nothing of Google lands in Cache Storage.
test.describe('Google Calendar under the service worker', () => {
  test.beforeEach(onlyProject('desktop'))

  test('an Update under the controlling worker reaches the network, renders the event and caches nothing from Google', async ({ page, context }) => {
    const google = await fakeGoogle(context, {
      events: [{ id: 'evt-sw', summary: 'Standup GCal', start: { dateTime: '2026-10-20T09:30:00Z' }, end: { dateTime: '2026-10-20T10:00:00Z' } }],
    })
    await page.clock.install({ time: new Date('2026-10-19T12:00:00.000Z') })
    await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ categories: [{ id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }] })))
    await page.goto(`${BASES[0]!.url}?labs=google-calendar#/settings/calendars`)
    await waitForActiveServiceWorker(page)
    await page.reload()
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    await page.getByTestId('google-connect').click()
    await expect(page.getByTestId('google-continue')).toBeEnabled()
    await page.getByTestId('google-continue').click()
    await expect(page.getByTestId('google-status')).toContainText('1 event')
    await page.getByTestId('google-update').click()
    await expect(page.getByTestId('google-status')).toContainText('1 event')
    expect(google.gisLoads).toBe(1)
    expect(google.apiRequests.length).toBeGreaterThanOrEqual(2)
    await expect(page.getByTestId('calendar-occurrence').filter({ hasText: 'Standup GCal' })).toBeVisible()
    expect((await cachedUrls(page)).filter((url) => /(^|\.)google(apis)?\.com$/.test(new URL(url).hostname))).toEqual([])
    expectNoStrayGoogleTraffic(google)
  })
})
