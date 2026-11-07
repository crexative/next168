import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { V2_KEY, openSettingsPage, seedKey } from './fixtures'
import { previewPorts } from './support/ports'

// Free-tier guard of accounts and sync (design accounts-and-sync.md). WHAT IT TESTS IN S1: the app as built makes no request
// to /api/auth or /api/sync and writes no sync, account or session key, through an edit, an export, Delete all data, an import
// and Delete all data again. WHAT IT DOES NOT TEST YET: nothing imports ACCOUNTS_ENABLED until slice S2, so the second build
// (server mode, VITE_ACCOUNTS=1) is byte-for-byte as inert as the first, and the comparison between them cannot fail today.
// It is an S2 placeholder: it starts to bite when the client code lands behind the flag. The flag-off server behaviour that
// is real in S1 is proven by server/accounts/guards.spec.ts.

test.use({ serviceWorkers: 'block' })
test.beforeEach(({}, testInfo) => {
  test.skip(!['desktop', 'webkit-phone'].includes(testInfo.project.name), 'runs on desktop and WebKit')
})

const FLAG_OFF = '/'
const FLAG_ON = `http://127.0.0.1:${previewPorts().server}/`
const ACCOUNT_ROUTES = /\/api\/(auth|sync)(\/|$|\?)/
const FIXTURE = 'src/core/__fixtures__/ics/google.ics'
const DOCUMENT = {
  schemaVersion: 2, workspaceId: 'accounts-guard-e2e', revision: 0, updatedAt: '2026-10-19T00:00:00.000Z',
  settings: { locale: 'en', timeZone: 'UTC', weekStartsOn: 1, onboardingDone: true, theme: 'system' },
  categories: [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'focus', title: 'Focus', categoryId: 'work', days: [1], start: 540, end: 600 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}

interface Footprint {
  indexedDb: Record<string, Record<string, string[]>>
  localStorage: string[]
  sessionStorage: string[]
  cookies: string[]
  caches: string[]
}

async function footprint(page: Page, context: BrowserContext): Promise<Footprint> {
  const inPage = await page.evaluate(async () => {
    const request = <T>(make: () => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      const pending = make()
      pending.onsuccess = () => resolve(pending.result)
      pending.onerror = () => reject(pending.error)
    })
    const indexedDb: Record<string, Record<string, string[]>> = {}
    for (const { name } of await indexedDB.databases()) {
      const db = await request(() => indexedDB.open(name!))
      const stores: Record<string, string[]> = {}
      for (const store of Array.from(db.objectStoreNames).sort()) {
        stores[store] = (await request(() => db.transaction(store, 'readonly').objectStore(store).getAllKeys())).map(String).sort()
      }
      indexedDb[name!] = stores
      db.close()
    }
    return {
      indexedDb,
      localStorage: Object.keys(window.localStorage).sort(),
      sessionStorage: Object.keys(window.sessionStorage).sort(),
      caches: (await window.caches?.keys?.().catch(() => [])) ?? [],
    }
  })
  return { ...inPage, cookies: (await context.cookies()).map((cookie) => cookie.name).sort() }
}

async function journey(page: Page, base: string, requests: string[]): Promise<void> {
  page.on('request', (request) => requests.push(request.url()))
  await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') })
  await seedKey(page, V2_KEY, JSON.stringify(DOCUMENT))
  // An edit: a calendar file added to the plan.
  await openSettingsPage(page, 'calendars', base)
  await page.getByLabel('Import .ics file', { exact: true }).setInputFiles(FIXTURE)
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
  // Export, Delete all data, Import the export back, Delete all data again.
  await openSettingsPage(page, 'data', base)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
  const exported = await (await download).path()
  const erase = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Delete all data…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
    await dialog.getByRole('textbox').fill('delete')
    await dialog.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.getByTestId('data-notice')).toContainText('All data was deleted')
  }
  await erase()
  await page.getByLabel('Choose a Weeklid export file').setInputFiles({ name: 'weeklid.json', mimeType: 'application/json', buffer: readFileSync(exported!) })
  await page.getByTestId('import-preview').getByRole('button', { name: 'Replace my data' }).click()
  await expect(page.getByTestId('data-notice')).toContainText('Imported and verified')
  await erase()
}

test('the app as built makes no account request and writes no account key; the flag-on comparison is an S2 placeholder @smoke', async ({ context, page }) => {
  const requests: Record<'off' | 'on', string[]> = { off: [], on: [] }
  await journey(page, FLAG_OFF, requests.off)
  const off = await footprint(page, context)

  const second = await context.newPage()
  await journey(second, FLAG_ON, requests.on)
  const on = await footprint(second, context)

  for (const [label, seen] of Object.entries(requests)) {
    expect(seen.length, `${label}: the journey made requests`).toBeGreaterThan(0)
    expect(seen.filter((url) => ACCOUNT_ROUTES.test(new URL(url).pathname + new URL(url).search)), `${label}: account requests`).toEqual([])
  }
  for (const [label, found] of Object.entries({ off, on })) {
    const meta = found.indexedDb.next168?.meta ?? []
    expect(meta, `${label}: meta keys`).not.toContain('sync')
    expect(meta, `${label}: meta keys`).not.toContain('sync-base')
    expect(meta, `${label}: meta keys`).not.toContain('sync-conflict')
    expect(found.cookies.filter((name) => name.startsWith('__Host-wl_ses') || name.startsWith('__Host-wl_aflow')), `${label}: account cookies`).toEqual([])
    const names = [
      ...Object.entries(found.indexedDb).flatMap(([db, stores]) => [db, ...Object.entries(stores).flatMap(([store, keys]) => [store, ...keys])]),
      ...found.localStorage, ...found.sessionStorage, ...found.cookies, ...found.caches,
    ]
    expect(names.filter((name) => /sync|account|session/i.test(name)), `${label}: any storage name mentioning sync, account or session`).toEqual([])
  }
  // The flag on, signed out, writes exactly what the flag off writes.
  expect(on).toEqual(off)
})

test('STORAGE_VERSION is still 3 in the flag-on build (S2 placeholder)', async ({ page }) => {
  await seedKey(page, V2_KEY, JSON.stringify(DOCUMENT))
  await openSettingsPage(page, 'data', FLAG_ON)
  const versions = await page.evaluate(async () => Object.fromEntries(await Promise.all((await indexedDB.databases()).map(async ({ name }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(name!); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error) })
    const version = db.version
    db.close()
    return [name!, version] as const
  }))))
  expect(versions).toEqual({ next168: 3, 'next168-calendars': 3 })
})
