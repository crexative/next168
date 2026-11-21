import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { storedPlanner } from './support/indexedDb'

// Slice B: Today and the nightly check-in, in Spanish (es-CO), at a phone and a desktop size, in both themes.
// Wednesday 2026-10-21 10:15 UTC; the browser and the document both use UTC.
test.use({ locale: 'es-CO' })
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test; one project is enough')
})

const SIZES = [
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'desktop 1440x900', width: 1440, height: 900 },
] as const
const THEMES = ['light', 'dark'] as const
const NOW = '2026-10-21T10:15:00.000Z'

const plan = {
  schemaVersion: 2,
  workspaceId: 'workspace-slice-b',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo', colorKey: 'blue', icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-exercise', name: 'Ejercicio', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
  ],
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [1, 2, 3, 4, 5], start: 540, end: 660 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'b-gym', categoryId: 'c-exercise', title: 'Gimnasio', days: [3], start: 1080, end: 1140 },
  ],
  tasks: [{ id: 't-call', title: 'Llamar a la abuela', categoryId: 'c-work', durationMin: 30, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
  // An older check-in shows the plan existed before today, so today's blocks can be asked about.
  checkIns: [{ date: '2026-10-20', bedtime: 1350, wake: 400, exercise: 'yes', stress: 2 }],
  actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}
// The same plan seen for the first time today: nothing predates it.
const freshPlan = { ...plan, tasks: [], checkIns: [] }

async function start(page: Page, size: { width: number; height: number }, theme: (typeof THEMES)[number], doc: unknown = plan, at = NOW): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: new Date(at) })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(doc))
}

