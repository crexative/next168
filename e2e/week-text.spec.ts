import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { itemsMissingTitles, seededTitles, type SeededTitles } from './support/week'
import { SEEDED_NOW, VERIFY6_NOW, VERIFY6_WEEK, weekFor } from './support/weekLayouts'

// Week text, property style (docs/design/visual-design.md › Week items): many seeded weeks of 5 to 15 minute routines,
// back-to-back short tasks, events on a routine's title row, overnight items and 2 to 4 overlapping lanes, each audited
// at every supported width, light and dark, 100 % and 200 % text, in Spanish, English or German. No text in a day
// column may be cut, truncated or covered by another item (the whole-text rule of the visual-integrity guard).

const SEEDS = Array.from({ length: 48 }, (_, index) => index + 1)
const WIDE = [768, 1024, 1440, 1920] as const

async function settled(page: Page): Promise<void> {
  // The columns measure themselves after a resize or a text size change; two frames let the plan redraw.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

// The audit holds every day column to the whole-text rule, whatever the component marks.
async function auditWeek(page: Page, state: string, columns: number, titles?: SeededTitles): Promise<void> {
  await settled(page)
  const marked = await page.evaluate(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>('.day-column'))
    found.forEach((column) => { if (!column.hasAttribute('data-whole-text')) column.setAttribute('data-whole-text', '') })
    return found.length
  })
  expect(marked, `${state}: day columns on the page`).toBeGreaterThanOrEqual(columns)
  const violations = await visualIntegrityViolations(page, { focusRings: false })
  if (violations.length) await page.screenshot({ path: test.info().outputPath(`${state.replace(/[^\w%-]+/g, '-')}.png`), fullPage: true })
  expect.soft(violations, state).toEqual([])
  // Whatever is drawn, every routine, event and task keeps its full seeded title in its accessible name.
  if (titles) expect.soft((await itemsMissingTitles(page, titles)).missing, `${state}: accessible names`).toEqual([])
}

