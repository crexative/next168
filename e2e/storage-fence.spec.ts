// Slice 0 (storage fence), real builds on one origin: the pre-fence build (239b9bc) at /old/ and the new build at /.
// F-04 (old tabs are fenced out after the new tab upgrades) and the e2e parts of F-05 (the pre-upgrade download imports
// into both builds up to 25 MiB, and is complete but refused above it).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { ensurePreFenceBuild } from '../config/preFence'
import { validateBundleV2 } from '../src/core/legacy/v2'
import { buildExportBundle, portableHash } from '../src/core/exportBundle'
import type { PlannerDocument } from '../src/core/model'
import { onlyProject } from './fixtures'
import { previewPorts } from './support/ports'
import { onboardedDocument, seedOnboarded } from './support/seed'
import { dumpOrigin, seedVersionOne, serveTwoBuilds, storedPlan, type TwoBuilds } from './support/twoBuilds'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MiB = 1024 * 1024
const IMPORT_LIMIT = 25 * MiB

test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block' })
test.beforeEach(onlyProject('desktop'))

let builds: TwoBuilds
let oldDist: string

test.beforeAll(async ({ browserName }, testInfo) => {
  if (testInfo.project.name !== 'desktop' || browserName !== 'chromium') return
  test.setTimeout(600_000)
  oldDist = ensurePreFenceBuild(ROOT)
  builds = await serveTwoBuilds(previewPorts().root + 2, `${ROOT}dist`, oldDist)
})

test.afterAll(async () => { await builds?.close() })

