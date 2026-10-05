import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { AgendaData, AgendaItem } from '../src/types/agenda'

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]) })

const agendaKey = 'next168-agenda-v1'
const routineKey = 'next168-data'
const fixtureDate = '2026-10-05'
function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return { id: 'purchase', title: 'Synthetic grocery purchase', date: fixtureDate, startTime: '18:00', endTime: '19:00',
    kind: 'task', status: 'planned', flexible: true, calendarSelected: false, checklist: ['Rice', 'Coffee'], budgetCop: 120000, ...overrides }
}
function agenda(items: AgendaItem[] = [item()]): AgendaData {
  return { schemaVersion: 1, revision: 'synthetic-initial', timezone: 'America/Bogota', workEnd: '17:00', items, exports: {} }
}
const routine = { categories: [{ id: 'synthetic-category', name: 'Synthetic routine', color: '#123456', weeklyHourLimit: 20 }], timeBlocks: [] }
async function start(page: Page, data = agenda()) {
  // A new Playwright context/profile is created for every test. Block all external traffic.
  await page.context().route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(({ data, routine }) => {
    if (localStorage.getItem('synthetic-fixture-installed')) return
    localStorage.setItem('next168-language', 'en')
    localStorage.setItem('next168-tutorial-completed', 'true')
    localStorage.setItem('next168-data', JSON.stringify(routine))
    localStorage.setItem('next168-agenda-v1', JSON.stringify(data))
    localStorage.setItem('synthetic-fixture-installed', 'true')
  }, { data, routine })
  await page.goto('./')
  await page.getByRole('button', { name: '↗ Agenda', exact: true }).click()
  await page.locator('.agenda > .controls input[type=date]').fill(fixtureDate)
}
async function stored(page: Page): Promise<AgendaData> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), agendaKey)
}
function proposal(data: AgendaData, date: string) {
  return { schemaVersion: 1, baseRevision: data.revision, moves: [{ id: 'purchase', date, startTime: '18:00', endTime: '19:00' }] }
}
async function openAssistant(page: Page) { await page.getByText('Review an assistant proposal', { exact: true }).click() }

test('repeated rescheduling preserves identity, list and budget after reload', async ({ page }, testInfo) => {
  await start(page)
  for (const date of ['2026-10-06', '2026-10-07', '2026-10-08']) {
    await page.getByRole('button', { name: 'Edit / reschedule', exact: true }).click()
    await page.locator('form input[type=date]').fill(date)
    await page.getByRole('button', { name: 'Save item', exact: true }).click()
    await expect(page.locator('article')).toHaveCount(1)
    expect((await stored(page)).items[0]).toMatchObject({ id: 'purchase', date, budgetCop: 120000, checklist: ['Rice', 'Coffee'] })
  }
  await page.reload()
  await page.getByRole('button', { name: '↗ Agenda', exact: true }).click()
  await page.locator('.agenda > .controls input[type=date]').fill('2026-10-08')
  await expect(page.locator('article')).toContainText('Synthetic grocery purchase')
  await expect(page.locator('article')).toContainText('Rice')
  expect((await stored(page)).items).toHaveLength(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('dated-planning.png'), fullPage: true })
})

test('corrupt restore preview leaves durable routine and agenda unchanged', async ({ page }, testInfo) => {
  await start(page)
  const original = await page.evaluate(([a, r]) => [localStorage.getItem(a), localStorage.getItem(r)], [agendaKey, routineKey])
  await page.getByText('Backup and recovery', { exact: true }).click()
  for (const content of ['{broken', JSON.stringify({ schemaVersion: 99, routine, agenda: agenda() }), JSON.stringify({ schemaVersion: 1, routine, agenda: agenda([item(), item()]) })]) {
    await page.getByLabel('Preview backup').setInputFiles({ name: 'synthetic-invalid.json', mimeType: 'application/json', buffer: Buffer.from(content) })
    await expect(page.locator('.agenda [role=alert]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restore reviewed backup', exact: true })).toHaveCount(0)
    expect(await page.evaluate(([a, r]) => [localStorage.getItem(a), localStorage.getItem(r)], [agendaKey, routineKey])).toEqual(original)
  }
  await page.screenshot({ path: testInfo.outputPath('invalid-restore.png'), fullPage: true })
})

