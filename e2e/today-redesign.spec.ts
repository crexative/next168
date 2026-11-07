import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { expectNoStrayGoogleTraffic, fakeGoogle } from './support/googleCalendar'
import { fakeGoogleServer, newWorld } from './support/googleServer'
import { previewPorts } from './support/ports'
import { storedPlanner } from './support/indexedDb'
import { visualIntegrityViolations } from './support/visualIntegrity'

// The Today redesign (docs/design/today-screen.md §12). The fixture is the spec's: one synthetic Friday (2026-11-06,
// UTC) with routines, two Weeklid events and a fixed-time task. Each test names the acceptance checks it covers.
test.use({ serviceWorkers: 'block', locale: 'es-CO' })

const SIZES = [
  { name: '375x812', width: 375, height: 812 },
  { name: '1440x900', width: 1440, height: 900 },
] as const
const THEMES = ['light', 'dark'] as const
const DAY = '2026-11-06'

// "HH:MM" or "HH:MM:SS" on the fixture day, as an ISO instant.
const iso = (time: string) => `${DAY}T${time.length === 5 ? `${time}:00` : time}.000Z`
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const WEEKDAYS = [1, 2, 3, 4, 5]
const block = (id: string, categoryId: string, title: string, start: string, end: string, days = WEEKDAYS) => ({ id, categoryId, title, days, start: minute(start), end: minute(end) })
const answer = (blockId: string, categoryId: string, start: string, end: string, status: 'done' | 'skipped' = 'done') => ({
  date: DAY, blockId, categoryId, plannedStartAt: iso(start), plannedEndAt: iso(end), plannedMinutes: minute(end) - minute(start), status,
})
const weeklidEvent = (id: string, title: string, start: string, end: string) => ({ id, title, start: iso(start), end: iso(end), allDay: false, attendees: [] })

const BASE = {
  schemaVersion: 3,
  generation: 0,
  workspaceId: 'workspace-today-redesign',
  revision: 1,
  updatedAt: '2026-11-05T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-move', name: 'Traslados', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'c-exercise', name: 'Ejercicio', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 5 } },
    { id: 'c-side', name: 'Proyectos', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    block('b-sleep', 'c-sleep', 'Sueño', '23:00', '07:00', [0, 1, 2, 3, 4, 5, 6]),
    block('b-commute-am', 'c-move', 'Traslado', '08:30', '09:00'),
    block('b-work', 'c-work', 'Trabajo', '09:00', '17:00'),
    block('b-commute-pm', 'c-move', 'Traslado de regreso', '17:00', '17:30'),
    block('b-exercise', 'c-exercise', 'Ejercicio', '18:00', '19:00'),
    block('b-side', 'c-side', 'Proyecto personal', '19:00', '20:00'),
  ],
  tasks: [{ id: 't-report', title: 'Informe', categoryId: 'c-work', durationMin: 45, dueDate: DAY, at: minute('10:00'), priority: 1, createdAt: '2026-11-01T08:00:00.000Z' }],
  // An older check-in shows the plan existed before today, so today's blocks can be asked about.
  checkIns: [{ date: '2026-11-05', bedtime: 1380, wake: 420, exercise: 'yes', stress: 2 }],
  actuals: [] as unknown[],
  events: [weeklidEvent('e-call', 'Llamada con cliente', '17:30', '18:30'), weeklidEvent('e-lunch', 'Almuerzo', '12:30', '13:00')],
  calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
}
const commuteAnswered = answer('b-commute-am', 'c-move', '08:30', '09:00')
const PLAN = { ...BASE, actuals: [commuteAnswered] }

type Plan = Omit<typeof PLAN, 'tasks'> & { tasks: Record<string, unknown>[] }
type Options = { plan?: Plan; at?: string; theme?: (typeof THEMES)[number]; size?: { width: number; height: number }; language?: 'es' | 'en'; readOnly?: boolean; reducedMotion?: boolean }