const ics = (title: string, padding = '') => {
  const head = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//next168//fence-e2e//EN\r\nBEGIN:VEVENT\r\nUID:${title.replace(/\W/g, '')}@fence\r\n`
  const tail = `DTSTART:20261019T140000Z\r\nDTEND:20261019T150000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
  return padding ? `${head}X-PADDING:${padding}\r\n${tail}` : head + tail
}
const icsOfBytes = (title: string, bytes: number) => ics(title, 'p'.repeat(bytes - Buffer.byteLength(ics(title, 'x')) + 1 - 'X-PADDING:\r\n'.length))

const FEED_URL = 'https://calendar.example.invalid/team.ics'

function planWith(sources: PlannerDocument['calendarSources'], revision = 2): PlannerDocument {
  return onboardedDocument({
    workspaceId: 'ws-fence-e2e', revision,
    categories: [{ id: 'c-work', name: 'SENTINEL work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }],
    blocks: revision > 1 ? [{ id: 'b-focus', categoryId: 'c-work', title: 'Focus', days: [1], start: 540, end: 600 }] : [],
    calendarSources: sources,
  }) as unknown as PlannerDocument
}

async function portableOf(document: PlannerDocument, texts: Record<string, string>): Promise<string> {
  const referenced = Object.fromEntries(document.calendarSources.map((source) => [source.id, texts[source.id] ?? '']))
  return portableHash(buildExportBundle(document, referenced, { now: () => new Date('2026-10-25T00:00:00.000Z') }))
}

async function storedPortableHash(page: Page): Promise<string> {
  const { document, texts } = await storedPlan(page)
  return portableOf(JSON.parse(document), texts)
}

async function openOld(page: Page, hash: string, host: '127.0.0.1' | 'localhost' = '127.0.0.1'): Promise<void> {
  await page.goto(`${builds.origin(host)}/old/${hash}`)
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC' })
  return context.newPage()
}

async function download(page: Page, button: string, path: string, name?: RegExp): Promise<string> {
  const pending = page.waitForEvent('download')
  await page.getByTestId('pre-upgrade-copy').getByRole('button', { name: button }).click()
  const file = await pending
  if (name) expect(file.suggestedFilename()).toMatch(name)
  await file.saveAs(path)
  return path
}

// Imports a file through the build's own Settings › Your data, returning the notice it shows. Builds from before
// the rename to Weeklid name the field after Next168.
async function importFile(page: Page, file: string): Promise<string> {
  await page.getByLabel(/^Choose a (?:Weeklid|Next168) export file$/).setInputFiles(file)
  const preview = page.getByTestId('import-preview')
  const notice = page.getByTestId('data-notice')
  await expect(preview.or(notice)).toBeVisible({ timeout: 60_000 })
  if (await preview.isVisible()) {
    await preview.getByRole('button', { name: 'Replace my data' }).click()
    await expect(notice).toContainText(/Imported and verified|failed/, { timeout: 120_000 })
  }
  return (await notice.textContent()) ?? ''
}

async function onDataPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 2, name: 'Your data', exact: true })).toBeVisible({ timeout: 30_000 })
}

test('F-04: after the new build upgrades, old tabs on the same origin are fenced out and change nothing', async ({ context, page }, testInfo) => {
  let feed = ics('SENTINEL refreshed before the upgrade')
  await context.route(FEED_URL, (route) => route.fulfill({ contentType: 'text/calendar', body: feed }))
  await page.goto(`${builds.origin()}/blank.html`)
  const document = planWith([{ id: 'cal-feed', name: 'Team feed', kind: 'url', url: FEED_URL, colorKey: 'blue' }])
  await seedVersionOne(page, { document: JSON.stringify(document), texts: { 'cal-feed': ics('SENTINEL original') } })

  // 1. Three old tabs load the plan.
  const edit = await context.newPage()
  // A lost change notification (the new tab's commits broadcast one), so each old tab's next action is the first
  // thing it does with storage after the upgrade: the write paths themselves must be fenced.
  const deaf = { content: 'window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} removeEventListener() {} set onmessage(_) {} }' }
  const refresh = await context.newPage()
  const erase = await context.newPage()
  for (const tab of [edit, refresh, erase]) await tab.addInitScript(deaf)
  for (const tab of [edit, refresh]) {
    await openOld(tab, '#/settings/calendars')
    await expect(tab.getByTestId('calendar-source')).toHaveCount(1)
  }
  await openOld(erase, '#/settings/data')
  await erase.getByRole('button', { name: 'Delete all data…' }).click()
  await erase.getByRole('dialog', { name: 'Delete everything?' }).getByRole('textbox').fill('delete')
  expect((await dumpOrigin(page)).versions).toEqual({ next168: 1, 'next168-calendars': 1 })

  // 2. The new tab opens, which upgrades both databases (and refreshes the feed on open: wait for that commit).
  feed = ics('SENTINEL refreshed by the new tab')
  await page.goto(`${builds.origin()}/#/settings/calendars`)
  await expect(page.getByTestId('calendar-source')).toHaveCount(1)
  await expect.poll(async () => (await storedPlan(page)).texts['cal-feed']).toContain('SENTINEL refreshed by the new tab')
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  feed = ics('SENTINEL refreshed by an old tab')
  const upgraded = await dumpOrigin(page)
  expect(upgraded.versions).toEqual({ next168: 3, 'next168-calendars': 3 })

  // 3–4. The old tabs' next edit, calendar refresh and delete-all each fail visibly and change nothing.
  await edit.getByRole('textbox', { name: 'Rename Team feed' }).fill('SENTINEL renamed by the old tab')
  await edit.getByRole('textbox', { name: 'Rename Team feed' }).press('Tab')
  await expect(edit.getByTestId('storage-error')).toBeVisible()
  expect(await dumpOrigin(page)).toEqual(upgraded)

  // The pre-fence refresh reads the old text first; that read fails, so it reports calendar storage (or, if its
  // planner reload ran first, the storage-error screen). Either way nothing is written.
  await refresh.getByRole('button', { name: 'Refresh', exact: true }).click()
  const calendarAlert = refresh.getByRole('alert').filter({ hasText: 'Calendar storage is unavailable' })
  await expect(calendarAlert.or(refresh.getByTestId('storage-error'))).toBeVisible()
  testInfo.annotations.push({ type: 'old refresh outcome', description: (await calendarAlert.isVisible()) ? 'calendar storage alert' : 'storage-error screen' })
  expect(await dumpOrigin(page)).toEqual(upgraded)

  await erase.getByRole('dialog', { name: 'Delete everything?' }).getByRole('button', { name: 'Delete everything' }).click()
  await expect(erase.getByTestId('storage-error')).toBeVisible()
  expect(await dumpOrigin(page)).toEqual(upgraded)

  // 5. The same URL now serves the new build (the update); reloading the old tab shows the plan.
  builds.serveAtOld(`${ROOT}dist`)
  try {
    await edit.reload()
    await expect(edit.getByTestId('calendar-source')).toHaveCount(1)
    await expect(edit.getByRole('textbox', { name: 'Rename Team feed' })).toHaveValue('Team feed')
  } finally {
    builds.serveAtOld(oldDist)
  }
})