async function setTextSize(page: Page, percent: number): Promise<void> {
  await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%` }, percent)
}

// Every width at 100 % and 200 % text, alternating light and dark, then the seven-day overview on the phone.
async function auditEverySize(page: Page, label: string, phone: number, seed: number, titles?: SeededTitles): Promise<void> {
  let state = 0
  const theme = async () => {
    const scheme = (seed + state++) % 2 === 0 ? 'light' : 'dark'
    await page.emulateMedia({ colorScheme: scheme })
    return scheme
  }
  for (const percent of [100, 200]) {
    await setTextSize(page, percent)
    await page.setViewportSize({ width: phone, height: 720 })
    await auditWeek(page, `${label} ${await theme()} ${phone} px ${percent} % (day pages)`, 7, titles)
    for (const width of WIDE) {
      await page.setViewportSize({ width, height: 900 })
      await auditWeek(page, `${label} ${await theme()} ${width} px ${percent} %`, 7, titles)
    }
  }
  await setTextSize(page, 100)
  await page.setViewportSize({ width: phone, height: 720 })
  await settled(page)
  await page.getByTestId('week-view-toggle').click()
  await expect(page.getByTestId('week-overview')).toBeVisible()
  await auditWeek(page, `${label} ${await theme()} ${phone} px overview`, 7, titles)
}

async function importCalendar(page: Page, text: string): Promise<void> {
  await page.goto('./#/settings/calendars')
  const before = await page.getByTestId('calendar-source').count()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'week.ics', mimeType: 'text/calendar', buffer: Buffer.from(text) })
  await expect(page.getByTestId('calendar-source')).toHaveCount(before + 1)
}

// The titles of the week as it was seeded (read back from the seed, not from anything the page draws).
async function seededWeek(page: Page): Promise<SeededTitles> {
  return seededTitles(await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)!), V2_KEY))
}

async function openWeek(page: Page): Promise<void> {
  await page.goto('./#/week')
  await expect(page.locator('.day-column').first()).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
}

// The weeks verify4 and verify5 reported (R1, defect 11a, N1, N2): a 15-minute stand-up right above "Trabajo profundo",
// "Revisión de diseño de producto" on its title row, back-to-back short tasks, and "Vendor call" / "Team sync" beside
// "Deep work".
test.describe('Week text is whole in the weeks verify4 and verify5 reported', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'these weeks set their own widths and run once')
  })

  test('verify5 N1/N2: stand-up, design review and short tasks (Spanish)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 320, height: 720 })
    await page.clock.install({ time: new Date('2026-10-21T10:07:00.000Z') })
    await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
    await seedKey(page, V2_KEY, JSON.stringify({
      schemaVersion: 2, workspaceId: 'workspace-v5', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
      settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
      categories: [
        { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
        { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
        { id: 'c-exercise', name: 'Ejercicio', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 3 } },
        { id: 'c-meals', name: 'Comidas', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
        { id: 'c-study', name: 'Estudio', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 3 } },
      ],
      blocks: [
        { id: 'b-standup', categoryId: 'c-work', title: 'Reunión diaria', days: [1, 2, 3, 4, 5], start: 540, end: 555 },
        { id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [1, 2, 3, 4, 5], start: 555, end: 780 },
        { id: 'b-lunch', categoryId: 'c-meals', title: 'Almuerzo', days: [1, 2, 3, 4, 5], start: 780, end: 840 },
        { id: 'b-work2', categoryId: 'c-work', title: 'Trabajo de la tarde', days: [1, 2, 3, 4, 5], start: 840, end: 1020 },
        { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
        { id: 'b-gym', categoryId: 'c-exercise', title: 'Gimnasio', days: [1, 3, 5], start: 1080, end: 1140 },
        { id: 'b-english', categoryId: 'c-study', title: 'Curso de inglés', days: [2, 4], start: 1170, end: 1260 },
      ],
      tasks: [
        { id: 't-1', title: 'Responder correos', categoryId: 'c-work', durationMin: 15, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' },
        { id: 't-2', title: 'Llamar al banco', categoryId: 'c-work', durationMin: 15, priority: 2, createdAt: '2026-10-20T08:01:00.000Z' },
        { id: 't-3', title: 'Revisar presupuesto trimestral', categoryId: 'c-work', durationMin: 30, priority: 1, dueDate: '2026-10-22', createdAt: '2026-10-20T08:02:00.000Z' },
        { id: 't-4', title: 'Leer un capítulo', durationMin: 45, priority: 3, createdAt: '2026-10-20T08:03:00.000Z' },
      ],
      checkIns: [], actuals: [],
      events: [
        { id: 'e-1', title: 'Llamada con proveedor', start: '2026-10-21T10:30:00.000Z', end: '2026-10-21T11:30:00.000Z', allDay: false, attendees: [] },
        { id: 'e-2', title: 'Revisión de diseño de producto', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, attendees: [] },
        { id: 'e-3', title: 'Cita médica', start: '2026-10-22T18:00:00.000Z', end: '2026-10-22T19:00:00.000Z', allDay: false, attendees: [] },
      ],
      calendarSources: [], appliedProposalIds: [],
    }))
    await openWeek(page)
    await auditEverySize(page, 'verify5 es', 320, 0, await seededWeek(page))
  })

  // verify6 D1/D2/D3: routines blank beside a short event, a task with room for "Preparar…", 10–20 minute strips.
  test('verify6 f3: a family and work week with short routines and events beside long ones (Spanish)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 375, height: 720 })
    await page.clock.install({ time: VERIFY6_NOW })
    await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
    await seedKey(page, V2_KEY, JSON.stringify(VERIFY6_WEEK))
    await openWeek(page)
    await auditEverySize(page, 'verify6 f3 es', 375, 0, seededTitles(VERIFY6_WEEK))
  })

  test('verify4/verify5 R1: "Vendor call" and "Team sync" beside "Deep work" (English)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 375, height: 720 })
    await page.clock.install({ time: new Date('2026-10-21T10:15:00.000Z') })
    await seedKey(page, V2_KEY, JSON.stringify({
      schemaVersion: 2, workspaceId: 'workspace-e2e', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
      settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
      categories: [
        { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
        { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
        { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
      ],
      blocks: [
        { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 },
        { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
        { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [3], start: 1080, end: 1140 },
      ],
      tasks: [
        { id: 't-report', title: 'Write quarterly report', categoryId: 'c-work', durationMin: 90, dueDate: '2026-10-23', priority: 1, createdAt: '2026-10-20T08:00:00.000Z' },
        { id: 't-prs', title: 'Review open pull requests', categoryId: 'c-work', durationMin: 60, priority: 2, createdAt: '2026-10-20T08:05:00.000Z' },
        { id: 't-run', title: 'Plan the long run route', categoryId: 'c-exercise', durationMin: 45, priority: 3, createdAt: '2026-10-20T08:10:00.000Z' },
      ],
      checkIns: [{ date: '2026-10-20' }], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
    }))
    await importCalendar(page, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:verify-team-sync@example.invalid', 'DTSTART:20261022T093000Z', 'DTEND:20261022T103000Z', 'SUMMARY:Team sync', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'))
    await importCalendar(page, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:feed-1@example.invalid', 'DTSTART:20261023T093000Z', 'DTEND:20261023T100000Z', 'SUMMARY:Vendor call', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:feed-2@example.invalid', 'DTSTART:20261020T140000Z', 'DTEND:20261020T150000Z', 'SUMMARY:Dentist', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n'))
    await openWeek(page)
    await auditEverySize(page, 'verify4 R1 en', 375, 1, await seededWeek(page))
  })
})

test.describe('Week text is whole in every seeded layout', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the seeded layouts set their own widths and run once')
  })

  for (const seed of SEEDS) {
    test(`seed ${seed}`, async ({ page }) => {
      test.setTimeout(120_000)
      const { locale, document, calendar } = weekFor(seed)
      const phone = seed % 2 === 0 ? 320 : 375
      await page.setViewportSize({ width: phone, height: 720 })
      await page.clock.install({ time: SEEDED_NOW })
      await seedKey(page, V2_KEY, JSON.stringify(document))
      if (calendar) await importCalendar(page, calendar)
      await openWeek(page)
      await auditEverySize(page, `seed ${seed} ${locale}`, phone, seed, seededTitles(document))
    })
  }
})

// Re-planning must not leak: the columns re-measure on every resize and text-size change (probes, observers, caches).
// Measured with the DevTools protocol (Chromium): DOM nodes and event listeners stay flat over hundreds of re-plans.
test('re-planning Week across hundreds of widths and both text sizes keeps nodes and listeners flat', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one Chromium measurement is enough')
  test.setTimeout(120_000)
  const { document } = weekFor(31)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install({ time: SEEDED_NOW })
  await seedKey(page, V2_KEY, JSON.stringify(document))
  await openWeek(page)
  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  const counts = async () => {
    await client.send('HeapProfiler.collectGarbage')
    const { metrics } = await client.send('Performance.getMetrics')
    const pick = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? Number.NaN
    return { nodes: pick('Nodes'), listeners: pick('JSEventListeners') }
  }
  const replan = async (from: number) => {
    for (const percent of [100, 200]) {
      await setTextSize(page, percent)
      for (let width = from; width <= 1900; width += 20) {
        await page.setViewportSize({ width, height: 900 })
        await settled(page)
      }
    }
    await setTextSize(page, 100)
    await page.setViewportSize({ width: 1440, height: 900 })
    await settled(page)
  }
  await replan(768)
  const before = await counts()
  await replan(771)
  await replan(774)
  const after = await counts()
  expect(after.listeners, 'event listeners').toBe(before.listeners)
  expect(Math.abs(after.nodes - before.nodes), `DOM nodes ${before.nodes} → ${after.nodes}`).toBeLessThanOrEqual(20)
})