async function start(page: Page, { plan = PLAN, at = '19:19', theme = 'light', size = SIZES[0], language = 'es', readOnly = false, reducedMotion = false }: Options = {}): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.emulateMedia({ colorScheme: theme, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  await page.clock.install({ time: new Date(iso(at)) })
  await page.addInitScript((code) => window.localStorage.setItem('next168-language', code), language)
  if (readOnly) await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }))
  await seedKey(page, V2_KEY, JSON.stringify({ ...plan, settings: { ...plan.settings, locale: language } }))
  await page.goto('./#/today')
  await expect(page.getByRole('heading', { level: 1, name: language === 'es' ? 'Hoy' : 'Today' })).toBeVisible()
  await settled(page)
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

// Moves the fake clock to a time of day and lets the 30-second refresh pick it up (the refresh lands 30 s later).
async function goTo(page: Page, time: string): Promise<void> {
  await page.clock.setSystemTime(new Date(iso(time)))
  await page.clock.runFor(30_000)
  await settled(page)
}

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
const card = (page: Page) => page.getByTestId('now-card')
const title = (page: Page) => page.getByTestId('now-title')
const doSlot = (page: Page) => page.getByTestId('now-do')
const earlier = (page: Page) => page.getByTestId('timeline-earlier')
const rows = (page: Page) => page.getByTestId('timeline-item')
const rowTitled = (page: Page, text: string) => rows(page).filter({ has: page.locator('.row-title-text', { hasText: text }) })
const box = async (locator: Locator) => (await locator.boundingBox())!