test('F-05 (a): the pre-upgrade download keeps the original calendar bytes and imports into both builds', async ({ context, page, browser }, testInfo) => {
  const sources: PlannerDocument['calendarSources'] = [
    { id: 'cal-url', name: 'Team feed', kind: 'url', url: FEED_URL, colorKey: 'blue' },
    { id: 'cal-file', name: 'Holidays', kind: 'file', colorKey: 'green' },
    { id: 'cal-nonascii', name: 'Café 日本', kind: 'file', colorKey: 'purple' },
  ]
  const texts = {
    'cal-url': ics('SENTINEL url original'), 'cal-file': ics('SENTINEL file'),
    'cal-nonascii': ics('SENTINEL Reunión café ☕ 日本語 ñandú'), 'cal-orphan': ics('SENTINEL orphan'),
  }
  const document = planWith(sources)
  const backup = JSON.stringify(planWith(sources, 1))
  const proposals = JSON.stringify([{
    id: 'p-1', workspaceId: document.workspaceId, source: 'mcp', baseRevision: 2, contentHash: 'a'.repeat(64), summary: 'SENTINEL proposal',
    ops: [{ op: 'add_block', block: { categoryId: 'c-work', title: 'Plan', days: [2], start: 540, end: 600 } }], status: 'pending', createdAt: '2026-10-24T12:00:00.000Z',
  }])
  const expected = await portableOf(document, texts)
  await context.route(FEED_URL, (route) => route.fulfill({ contentType: 'text/calendar', body: ics('SENTINEL url refreshed') }))

  await page.goto(`${builds.origin()}/blank.html`)
  await seedVersionOne(page, { document: JSON.stringify(document), backup, proposals, texts })
  // The pre-fence build loads it (a view that does not refresh calendars on open, so the seed stays as it is).
  const old = await context.newPage()
  await openOld(old, '#/settings/advanced')
  await expect(old.getByTestId('data-workspace')).toHaveText(document.workspaceId)
  await old.close()
  expect((await dumpOrigin(page)).versions).toEqual({ next168: 1, 'next168-calendars': 1 })

  // The new build upgrades; then a refresh, a deletion and three ordinary commits.
  await page.goto(`${builds.origin()}/#/settings/calendars`)
  await expect(page.getByTestId('calendar-source')).toHaveCount(3)
  await page.getByTestId('calendar-source').filter({ has: page.getByRole('textbox', { name: 'Rename Team feed' }) }).getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(async () => (await storedPlan(page)).texts['cal-url']).toContain('SENTINEL url refreshed')
  await page.getByTestId('calendar-source').filter({ has: page.getByRole('textbox', { name: 'Rename Holidays' }) }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByTestId('calendar-source')).toHaveCount(2)
  let name = 'Café 日本'
  for (const next of ['One', 'Two', 'Three']) {
    await page.getByRole('textbox', { name: `Rename ${name}` }).fill(next)
    await page.getByRole('textbox', { name: `Rename ${name}` }).press('Tab')
    await expect(page.getByRole('textbox', { name: `Rename ${next}` })).toBeVisible()
    name = next
  }
  expect(JSON.parse((await storedPlan(page)).document).revision).toBeGreaterThanOrEqual(document.revision + 5)

  await onDataPage(page, `${builds.origin()}/#/settings/data`)
  const row = page.getByTestId('pre-upgrade-copy')
  await expect(row).toContainText('Copy from before the update')
  await expect(row).toContainText('It includes your calendars.')
  await expect(page.getByTestId('pre-upgrade-size')).toHaveText(/^\d+(\.\d)? (KB|MB)$/)
  await expect(page.getByTestId('pre-upgrade-too-large')).toHaveCount(0)
  const bundlePath = await download(page, 'Download copy', testInfo.outputPath('before-update.json'), /^weeklid-before-update-\d{4}-\d\d-\d\d\.json$/)
  const rawPath = await download(page, 'Download raw data', testInfo.outputPath('before-update-raw.json'), /^weeklid-before-update-raw-\d{4}-\d\d-\d\d\.json$/)
  expect(await portableHash(JSON.parse(readFileSync(bundlePath, 'utf8')))).toBe(expected)
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  expect(raw.raw).toMatchObject({ document: JSON.stringify(document), backup, proposals })
  expect(raw.calendarSourceTexts).toEqual(texts)

  // Into the new build, in a fresh context.
  const fresh = await freshPage(browser)
  await seedOnboarded(fresh)
  await onDataPage(fresh, `${builds.origin()}/#/settings/data`)
  expect(await importFile(fresh, bundlePath)).toContain('Imported and verified')
  expect(await storedPortableHash(fresh)).toBe(expected)
  await fresh.context().close()

  // Into the pre-fence build, on a second origin.
  const pre = await freshPage(browser)
  await seedOnboarded(pre)
  await onDataPage(pre, `${builds.origin('localhost')}/old/#/settings/data`)
  expect(await importFile(pre, bundlePath)).toContain('Imported and verified')
  expect((await dumpOrigin(pre)).versions).toEqual({ next168: 1, 'next168-calendars': 1 })
  expect(await storedPortableHash(pre)).toBe(expected)
  await pre.context().close()
})