async function open(page: Page, view: 'today' | 'checkin', title: string): Promise<void> {
  await page.goto(`./#/${view}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function stored(page: Page) {
  return storedPlanner(page)
}

async function box(locator: Locator) {
  return (await locator.boundingBox())!
}

const circle = (scope: Locator) => scope.getByTestId('status-control')

// Finished items sit in the folded "Antes" row; these tests answer from their own rows.
async function expandEarlier(page: Page): Promise<void> {
  await page.getByTestId('timeline-earlier').click()
  await expect(page.getByTestId('timeline-earlier')).toHaveAttribute('aria-expanded', 'true')
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name}, ${theme}`, () => {
      test('the subtitle says the date alone, with no counter and no card', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:15:30.000Z')
        await open(page, 'today', 'Hoy')
        const subtitle = page.getByTestId('today-subtitle')
        await expect(subtitle).toHaveText('miércoles, 21 de octubre')
        await expect(page.getByTestId('free-hours')).toHaveCount(0)
        await expect(page.getByTestId('day-progress')).toHaveCount(0)
        await expect(page.getByText('de 168')).toHaveCount(0)
        await expect(page.locator('.today-main').getByText('libres esta semana')).toHaveCount(0)
        const rect = await box(subtitle)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
        // Mid-block the card only tells the time left (the list below says what comes after): no status question yet.
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-title')).toHaveText('Trabajo profundo')
        await expect(card.getByTestId('now-left')).toHaveText('Quedan 45 min')
        await expect(card.getByTestId('now-next')).toHaveCount(0)
        await expect(circle(card)).toHaveCount(0)
        await expect(card.getByRole('group')).toHaveCount(0)
        await expect(card.getByRole('button')).toHaveCount(0)
      })

      test('in the last ten minutes three labelled buttons appear: one tap on Hecho marks it, with a toast to undo it', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:49:30.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-do')).toHaveCount(0)
        await page.clock.runFor(31_000)
        await expect(card.getByTestId('now-ask')).toHaveText('¿Cómo fue?')
        const buttons = card.getByTestId('now-do').getByRole('button')
        await expect(buttons).toHaveText(['Hecho', 'A medias', 'No'])
        for (const button of await buttons.all()) {
          const rect = await box(button)
          expect(rect.height).toBeGreaterThanOrEqual(44)
          expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
        }
        await buttons.first().click()
        await expect(card.getByTestId('now-answered')).toHaveText('Hecho · Cambiar')
        await expect(page.getByRole('status').filter({ hasText: 'Trabajo profundo: Hecho' })).toBeVisible()
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'done' }])

        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(card.getByTestId('now-do').getByRole('button')).toHaveText(['Hecho', 'A medias', 'No'])
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])
      })

      test('A medias asks the minutes and No is one choice; the answer can be changed from its line', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:55:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await card.getByRole('button', { name: 'A medias' }).click()
        const minutes = card.getByLabel('Minutos dedicados (planificados 120)')
        await expect(minutes).toHaveValue('60')
        await minutes.fill('45')
        await card.getByRole('button', { name: 'Guardar' }).click()
        await expect(card.getByTestId('now-answered')).toHaveText('A medias · Cambiar')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'partial', actualMinutes: 45 }])
        await expect(page.getByRole('status').filter({ hasText: 'Trabajo profundo: A medias' })).toBeVisible()

        await card.getByTestId('now-answered').click()
        await card.getByRole('button', { name: 'No', exact: true }).click()
        await expect(card.getByTestId('now-answered')).toHaveText('No · Cambiar')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'skipped' }])
      })

      test('a finished block: right click or a long press on its ring opens the same menu; Escape returns focus; the answer can be removed', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T12:00:00.000Z')
        await open(page, 'today', 'Hoy')
        await expandEarlier(page)
        const row = page.getByTestId('timeline-item').filter({ has: page.locator('.row-title-text', { hasText: 'Trabajo profundo' }) })
        const control = circle(row)
        await control.click({ button: 'right' })
        const menu = page.getByRole('menu', { name: '¿Cómo fue Trabajo profundo?' })
        await expect(menu).toBeVisible()
        await expect(menu.getByRole('menuitem')).toHaveText(['A medias', 'No'])
        // The menu grows in from 96 % over 200 ms, so its rows reach full size a moment after it is visible.
        for (const item of await menu.getByRole('menuitem').all()) await expect.poll(async () => (await box(item)).height).toBeGreaterThanOrEqual(44)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(control).toBeFocused()

        const rect = await box(control)
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
        await page.mouse.down()
        await page.clock.runFor(600)
        await page.mouse.up()
        await expect(page.getByRole('menu')).toBeVisible()
        // The release after a long press is not a tap: nothing was recorded.
        expect((await stored(page)).actuals).toEqual([])
        await page.getByRole('menuitem', { name: 'No', exact: true }).click()
        await expect(control).toHaveAttribute('data-status', 'skipped')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'skipped' }])
        await control.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Quitar respuesta' }).click()
        await expect(control).toHaveAttribute('data-status', 'none')
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])
      })

      test('a finished block is one row with one circle: no buttons, sub-labels or emoji', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T12:00:00.000Z')
        await open(page, 'today', 'Hoy')
        await expandEarlier(page)
        const row = page.getByTestId('timeline-item').filter({ hasText: 'Trabajo profundo' })
        await expect(circle(row)).toHaveCount(1)
        await expect(row.getByRole('button')).toHaveCount(1)
        await expect(row.getByTestId('category-mark')).toHaveCount(0)
        await expect(row.getByTestId('timeline-category')).toHaveCount(0)
        await expect(row).not.toContainText('Hecho')
        await expect(row).not.toContainText('Parcial')
        const rect = await box(circle(row))
        expect(rect.width).toBeGreaterThanOrEqual(44)
        expect(rect.height).toBeGreaterThanOrEqual(44)
        // The circle is the trailing element of the row, inside the list card.
        const rowRect = await box(row)
        expect(rect.x + rect.width).toBeLessThanOrEqual(rowRect.x + rowRect.width)
        expect(rect.x).toBeGreaterThan(rowRect.x + rowRect.width / 2)
        await circle(row).click()
        await expect(circle(row)).toHaveAttribute('data-status', 'done')
        await expect(circle(row)).toHaveAccessibleName('Hecho: Trabajo profundo. Toca para quitar la respuesta')
      })

      test('an appointment on top of a block is a quiet line on the block only, and only while the pair is current or upcoming', async ({ page }) => {
        const withAppointment = { ...plan, events: [{ id: 'e-doctor', title: 'Cita médica', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, attendees: [] }] }
        // Before both start, so both are rows (once under way they are the Ahora hero and its routine).
        await start(page, size, theme, withAppointment, '2026-10-21T08:30:30.000Z')
        await open(page, 'today', 'Hoy')
        // Matched by their own title: the block's note names the event.
        const work = page.getByTestId('timeline-item').filter({ has: page.locator('.row-title-text', { hasText: 'Trabajo profundo' }) })
        const doctor = page.getByTestId('timeline-item').filter({ has: page.locator('.row-title-text', { hasText: 'Cita médica' }) })
        await expect(work.getByTestId('timeline-overlap')).toHaveText('Se cruza con Cita médica')
        await expect(doctor.getByTestId('timeline-overlap')).toHaveCount(0)
        await expect(page.getByTestId('conflict-mark')).toHaveCount(0)
        await expect(page.getByText('Conflicto')).toHaveCount(0)
        const [note, danger] = await Promise.all([
          work.getByTestId('timeline-overlap').evaluate((element) => getComputedStyle(element).color),
          page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--danger-label)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color }),
        ])
        expect(note).not.toBe(danger)
        // Once the shared hour is over the notice goes.
        await page.clock.setSystemTime(new Date('2026-10-21T10:00:30.000Z'))
        await page.clock.runFor(30_000)
        await expect(page.getByTestId('timeline-overlap')).toHaveCount(0)
      })

      test('tonight’s sleep reads from its start to its end, and a re-fitted task starts on a five-minute step', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:31:30.000Z')
        await open(page, 'today', 'Hoy')
        const sleep = page.getByTestId('timeline-item').filter({ hasText: 'Dormir' }).last()
        await expect(sleep.getByTestId('timeline-start')).toHaveText('10:00 p. m.')
        // It ends tomorrow: the real end sits in the time column, with no second "Hasta las" line (REVIEW B1).
        await expect(sleep.getByTestId('timeline-end')).toHaveText('6:00 a. m.')
        await expect(sleep.getByTestId('timeline-span-hint')).toHaveCount(0)
        await expect(page.getByText('12:00 a. m.')).toHaveCount(0)
        const task = page.locator('[data-kind="task"]').first()
        await expect(task.getByTestId('timeline-start')).toHaveText('10:35 a. m.')
      })

      test('a task that starts before the next block is the next row of the list and done in one tap, with undo', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:15:30.000Z')
        await open(page, 'today', 'Hoy')
        await expect(page.locator('.timeline .is-next .row-title-text')).toContainText('Llamar a la abuela')
        const check = page.locator('[data-kind="task"]').first().getByTestId('status-control')
        await expect(check).toHaveAccessibleName('Marcar como hecho: Llamar a la abuela')
        const rect = await box(check)
        expect(rect.width).toBeGreaterThanOrEqual(44)
        expect(rect.height).toBeGreaterThanOrEqual(44)
        await check.click()
        await expect(page.getByRole('status').filter({ hasText: 'Tarea hecha: Llamar a la abuela' })).toBeVisible()
        await expect(page.locator('[data-kind="task"]')).toHaveCount(0)
        await expect.poll(async () => (await stored(page)).tasks[0].doneAt).toBeTruthy()

        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(page.locator('[data-kind="task"]')).toHaveCount(1)
        await expect.poll(async () => (await stored(page)).tasks[0].doneAt).toBeUndefined()
      })

      test('nothing is asked about blocks that started before the plan existed, and last night’s sleep is one line', async ({ page }) => {
        await start(page, size, theme, freshPlan, '2026-10-21T11:00:00.000Z')
        await open(page, 'today', 'Hoy')
        await expect(circle(page.getByTestId('now-card'))).toHaveCount(0)
        await expect(page.getByTestId('now-do')).toHaveCount(0)
        await expandEarlier(page)
        await expect(page.getByTestId('timeline-item').filter({ hasText: 'Trabajo profundo' }).getByTestId('status-control')).toHaveCount(0)
        const carry = page.getByTestId('timeline-carry')
        await expect(carry).toContainText('Dormir')
        await expect(carry).toContainText('Desde ayer · hasta')
        // A single line: the row is the minimum row height, never two text lines plus its padding.
        const row = page.locator('li.is-carry')
        expect((await box(row)).height).toBeLessThanOrEqual(52)
        await expect(row.getByTestId('timeline-start')).toHaveCount(0)
        const lines = await carry.evaluate((element) => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)))
        expect(lines).toBe(1)
      })

      test('free time says Libre, how long it lasts and until when, under "Ahora" in sentence case', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T16:30:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-eyebrow')).toHaveText('Ahora')
        await expect(card.getByTestId('now-eyebrow')).toHaveCSS('text-transform', 'none')
        await expect(card.getByTestId('now-title')).toHaveText('Libre')
        await expect(card.getByTestId('now-left')).toHaveText('Quedan 1 h 30 min')
        await expect(card.getByTestId('now-until')).toHaveText(/^hasta las 6:00\sp\.\sm\.$/)
        await expect(card).not.toContainText('Sin planificar')
        await expect(card.getByTestId('now-next')).toContainText('Gimnasio')
        await expect(circle(card)).toHaveCount(0)
        const title = await box(card.getByTestId('now-title'))
        const cardRect = await box(card)
        expect(title.x + title.width).toBeLessThanOrEqual(cardRect.x + cardRect.width)
      })
    })
  }
}