async function expectNoSmallTargets(page: Page): Promise<void> {
  const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), [role="button"], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0 && !element.closest('.visually-hidden') && getComputedStyle(element).visibility === 'visible')
    .map((element) => ({ name: element.getAttribute('aria-label') ?? element.getAttribute('data-testid') ?? element.textContent?.trim().slice(0, 24) ?? element.tagName, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
    .map(({ name, rect }) => `${name}: ${Math.round(rect.width)}x${Math.round(rect.height)}`))
  expect(small).toEqual([])
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name}, ${theme}`, () => {
      test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test; one project is enough')
      })

      test('19:19: date only, Now first, minutes and until, progress text, Next with free time (checks 1-5)', async ({ page }) => {
        await start(page, { size, theme })
        // 1. After the h1 the first element is the subtitle, and it is the date alone.
        await expect(page.getByTestId('today-subtitle')).toHaveText('viernes, 6 de noviembre')
        await expect(page.locator('#main')).not.toContainText('libres')
        await expect(page.locator('.today-view > :first-child')).toHaveAttribute('data-testid', 'today-subtitle')
        expect(await page.evaluate(() => document.querySelector('h1')!.compareDocumentPosition(document.querySelector('[data-testid="today-subtitle"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
        // 2. The Now card is the next region.
        const regions = await page.locator('#main section, #main [role="region"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? node.getAttribute('aria-label')))
        expect(regions[0]).toBe('now-card')
        // 3. "Quedan 41 min", "hasta las 8:00 p. m." and the progress bar says the same, now and a minute later.
        await expect(card(page).getByTestId('now-left')).toHaveText('Quedan 41 min')
        await expect(card(page).getByTestId('now-until')).toHaveText(/^hasta las 8:00\sp\.\sm\.$/)
        const bar = card(page).getByRole('progressbar')
        await expect(bar).toHaveAttribute('aria-valuetext', 'Quedan 41 min')
        await page.clock.runFor(60_000)
        await expect(card(page).getByTestId('now-left')).toHaveText('Quedan 40 min')
        await expect(bar).toHaveAttribute('aria-valuetext', 'Quedan 40 min')
        await goTo(page, '20:30')
        await expect(card(page).getByRole('progressbar')).toHaveCount(0)
        await goTo(page, '19:19')
        // 4. Next names the free time that follows.
        await expect(card(page).getByTestId('now-next')).toHaveText(/^Después\s·\s8:00\sp\.\sm\.\s·\sLibre hasta las 11:00\sp\.\sm\.$/)
        // 5. Nothing to do yet: the Do slot is empty.
        await expect(doSlot(page)).toHaveCount(0)
        await expect(card(page).getByRole('button')).toHaveCount(0)
      })

      test('19:19: "Antes", the now-line, the current row and the free-time row (checks 6-8)', async ({ page }) => {
        await start(page, { size, theme })
        // 6. Folded: one first row with the count of everything past, and how many still wait for an answer.
        const row = earlier(page)
        await expect(row).toHaveText(/Antes\s·\s8\s*3 sin marcar/)
        await expect(row).toHaveAttribute('aria-expanded', 'false')
        expect(await row.getAttribute('aria-controls')).toBeNull()
        expect(await rows(page).count()).toBe(2)
        for (const item of await rows(page).all()) {
          expect(await item.evaluate((element) => element.classList.contains('is-past'))).toBe(false)
        }
        // 7. The now-line follows the folded row, the current row follows it, and 3 h of free time sit before sleep.
        const order = await page.locator('.timeline > li').evaluateAll((nodes) => nodes.map((node) => {
          if (node.querySelector('[data-testid="timeline-earlier"]')) return 'earlier'
          if (node.querySelector('[data-testid="timeline-now"]')) return `now:${node.textContent}`
          if (node.querySelector('[data-testid="timeline-gap"]')) return `gap:${node.textContent}`
          return `item:${node.querySelector('.row-title-text')?.textContent?.trim()}`
        }))
        expect(order.map((entry) => norm(entry))).toEqual(['earlier', 'now:Ahora 7:19 p. m.', 'item:Proyecto personal', 'gap:Libre · 3 h', 'item:Sueño'])
        // Opening: the eight past rows appear in time order and focus lands on the first unanswered ring (Work's).
        await row.click()
        await expect(row).toHaveAttribute('aria-expanded', 'true')
        await expect(rows(page)).toHaveCount(10)
        const starts = await rows(page).evaluateAll((nodes) => nodes.map((node) => node.querySelector('[data-testid="timeline-start"]')?.textContent ?? 'carry'))
        expect(starts.slice(0, 8).map((text) => norm(text))).toEqual(['carry', '8:30 a. m.', '9:00 a. m.', '10:00 a. m.', '12:30 p. m.', '5:00 p. m.', '5:30 p. m.', '6:00 p. m.'])
        const focusedRow = await page.evaluate(() => document.activeElement?.closest('[data-testid="timeline-item"]')?.querySelector('.row-title-text')?.textContent?.trim())
        expect(focusedRow).toBe('Trabajo')
        expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('status-control')
        // 8. Every unanswered ring is drawn in --label-2, whatever the category.
        const label2 = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--label-2)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color })
        const unanswered = page.locator('[data-unanswered="true"] .status-ring')
        await expect(unanswered).toHaveCount(3)
        for (const ring of await unanswered.all()) expect(await ring.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(label2)
        // Folding again takes the rows away and returns focus to the row.
        await row.click()
        await expect(rows(page)).toHaveCount(2)
        await expect(row).toBeFocused()
        // After the 30-minute window the ended side project counts too.
        await goTo(page, '21:00')
        await expect(row).toHaveText(/Antes\s·\s9\s*4 sin marcar/)
      })

      test('18:10: the event is Now, the routine is the context, and calendar rows are not interactive (checks 9-10)', async ({ page }) => {
        await start(page, { size, theme, at: '18:10' })
        await expect(title(page)).toHaveText('Llamada con cliente')
        await expect(title(page).locator('svg')).toHaveCount(1)
        await expect(card(page).getByTestId('now-until')).toHaveText(/^hasta las 6:30\sp\.\sm\.$/)
        await expect(card(page).getByTestId('now-context')).toHaveText(/^Tu rutina: Ejercicio\s·\shasta las 7:00\sp\.\sm\.$/)
        await expect(doSlot(page)).toHaveCount(0)
        // The routine carries the overlap notice once; the event does not repeat it.
        await expect(page.getByTestId('timeline-overlap')).toHaveCount(1)
        await expect(rowTitled(page, 'Ejercicio').getByTestId('timeline-overlap')).toHaveText('Se cruza con Llamada con cliente')
        await expect(rowTitled(page, 'Llamada con cliente').getByTestId('timeline-overlap')).toHaveCount(0)
        // 10. The event row: a glyph, the source in words, no control, nothing that reacts.
        const eventRow = rowTitled(page, 'Llamada con cliente')
        await expect(eventRow.locator('svg')).toHaveCount(1)
        await expect(eventRow.locator('.visually-hidden')).toHaveText('Calendario de Weeklid: ')
        await expect(eventRow.getByTestId('status-control')).toHaveCount(0)
        await expect(eventRow.locator('[tabindex], [href], button, [role="button"]')).toHaveCount(0)
        const url = page.url()
        await eventRow.click({ position: { x: 10, y: 10 } })
        expect(page.url()).toBe(url)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        // The press focuses nothing inside the row: it has nothing to focus.
        expect(await eventRow.evaluate((row) => row.contains(document.activeElement))).toBe(false)
        // After the event the routine is Now, and the notice is gone.
        await goTo(page, '18:31')
        await expect(title(page)).toHaveText('Ejercicio')
        await expect(page.getByTestId('timeline-overlap')).toHaveCount(0)
        await goTo(page, '19:19')
        await expect(page.getByTestId('timeline-overlap')).toHaveCount(0)
      })

      test('a late task shows "Atrasada" and the word "Tarde" never appears (check 11)', async ({ page }) => {
        const late = { ...PLAN, tasks: [...PLAN.tasks, { id: 't-late', title: 'Pagar la factura', durationMin: 30, dueDate: '2026-11-05', priority: 1, createdAt: '2026-11-01T08:00:00.000Z' }] }
        await start(page, { size, theme, plan: late, at: '20:10' })
        await expect(page.locator('.badge.is-late')).toHaveText('Atrasada')
        await expect(page.locator('#main')).not.toContainText('Tarde')
      })

      test('the evening link, the morning gap and the task underway (checks 12, 13, 17)', async ({ page }) => {
        await start(page, { size, theme, at: '23:30' })
        const link = doSlot(page).getByRole('link', { name: 'Cierre del día' })
        await expect(link).toHaveAttribute('href', '#/checkin')
        await expect(page.getByTestId('checkin-card')).toHaveCount(0)
        // 13. The morning gap says its end once or twice in the card, never as the old sentence.
        await goTo(page, '07:40')
        await expect(title(page)).toHaveText('Libre')
        await expect(card(page).getByTestId('now-until')).toHaveText(/^hasta las 8:30\sa\.\sm\.$/)
        await expect(card(page).getByTestId('now-next')).toHaveText(/^Después\s·\s8:30\sa\.\sm\.\s·\sTraslado$/)
        expect(norm(await card(page).textContent()).match(/8:30/g)?.length).toBeLessThanOrEqual(2)
        await expect(card(page)).not.toContainText('Tiempo libre hasta')
        // 17. A task underway is Now; its routine is the context; marking it done falls back to the routine.
        await goTo(page, '10:10')
        await expect(title(page)).toHaveText('Informe')
        await expect(card(page).getByTestId('now-left')).toHaveText('Quedan 35 min')
        await expect(card(page).getByTestId('now-context')).toHaveText(/^En Trabajo\s·\shasta las 5:00\sp\.\sm\.$/)
        await expect(doSlot(page).getByRole('button')).toHaveCount(1)
        await doSlot(page).getByRole('button', { name: 'Marcar como hecha' }).click()
        await expect(page.getByRole('status').filter({ hasText: 'Tarea hecha: Informe' })).toBeVisible()
        await expect(title(page)).toHaveText('Trabajo')
        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(title(page)).toHaveText('Informe')
      })

      test('Next counts events, gaps count every kind, and the article agrees with the hour (checks 18, 19, 23)', async ({ page }) => {
        await start(page, { size, theme, at: '12:10' })
        await expect(card(page).getByTestId('now-next')).toContainText('Almuerzo')
        await goTo(page, '17:35')
        await expect(title(page)).not.toHaveText('Libre')
        // No free-time row sits under the now-line while the event is under way.
        expect(await page.locator('.timeline > li').evaluateAll((nodes) => {
          const at = nodes.findIndex((node) => node.querySelector('[data-testid="timeline-now"]'))
          return nodes[at + 1]?.querySelector('[data-testid="timeline-gap"]') !== null
        })).toBe(false)
        await goTo(page, '20:30')
        await expect(title(page)).toHaveText('Libre')
        // 23. The lunch event ends at 1:00 p. m.: "hasta la", singular; its routine ends at 5:00: "hasta las".
        await goTo(page, '12:40')
        await expect(title(page)).toHaveText('Almuerzo')
        await expect(card(page).getByTestId('now-until')).toHaveText(/^hasta la 1:00\sp\.\sm\.$/)
        await expect(card(page).getByTestId('now-context')).toHaveText(/^Tu rutina: Trabajo\s·\shasta las 5:00\sp\.\sm\.$/)
        expect(norm(await page.locator('#main').textContent())).not.toMatch(/las 1:00/)
      })

      test('the answer buttons: 19:53 and 20:15 ask, 20:31 does not; Hecho records and offers Undo (checks 5, 20)', async ({ page }) => {
        await start(page, { size, theme, at: '19:53' })
        await expect(card(page).getByTestId('now-ask')).toHaveText('¿Cómo fue?')
        await expect(doSlot(page).getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
        for (const button of await doSlot(page).getByRole('button').all()) {
          const rect = await box(button)
          expect(rect.height).toBeGreaterThanOrEqual(44)
        }
        // Eight pixels apart at least (--control-gap), side by side while they fit.
        const [first, second] = [await box(doSlot(page).getByRole('button', { name: 'Hecho' })), await box(doSlot(page).getByRole('button', { name: 'A medias' }))]
        if (size.width > 700 || Math.abs(first.y - second.y) < 4) expect(second.x - (first.x + first.width)).toBeGreaterThanOrEqual(8 - 0.5)
        await goTo(page, '20:15')
        await expect(doSlot(page).getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
        await expect(doSlot(page).getByTestId('now-ask')).toHaveText('¿Cómo fue Proyecto personal?')
        await goTo(page, '20:29')
        await expect(doSlot(page).getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
        await goTo(page, '20:31')
        await expect(doSlot(page)).toHaveCount(0)
        await expect(earlier(page)).toContainText('sin marcar')
        // Tapping Hecho records the 19:00 occurrence and shows the undo toast.
        await goTo(page, '19:53')
        await doSlot(page).getByRole('button', { name: 'Hecho', exact: true }).click()
        await expect(page.getByRole('status').filter({ hasText: 'Proyecto personal: Hecho' })).toBeVisible()
        await expect.poll(async () => (await storedPlanner(page)).actuals).toMatchObject([{ blockId: 'b-commute-am' }, { blockId: 'b-side', status: 'done' }])
        await expect(doSlot(page).getByRole('button', { name: /Hecho · Cambiar/ })).toBeVisible()
        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(doSlot(page).getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
      })

      test('a long event is context, the one-hour event wins while it lasts (check 25)', async ({ page }) => {
        const trip = { ...PLAN, events: [...PLAN.events, weeklidEvent('e-trip', 'Viaje', '06:00', '21:00')] }
        await start(page, { size, theme, plan: trip, at: '11:00' })
        await expect(title(page)).toHaveText('Trabajo')
        await expect(card(page).getByTestId('now-context')).toHaveText(/^También ahora: Viaje\s·\shasta las 9:00\sp\.\sm\.$/)
        await goTo(page, '17:40')
        await expect(title(page)).toHaveText('Llamada con cliente')
        await expect(card(page).getByTestId('now-context')).toContainText('También ahora: Viaje')
        await goTo(page, '20:30')
        await expect(title(page)).toHaveText('Viaje')
      })

      test('a half-hour event beside the one-hour event wins, and every target is 44 px (checks 26, 14)', async ({ page }) => {
        const tie = { ...PLAN, events: [...PLAN.events, weeklidEvent('e-short', 'Sincronización', '17:30', '18:00')] }
        await start(page, { size, theme, plan: tie, at: '17:40' })
        await expect(title(page)).toHaveText('Sincronización')
        await expect(card(page).getByTestId('now-context')).toHaveText(/^También ahora: Llamada con cliente\s·\shasta las 6:30\sp\.\sm\.$/)
        await expectNoSmallTargets(page)
      })
    })
  }
}

test.describe('English copy', () => {
  test.use({ locale: 'en-US' })
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one project is enough')
  })

  test('the Now card, the context lines and the task underway read in English (checks 3, 9, 17, 25)', async ({ page }) => {
    await start(page, { language: 'en', at: '19:19' })
    await expect(card(page).getByTestId('now-left')).toHaveText('41 min left')
    await expect(card(page).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '41 min left')
    await expect(card(page).getByTestId('now-until')).toHaveText(/^until 8:00\sPM$/)
    await expect(card(page).getByTestId('now-next')).toHaveText(/^Next\s·\s8:00\sPM\s·\sFree until 11:00\sPM$/)
    await goTo(page, '18:10')
    await expect(card(page).getByTestId('now-until')).toHaveText(/^until 6:30\sPM$/)
    await expect(card(page).getByTestId('now-context')).toHaveText(/^Your routine: Ejercicio\s·\suntil 7:00\sPM$/)
    await expect(page.getByTestId('timeline-overlap')).toHaveText('Overlaps with Llamada con cliente')
    await goTo(page, '10:10')
    await expect(card(page).getByTestId('now-context')).toHaveText(/^In Trabajo\s·\suntil 5:00\sPM$/)
    await expect(doSlot(page).getByRole('button', { name: 'Mark as done' })).toBeVisible()
    await goTo(page, '11:00')
    await expect(title(page)).toHaveText('Trabajo')
  })

  test('a late task chunk shows "Overdue" in English (check 11)', async ({ page }) => {
    const late = { ...PLAN, tasks: [...PLAN.tasks, { id: 't-late', title: 'Pay the bill', durationMin: 30, dueDate: '2026-11-05', priority: 1, createdAt: '2026-11-01T08:00:00.000Z' }] }
    await start(page, { language: 'en', plan: late, at: '20:10' })
    await expect(page.locator('.badge.is-late')).toHaveText('Overdue')
  })

  test('a long event is context and a tie goes to the shorter one in English (checks 25, 26)', async ({ page }) => {
    const trip = { ...PLAN, events: [...PLAN.events, weeklidEvent('e-trip', 'Viaje', '06:00', '21:00')] }
    await start(page, { language: 'en', plan: trip, at: '11:00' })
    await expect(card(page).getByTestId('now-context')).toHaveText(/^Also now: Viaje\s·\suntil 9:00\sPM$/)
  })
})

test.describe('announcements and accessibility', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one project is enough')
  })

  // Records every distinct text the polite live region takes, without polling.
  async function recordLiveRegion(page: Page): Promise<void> {
    await page.evaluate(() => {
      const region = document.querySelector('[data-testid="live-announcer"]')!
      const seen: string[] = []
      ;(window as unknown as { __spoken: string[] }).__spoken = seen
      new MutationObserver(() => { if (region.textContent) seen.push(region.textContent) }).observe(region, { childList: true, characterData: true, subtree: true })
    })
  }
  const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)

  test('the page title is all that is read on load, and the minutes ticking down say nothing (checks 21, 22)', async ({ page }) => {
    await start(page)
    await page.clock.runFor(2000)
    // Loading Today says nothing of its own: the shell reads a title only after a navigation, which is Today's to leave alone.
    await expect(page.getByTestId('live-announcer')).toHaveText('')
    await page.evaluate(() => { location.hash = '#/week' })
    await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
    await page.evaluate(() => { location.hash = '#/today' })
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await page.clock.runFor(2000)
    await expect(page.getByTestId('live-announcer')).toHaveText('Hoy')
    await recordLiveRegion(page)
    for (let step = 0; step < 6; step += 1) await page.clock.runFor(5 * 60_000)
    expect(await spoken(page)).toEqual([])
    await expect(page.getByTestId('live-announcer')).toHaveText('Hoy')
  })

  test('crossing 20:00 announces the new Now exactly once; the 19:50 question is announced once (checks 21, 27)', async ({ page }) => {
    await start(page, { at: '19:49' })
    await page.clock.runFor(20_000)
    await recordLiveRegion(page)
    await page.clock.runFor(60_000)
    expect(await spoken(page)).toEqual(['Puedes marcar cómo fue Proyecto personal'])
    await page.clock.setSystemTime(new Date(iso('19:59:50')))
    await page.clock.runFor(30_000)
    for (let step = 0; step < 10; step += 1) await page.clock.runFor(10_000)
    const messages = (await spoken(page)).map(norm)
    expect(messages.filter((text) => text === 'Ahora: Libre, hasta las 11:00 p. m.')).toHaveLength(1)
    expect(messages.filter((text) => text.startsWith('Puedes marcar'))).toHaveLength(1)
  })

  test('nothing is announced across a boundary while the page is hidden, nor on return (check 21)', async ({ page }) => {
    await start(page, { at: '19:55' })
    await recordLiveRegion(page)
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }))
    await page.clock.setSystemTime(new Date(iso('19:59:50')))
    await page.clock.runFor(60_000)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.runFor(60_000)
    expect(await spoken(page)).toEqual([])
  })

  test('read-only: "Antes" opens and focus stays on its button (check 28)', async ({ page }) => {
    await start(page, { readOnly: true })
    await earlier(page).click()
    await expect(earlier(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(earlier(page)).toBeFocused()
    await expect(earlier(page)).toContainText('3 sin marcar')
  })

  test('expanding "Antes" with reduced motion records no transform animation (check 15)', async ({ page }) => {
    await start(page, { reducedMotion: true })
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as unknown as { __animated: string[] }).__animated = seen
      const sample = () => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect as KeyframeEffect | null
          const properties = new Set(effect?.getKeyframes().flatMap((frame) => Object.keys(frame)))
          const named = (animation as CSSTransition).transitionProperty
          if (properties.has('transform') || named === 'transform' || properties.has('rotate') || named === 'rotate') seen.push(named ?? 'keyframes')
        }
        requestAnimationFrame(sample)
      }
      sample()
    })
    await earlier(page).click()
    await expect(rows(page)).toHaveCount(10)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as unknown as { __animated: string[] }).__animated)).toEqual([])
  })

  for (const theme of THEMES) {
    test(`geometry and axe are clean in the states of the day, ${theme} (check 14)`, async ({ page }) => {
      await start(page, { theme, size: SIZES[0] })
      for (const time of ['19:19', '19:53', '18:10', '10:10', '07:40', '23:30']) {
        await goTo(page, time)
        if (time === '19:19') {
          await earlier(page).click()
          // The rows grow in over 0.35 s; the audit measures them at rest.
          await expect(rows(page)).toHaveCount(10)
          await settled(page)
        }
        expect(await visualIntegrityViolations(page), `visual integrity at ${time}`).toEqual([])
        const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
        expect(results.violations.map((violation) => `${time}: ${violation.id}`), `axe at ${time}`).toEqual([])
        await expectNoSmallTargets(page)
      }
    })
  }

  test('at 200 % text on a phone nothing is cut and the answer buttons stack, one per line (check 16)', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = 'html { font-size: 200% !important; }'
        document.head.append(style)
      })
    })
    await start(page, { at: '19:53' })
    const buttons = doSlot(page).getByRole('button')
    await expect(buttons).toHaveCount(3)
    const tops = await Promise.all((await buttons.all()).map(async (button) => (await box(button)).y))
    expect(new Set(tops.map(Math.round)).size).toBe(3)
    for (const button of await buttons.all()) {
      const rect = await box(button)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(375)
    }
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner)
    expect(await visualIntegrityViolations(page)).toEqual([])
  })

  test('the Google notice sits under "Tu día", after the Now card, also when Google cannot load (check 2)', async ({ page, context }) => {
    await fakeGoogle(context)
    await page.clock.install({ time: new Date(iso('19:19')) })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
    await seedKey(page, V2_KEY, JSON.stringify(PLAN))
    await page.goto('./?labs=google-calendar#/today')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    const notice = page.getByTestId('google-notice')
    await expect(notice).toBeVisible()
    const order = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-testid="now-card"], [data-testid="google-notice"], .timeline-section .section-title'))
      return nodes.map((node) => node.getAttribute('data-testid') ?? 'tu-dia-heading')
    })
    expect(order).toEqual(['now-card', 'tu-dia-heading', 'google-notice'])
  })
})

// The Weeklid-server build, where a token request that fails leaves the connection "unavailable" (docs of the Google slice).
test.describe('Google unavailable', () => {
  test.use({ baseURL: `http://127.0.0.1:${previewPorts().server}/` })
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one project is enough')
  })

  test('the notice stays below the Now card and under "Tu día" when Google cannot be reached (check 2)', async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: { brands: [{ brand: 'Google Chrome', version: '130' }, { brand: 'Chromium', version: '130' }], mobile: false, platform: 'macOS' } })
    })
    const google = await fakeGoogle(context, { events: [] })
    const server = await fakeGoogleServer(context, newWorld(), 'device')
    server.connected = true
    server.reply('token', 'abort')
    await page.clock.install({ time: new Date(iso('19:19')) })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
    await seedKey(page, V2_KEY, JSON.stringify(PLAN))
    await page.goto('./?labs=google-calendar#/today')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    const notice = page.getByTestId('google-notice')
    await expect(notice).toHaveAttribute('data-state', 'unavailable')
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="now-card"], [data-testid="google-notice"], .timeline-section .section-title'))
      .map((node) => node.getAttribute('data-testid') ?? 'tu-dia-heading'))
    expect(order).toEqual(['now-card', 'tu-dia-heading', 'google-notice'])
    await expect(card(page).getByTestId('now-left')).toHaveText('Quedan 41 min')
    expectNoStrayGoogleTraffic(google)
  })
})

// One scenario that also runs on the iPhone project (WebKit), where the answer buttons and the folded row must work.
test('@smoke the Now card, the folded row and the answer buttons work on the device project', async ({ page }) => {
  await start(page, { at: '19:53', size: { width: 375, height: 812 } })
  await expect(title(page)).toHaveText('Proyecto personal')
  await expect(doSlot(page).getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
  await earlier(page).click()
  await expect(earlier(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(rows(page)).toHaveCount(10)
  await earlier(page).click()
  await expect(rows(page)).toHaveCount(2)
})