// A schema-valid bundle file of exactly `bytes` serialized bytes (five file calendars padded with valid ICS).
function bundleOfBytes(bytes: number): string {
  const sources = Array.from({ length: 5 }, (_, index) => ({ id: `cal-${index}`, name: `Calendar ${index}`, kind: 'file' as const, colorKey: 'blue' as const }))
  const document = planWith(sources)
  // A version-2 file, as both builds read it (the current build widens it to v3 on import).
  const serialize = (texts: Record<string, string>) => JSON.stringify(validateBundleV2({ format: 'next168-export', bundleVersion: 1, exportedAt: '2026-10-25T00:00:00.000Z', document, calendarSourceTexts: texts }), null, 2)
  const minimal = Object.fromEntries(sources.map((source) => [source.id, ics(source.id, 'x')]))
  let remaining = bytes - Buffer.byteLength(serialize(minimal))
  const texts = Object.fromEntries(sources.map((source) => {
    const extra = Math.min(remaining, 5 * MiB - Buffer.byteLength(minimal[source.id]!))
    remaining -= extra
    return [source.id, ics(source.id, 'x'.repeat(1 + extra))]
  }))
  const json = serialize(texts)
  if (Buffer.byteLength(json) !== bytes) throw new Error(`fixture is ${Buffer.byteLength(json)} bytes, wanted ${bytes}`)
  return json
}

test('F-05 (b): a file of exactly 25 MiB imports into both builds; one more byte is refused and changes nothing', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const exact = testInfo.outputPath('exact.json')
  const over = testInfo.outputPath('over.json')
  writeFileSync(exact, bundleOfBytes(IMPORT_LIMIT))
  writeFileSync(over, bundleOfBytes(IMPORT_LIMIT + 1))
  for (const url of [`${builds.origin()}/#/settings/data`, `${builds.origin('localhost')}/old/#/settings/data`]) {
    const page = await freshPage(browser)
    await seedOnboarded(page)
    await onDataPage(page, url)
    const before = await dumpOrigin(page)
    expect([url, await importFile(page, over)]).toEqual([url, 'This file is too large to import.'])
    expect(await dumpOrigin(page)).toEqual(before)
    expect([url, await importFile(page, exact)]).toEqual([url, expect.stringContaining('Imported and verified')])
    await page.context().close()
  }
})

test('F-05 (c): an over-limit plan keeps a complete download that both builds refuse without changing anything', async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000)
  const sources = Array.from({ length: 6 }, (_, index) => ({ id: `cal-big-${index}`, name: `Big ${index}`, kind: 'file' as const, colorKey: 'blue' as const }))
  const texts = Object.fromEntries(sources.map((source) => [source.id, icsOfBytes(`SENTINEL ${source.id}`, 5 * MiB)]))
  const document = planWith(sources)
  const expected = await portableOf(document, texts)
  await page.goto(`${builds.origin()}/blank.html`)
  await seedVersionOne(page, { document: JSON.stringify(document), texts })

  await onDataPage(page, `${builds.origin()}/#/settings/data`)
  const tooLarge = page.getByTestId('pre-upgrade-too-large')
  await expect(tooLarge).toContainText(/It's \d+ MB: more than the app can import \(26 MB\)/, { timeout: 60_000 })
  const bundlePath = await download(page, 'Download copy', testInfo.outputPath('over-limit.json'))
  const bytes = readFileSync(bundlePath)
  expect(bytes.length).toBeGreaterThan(30 * MiB)
  await expect(tooLarge).toContainText(`It's ${Math.ceil(bytes.length / MiB)} MB`)
  expect(await portableHash(JSON.parse(bytes.toString('utf8')))).toBe(expected)

  for (const url of [`${builds.origin()}/#/settings/data`, `${builds.origin('localhost')}/old/#/settings/data`]) {
    const target = await freshPage(browser)
    await seedOnboarded(target)
    await onDataPage(target, url)
    const before = await dumpOrigin(target)
    expect([url, await importFile(target, bundlePath)]).toEqual([url, 'This file is too large to import.'])
    expect(await dumpOrigin(target)).toEqual(before)
    await target.context().close()
  }
})