test('discarded, stale and cancelled-item proposals never change the plan', async ({ page }, testInfo) => {
  await start(page, agenda([item(), item({ id: 'cancelled', title: 'Synthetic cancelled task', status: 'cancelled', startTime: '20:00', endTime: '21:00' })]))
  await openAssistant(page)
  const initial = await stored(page)
  await page.locator('#assistant-proposal').fill(JSON.stringify(proposal(initial, '2026-10-06')))
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply reviewed changes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Discard proposal', exact: true }).click()
  expect(await stored(page)).toEqual(initial)
  await expect(page.getByRole('button', { name: 'Apply reviewed changes', exact: true })).toHaveCount(0)
  await page.locator('#assistant-proposal').fill(JSON.stringify(proposal(initial, '2026-10-06')))
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click()
  await page.locator('.agenda > .controls select').selectOption('17:30')
  const updated = await stored(page)
  await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click()
  await expect(page.locator('.agenda [role=alert]')).toContainText('stale')
  expect(await stored(page)).toEqual(updated)
  const cancelled = proposal(updated, '2026-10-06'); cancelled.moves[0]!.id = 'cancelled'
  await page.locator('#assistant-proposal').fill(JSON.stringify(cancelled))
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click()
  await expect(page.locator('.agenda [role=alert]')).toContainText('pending')
  await expect(page.locator('.agenda [role=status]')).toHaveCount(0)
  expect(await stored(page)).toEqual(updated)
  await page.screenshot({ path: testInfo.outputPath('rejected-proposal.png'), fullPage: true })
})

test('ICS downloads only chosen events; unchanged repeat remains suppressed after reload', async ({ page }, testInfo) => {
  await start(page, agenda([item(), item({ id: 'meeting', title: 'Synthetic selected meeting', kind: 'meeting', status: 'reserved', calendarSelected: true, startTime: '08:30', endTime: '09:30' })]))
  await page.getByText('Calendar preview (1)', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download chosen events (.ics)', exact: true }).click()
  const file = await download
  const path = testInfo.outputPath('synthetic-selected.ics'); await file.saveAs(path)
  const content = await readFile(path, 'utf8')
  expect(content).toContain('UID:meeting@next168.local\r\n')
  expect(content).toContain('DTSTART:20261005T133000Z\r\n')
  expect(content).not.toContain('UID:purchase')
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Download chosen events (.ics)', exact: true })).toBeDisabled()
  await page.reload(); await page.getByRole('button', { name: '↗ Agenda', exact: true }).click()
  await page.getByText('Calendar preview (0)', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download chosen events (.ics)', exact: true })).toBeDisabled()
  expect(Object.keys((await stored(page)).exports)).toEqual(['meeting'])
  await page.screenshot({ path: testInfo.outputPath('selective-export.png'), fullPage: true })
})

test('reviewed valid backup restores dated items; work window allows personal matters', async ({ page }, testInfo) => {
  await start(page)
  await page.getByText('Backup and recovery', { exact: true }).click()
  const backup = { schemaVersion: 1, routine, agenda: agenda([item({ date: fixtureDate, startTime: '09:30', endTime: '10:00' })]) }
  await page.getByLabel('Preview backup').setInputFiles({ name: 'synthetic-valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(page.getByRole('button', { name: 'Restore reviewed backup', exact: true })).toBeDisabled()
  await page.getByLabel('I reviewed the backup and want to replace the current routine and agenda').check()
  await page.getByRole('button', { name: 'Restore reviewed backup', exact: true }).click()
  await expect(page.locator('article')).toContainText('09:30–10:00')
  await expect(page.locator('.agenda aside.warning')).toContainText('flexible work window')
  expect((await stored(page)).items[0]?.budgetCop).toBe(120000)
  await page.screenshot({ path: testInfo.outputPath('reviewed-restore.png'), fullPage: true })
})