// The check-in is a conversation (R_Cierre): told facts are your answers, open questions come one at a time.
const checkin = (page: Page) => page.getByTestId('checkin')
const answerOf = (page: Page, step: string) => page.getByTestId(`answer-${step}`)
async function toFinal(page: Page): Promise<void> {
  while (await checkin(page).getAttribute('data-step') !== 'final') await page.getByTestId('checkin-skip').click()
}

for (const theme of THEMES) {
  test.describe(`check-in, ${theme}`, () => {
    for (const size of SIZES) {
      test(`${size.name}: the row moves up at 20:00, told facts, the day's routines, saved and back on Today`, async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T19:59:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('checkin-card')
        // All day the row closes the list (on a desktop it is in the aside); from 20:00 it comes first on a phone.
        await expect(card).toBeVisible()
        await page.clock.fastForward(61_000)
        await expect(card).toContainText('Cierre del día')
        if (size.width < 1024) expect(await card.evaluate((element) => !!(element.compareDocumentPosition(document.querySelector('.timeline-section')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)

        // Tap 1: open the conversation. The day is a line, not a field; the times from the plan are told as answers.
        await card.click()
        await expect(checkin(page)).toBeVisible()
        await expect(page.getByTestId('checkin-date')).toHaveText('Cierre del día · miércoles, 21 de octubre')
        await expect(page.locator('input[type="date"]')).toHaveCount(0)
        await expect(answerOf(page, 'bedtime')).toHaveText('Anoche te acostaste a las 10:00 p. m.')
        await expect(answerOf(page, 'wake')).toHaveText('Hoy te levantaste a las 6:00 a. m.')
        await expect(answerOf(page, 'workEnd')).toHaveText('Hoy terminaste de trabajar a las 11:00 a. m.')
        for (const step of ['bedtime', 'wake', 'workEnd']) expect((await box(answerOf(page, step))).height).toBeGreaterThanOrEqual(44)

        // A told time is asked again when tapped, prefilled, and told again once it is set.
        await answerOf(page, 'wake').click()
        await expect(page.getByTestId('checkin-question')).toHaveText('¿A qué hora te levantaste hoy?')
        const wake = page.getByTestId('fact-input')
        await expect(wake).toHaveValue('06:00')
        await wake.fill('07:00')
        await page.getByRole('button', { name: 'Siguiente' }).click()
        await expect(answerOf(page, 'wake')).toHaveText('Hoy te levantaste a las 7:00 a. m.')
        await answerOf(page, 'wake').click()
        await page.getByTestId('fact-input').fill('06:00')
        await page.getByRole('button', { name: 'Siguiente' }).click()

        // No exercise question: the routines that are over and unmarked are asked one by one, with visible replies.
        await expect(checkin(page)).not.toContainText('¿Hiciste ejercicio?')
        await expect(page.getByTestId('checkin-question')).toHaveText('¿Cómo fue Trabajo profundo?')
        await page.getByTestId('checkin-skip').click()
        await expect(page.getByTestId('checkin-question')).toHaveText('¿Cómo fue Gimnasio?')
        const replies = checkin(page).locator('.quick-reply')
        await expect(replies).toHaveText(['Hecho', 'A medias', 'No'])
        for (const reply of await replies.all()) expect((await box(reply)).height).toBeGreaterThanOrEqual(44)

        // Taps 2–4: the gym, stress, save. Exercise is read from the routine, so the timeline agrees with the check-in.
        await replies.first().click()
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-gym', status: 'done' }])
        await expect(page.getByTestId('checkin-question')).toHaveText('¿Cómo de estresado estuviste hoy?')
        await expect(checkin(page).locator('.ends')).toContainText('calma')
        await expect(checkin(page).locator('.ends')).toContainText('alto')
        await page.getByTestId('stress-2').click()
        await expect(page.getByTestId('checkin-question')).toHaveText('Este es tu cierre de hoy.')
        await page.getByRole('button', { name: 'Guardar cierre' }).click()

        await expect(page).toHaveURL(/#\/today$/)
        await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
        const done = page.getByTestId('checkin-done')
        await expect(done).toHaveText('Guardado ✓ · racha 2')
        await expect(page.getByTestId('checkin-card')).toBeFocused()
        await expect.poll(async () => (await stored(page)).checkIns.at(-1)).toEqual({ date: '2026-10-21', bedtime: 1320, wake: 360, workEnd: 660, exercise: 'yes', stress: 2 })
        await page.clock.runFor(5000)
        await expect(done).toHaveText('Hecho ✓ · racha 2')
        // Hoy shows the same answer on the same routine: one fact, one place.
        await expandEarlier(page)
        await expect(page.getByTestId('timeline-item').filter({ hasText: 'Gimnasio' }).getByTestId('status-control')).toHaveAttribute('data-status', 'done')
      })
    }

    test('× is top-leading in the conversation and leads back to Hoy', async ({ page }) => {
      await start(page, SIZES[0], theme, plan, '2026-10-21T20:30:00.000Z')
      await open(page, 'checkin', 'Cierre del día')
      const back = page.getByRole('button', { name: 'Volver a Hoy' })
      await expect(back).toBeVisible()
      const rect = await box(back)
      expect(rect.x).toBeLessThan(SIZES[0].width / 2)
      expect(rect.y).toBeLessThan(80)
      expect(rect.height).toBeGreaterThanOrEqual(44)
      await back.click()
      await expect(page).toHaveURL(/#\/today$/)
    })

    test('Fin del trabajo is not said on a day without work (Saturday)', async ({ page }) => {
      await start(page, SIZES[0], theme, plan, '2026-10-24T20:30:00.000Z')
      await open(page, 'checkin', 'Cierre del día')
      await expect(page.getByTestId('checkin-date')).toHaveText('Cierre del día · sábado, 24 de octubre')
      await expect(answerOf(page, 'bedtime')).toBeVisible()
      await expect(answerOf(page, 'workEnd')).toHaveCount(0)
    })
  })
}

test.describe('check-in answers can be withdrawn', () => {
  test('changing stress and leaving it for later withdraws it; the saved entry keeps what was derived', async ({ page }) => {
    // Tonight's gym was marked done on Hoy, so the check-in derives "exercise: yes" from the timeline (an unmarked
    // block would leave it unknown, and the saved answer would be dropped).
    const gymDone = {
      date: '2026-10-21', blockId: 'b-gym', categoryId: 'c-exercise', plannedStartAt: '2026-10-21T18:00:00.000Z',
      plannedEndAt: '2026-10-21T19:00:00.000Z', plannedMinutes: 60, status: 'done',
    }
    const saved = { ...plan, actuals: [gymDone], checkIns: [...plan.checkIns, { date: '2026-10-21', bedtime: 1320, wake: 360, exercise: 'yes', stress: 3 }] }
    await start(page, SIZES[0], 'light', saved, '2026-10-21T20:30:00.000Z')
    await open(page, 'checkin', 'Cierre del día')
    // The end of work and this morning's work are still open: they are asked first, and left for later.
    await toFinal(page)
    await answerOf(page, 'stress').click()
    await expect(page.getByTestId('stress-3')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('checkin-skip').click()
    await expect(answerOf(page, 'stress')).toHaveCount(0)
    await toFinal(page)
    await page.getByRole('button', { name: 'Guardar cierre' }).click()
    await expect(page).toHaveURL(/#\/today$/)
    await expect.poll(async () => (await stored(page)).checkIns.at(-1)).toEqual({ date: '2026-10-21', bedtime: 1320, wake: 360, exercise: 'yes' })
  })
})

test.describe('nightly reminder', () => {
  // `armed` preloads the opt-in the way a returning user has it: permission already granted and the preference stored
  // before the app starts, so the ticker is running from the first frame and nothing depends on a tap.
  async function stubNotifications(page: Page, permission: NotificationPermission | 'absent', armed = false, answer: NotificationPermission = 'granted'): Promise<void> {
    if (armed) await page.addInitScript(() => window.localStorage.setItem('next168-checkin-reminder', '1'))
    await page.addInitScript(([initial, answered]) => {
      const log = { asked: 0, shown: [] as { title: string; body?: string }[] }
      const instances: { onclick?: () => void }[] = []
      ;(window as unknown as { __notificationInstances: typeof instances }).__notificationInstances = instances
      ;(window as unknown as { __notifications: typeof log }).__notifications = log
      if (initial === 'absent') {
        delete (window as unknown as { Notification?: unknown }).Notification
        return
      }
      class FakeNotification {
        static permission = initial as NotificationPermission
        static async requestPermission(): Promise<NotificationPermission> {
          log.asked += 1
          FakeNotification.permission = answered as NotificationPermission
          return answered as NotificationPermission
        }
        onclick?: () => void
        constructor(title: string, options?: NotificationOptions) { log.shown.push({ title, body: options?.body }); instances.push(this) }
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
    }, [permission, answer] as const)
  }
  // The reminder sits on the check-in's last turn (it moved there from Hoy's card).
  async function openLastTurn(page: Page): Promise<void> {
    await open(page, 'checkin', 'Cierre del día')
    await toFinal(page)
  }
  const log = (page: Page) => page.evaluate(() => (window as unknown as { __notifications: { asked: number; shown: { title: string; body?: string }[] } }).__notifications)

  test('is asked for only on tap and notifies once at 22:00', async ({ page }) => {
    await stubNotifications(page, 'default')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await openLastTurn(page)
    // es-CO reads a 12-hour clock: the reminder follows it (verify4 defect 9 wrote "Recordarme a las 22:00").
    const remind = page.getByRole('switch', { name: /^Recordarme a las 10:00\sp\.\s?m\.$/u })
    await expect(remind).not.toBeChecked()
    // The whole row is the switch's label: a 44 px target.
    expect((await box(page.locator('.toggle-row'))).height).toBeGreaterThanOrEqual(44)
    expect((await log(page)).asked).toBe(0)

    await remind.click()
    await expect(remind).toBeChecked()
    expect((await log(page)).asked).toBe(1)
    await page.clock.runFor(60 * 60_000) // 21:30
    expect((await log(page)).shown).toEqual([])
    await page.clock.runFor(60 * 60_000) // 22:30
    await expect.poll(async () => (await log(page)).shown).toEqual([{ title: 'Cierre del día', body: '¿Cómo fue hoy? Te lleva un minuto.' }])
    await page.clock.runFor(10 * 60_000)
    expect((await log(page)).shown).toHaveLength(1)
  })

  const clickLastNotification = (page: Page) => page.evaluate(() => (window as unknown as { __notificationInstances: { onclick?: () => void }[] }).__notificationInstances.at(-1)?.onclick?.())
  const withCheckInToday = { ...plan, checkIns: [...plan.checkIns, { date: '2026-10-21', exercise: 'no' }] }

  test('reminds a returning user at 22:00 when the check-in is still open (control for the next test)', async ({ page }) => {
    await stubNotifications(page, 'granted', true)
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await openLastTurn(page)
    await expect(page.getByTestId('checkin-remind')).toBeChecked()
    await page.clock.runFor(2 * 60 * 60_000)
    await expect.poll(async () => (await log(page)).shown).toEqual([{ title: 'Cierre del día', body: '¿Cómo fue hoy? Te lleva un minuto.' }])
  })

  test('does not remind someone who already did the check-in, even with the reminder armed', async ({ page }) => {
    await stubNotifications(page, 'granted', true)
    await start(page, SIZES[0], 'light', withCheckInToday, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    await expect(page.getByTestId('checkin-done')).toHaveText('Hecho ✓ · racha 2')
    // Armed for real: the opt-in is on, so only the completed check-in can keep the notification away.
    await openLastTurn(page)
    await expect(page.getByTestId('checkin-remind')).toBeChecked()
    await page.clock.runFor(2 * 60 * 60_000)
    expect((await log(page)).shown).toEqual([])
  })

  test('tapping the notification opens the check-in', async ({ page }) => {
    await stubNotifications(page, 'granted', true)
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    await page.clock.runFor(2 * 60 * 60_000)
    await expect.poll(async () => (await log(page)).shown).toHaveLength(1)
    await clickLastNotification(page)
    await expect(page).toHaveURL(/#\/checkin$/)
  })

  test('turning the reminder off stops it, and a refused permission says so', async ({ page }) => {
    await stubNotifications(page, 'default')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await openLastTurn(page)
    const remind = page.getByTestId('checkin-remind')
    await remind.click()
    await expect(remind).toBeChecked()
    await remind.click()
    await expect(remind).not.toBeChecked()
    await page.clock.runFor(2 * 60 * 60_000)
    expect((await log(page)).shown).toEqual([])
  })

  test('says so when the browser refuses the permission', async ({ page }) => {
    await stubNotifications(page, 'default', false, 'denied')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await openLastTurn(page)
    await page.getByTestId('checkin-remind').click()
    await expect(page.getByText('Las notificaciones están bloqueadas en este navegador', { exact: false })).toBeVisible()
    // Nothing is armed: the button is gone because the browser now says "denied".
    await expect(page.getByTestId('checkin-remind')).toHaveCount(0)
  })

  test('a finished check-in that never had the reminder armed offers no reminder', async ({ page }) => {
    await stubNotifications(page, 'default')
    await start(page, SIZES[0], 'light', withCheckInToday, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    await expect(page.getByTestId('checkin-done')).toHaveText('Hecho ✓ · racha 2')
    await openLastTurn(page)
    await expect(page.getByTestId('checkin-remind')).toHaveCount(0)
  })


  for (const permission of ['denied', 'absent'] as const) {
    test(`offers no reminder where notifications are ${permission === 'denied' ? 'blocked' : 'not supported'}`, async ({ page }) => {
      await stubNotifications(page, permission)
      await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
      await openLastTurn(page)
      await expect(page.getByTestId('checkin-save')).toBeVisible()
      await expect(page.getByRole('switch', { name: /Recordarme/ })).toHaveCount(0)
    })
  }
})

test.describe('an over-wide word in the next-block title', () => {
  test.use({ locale: 'de-DE' })

  // Real layout: the browser hyphenates the word in the page language across the card's lines.
  test('is hyphenated inside its box in German at 375 px, never a bare ellipsis', async ({ page }) => {
    const word = 'Donaudampfschifffahrtsgesellschaft'
    const german = { ...plan, settings: { ...plan.settings, locale: 'de' }, blocks: plan.blocks.map((block) => block.id === 'b-gym' ? { ...block, title: word } : block) }
    await start(page, { width: 375, height: 812 }, 'light', german, '2026-10-21T16:30:00.000Z')
    await page.addInitScript(() => window.localStorage.setItem('next168-language', 'de'))
    await page.goto('./#/today')
    const card = page.getByTestId('now-card')
    await expect(card).toBeVisible()
    await page.waitForFunction(() => document.getAnimations().length === 0)
    const title = card.locator('.now-next-title')
    const shown = title.locator('.whole-word-shown')
    await expect(title).toHaveAttribute('lang', 'de')
    await expect(title).toHaveClass(/whole-word-hyphenated/)
    const text = (await shown.textContent())!.trim()
    expect(text).not.toBe('…')
    expect(text.startsWith('Donaudampf')).toBe(true)
    const rect = await box(title)
    const cardRect = await box(card)
    expect(rect.x).toBeGreaterThanOrEqual(cardRect.x)
    expect(rect.x + rect.width).toBeLessThanOrEqual(cardRect.x + cardRect.width + 0.5)
    // The word wraps inside the title's box: it takes more than one line and nothing runs past the box.
    const lineHeight = await shown.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight) || Number.parseFloat(getComputedStyle(element).fontSize) * 1.2)
    expect((await box(shown)).height).toBeGreaterThan(lineHeight * 1.5)
    // Every line of the drawn word ends inside the title's box (the hidden measuring probes are not the text).
    const lineEnds = await shown.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return Array.from(range.getClientRects(), (line) => line.right)
    })
    expect(lineEnds.length).toBeGreaterThan(1)
    for (const right of lineEnds) expect(right).toBeLessThanOrEqual(rect.x + rect.width + 0.5)
  })
})
