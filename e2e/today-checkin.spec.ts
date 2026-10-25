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

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name}, ${theme}`, () => {
      test('the subtitle says the date and the free hours, with no counter and no card', async ({ page }) => {
        await start(page, size, theme)
        await open(page, 'today', 'Hoy')
        // 109.75 h to Monday 00:00 minus 4.75 h of Trabajo profundo, 1 h of Gimnasio and 34 h of Dormir.
        const subtitle = page.getByTestId('today-subtitle')
        await expect(subtitle).toHaveText('miércoles, 21 de octubre · 70 h libres esta semana')
        await expect(page.getByTestId('free-hours')).toHaveCount(0)
        await expect(page.getByTestId('day-progress')).toHaveCount(0)
        await expect(page.getByText('de 168')).toHaveCount(0)
        const rect = await box(subtitle)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
        // Mid-block the card only tells the time left and what comes after: no status question yet.
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-title')).toHaveText('Trabajo profundo')
        await expect(card.getByTestId('now-left')).toHaveText('Quedan 45 min')
        await expect(card.getByTestId('now-next')).toContainText('Después')
        await expect(circle(card)).toHaveCount(0)
        await expect(card.getByRole('group')).toHaveCount(0)
      })

      test('in the last ten minutes the circle appears: 44 px, one tap marks Hecho, with a toast to undo it', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:49:30.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(circle(card)).toHaveCount(0)
        await page.clock.runFor(31_000)
        const control = circle(card)
        await expect(control).toHaveAccessibleName('Marcar como hecho: Trabajo profundo')
        const rect = await box(control)
        expect(rect.width).toBeGreaterThanOrEqual(44)
        expect(rect.height).toBeGreaterThanOrEqual(44)
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
        const idle = await control.locator('.status-ring').evaluate((element) => getComputedStyle(element).backgroundColor)

        await control.click()
        await expect(control).toHaveAttribute('data-status', 'done')
        // Filled with a check, not only recoloured: the ring's fill differs from the idle ring.
        await expect.poll(() => control.locator('.status-ring').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(idle)
        await expect(control.locator('svg')).toHaveCount(1)
        await expect(page.getByRole('status').filter({ hasText: 'Trabajo profundo: Hecho' })).toBeVisible()
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'done' }])

        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(control).toHaveAttribute('data-status', 'none')
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])

        // Tapping a done circle takes the answer back; the toast offers it again.
        await control.click()
        await expect(control).toHaveAttribute('data-status', 'done')
        await control.click()
        await expect(control).toHaveAttribute('data-status', 'none')
        await expect(page.getByRole('status').filter({ hasText: 'Respuesta quitada: Trabajo profundo' })).toBeVisible()
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])
      })

      test('right click opens "A medias" and "No"; A medias asks the minutes, and No is one choice', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:55:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        const control = circle(card)
        await control.click({ button: 'right' })
        const menu = page.getByRole('menu', { name: '¿Cómo fue Trabajo profundo?' })
        await expect(menu).toBeVisible()
        await expect(menu.getByRole('menuitem')).toHaveText(['A medias', 'No'])
        // The menu grows in from 96 % over 200 ms, so its rows reach full size a moment after it is visible.
        for (const item of await menu.getByRole('menuitem').all()) await expect.poll(async () => (await box(item)).height).toBeGreaterThanOrEqual(44)
        await menu.getByRole('menuitem', { name: 'A medias' }).click()
        const minutes = card.getByLabel('Minutos dedicados (planificados 120)')
        await expect(minutes).toHaveValue('60')
        await minutes.fill('45')
        await card.getByRole('button', { name: 'Guardar' }).click()
        await expect(control).toHaveAttribute('data-status', 'partial')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'partial', actualMinutes: 45 }])
        await expect(page.getByRole('status').filter({ hasText: 'Trabajo profundo: A medias' })).toBeVisible()

        await control.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'No', exact: true }).click()
        await expect(control).toHaveAttribute('data-status', 'skipped')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'skipped' }])
        await control.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Quitar respuesta' }).click()
        await expect(control).toHaveAttribute('data-status', 'none')
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])
      })

      test('a long press opens the same menu, and Escape closes it and returns focus', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:55:00.000Z')
        await open(page, 'today', 'Hoy')
        const control = circle(page.getByTestId('now-card'))
        const rect = await box(control)
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
        await page.mouse.down()
        await page.clock.runFor(600)
        await page.mouse.up()
        await expect(page.getByRole('menu')).toBeVisible()
        // The release after a long press is not a tap: nothing was recorded.
        expect((await stored(page)).actuals).toEqual([])
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(control).toBeFocused()
      })

      test('a finished block is one row with one circle: no buttons, sub-labels or emoji', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T12:00:00.000Z')
        await open(page, 'today', 'Hoy')
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

      test('an appointment on top of a block is a quiet line, not a red alarm', async ({ page }) => {
        const withAppointment = { ...plan, events: [{ id: 'e-doctor', title: 'Cita médica', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, attendees: [] }] }
        await start(page, size, theme, withAppointment, '2026-10-21T12:00:00.000Z')
        await open(page, 'today', 'Hoy')
        // Matched by their own title: each row's note names the other one.
        const work = page.getByTestId('timeline-item').filter({ has: page.locator('.row-title-text', { hasText: 'Trabajo profundo' }) })
        const doctor = page.getByTestId('timeline-item').filter({ has: page.locator('.row-title-text', { hasText: 'Cita médica' }) })
        await expect(work.getByTestId('timeline-overlap')).toHaveText('Se cruza con Cita médica')
        await expect(doctor.getByTestId('timeline-overlap')).toHaveText('Se cruza con Trabajo profundo')
        await expect(page.getByTestId('conflict-mark')).toHaveCount(0)
        await expect(page.getByText('Conflicto')).toHaveCount(0)
        const [note, danger] = await Promise.all([
          work.getByTestId('timeline-overlap').evaluate((element) => getComputedStyle(element).color),
          page.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--danger-label)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color }),
        ])
        expect(note).not.toBe(danger)
      })

      test('tonight’s sleep reads from its start to its end, and a re-fitted task starts on a five-minute step', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:31:30.000Z')
        await open(page, 'today', 'Hoy')
        const sleep = page.getByTestId('timeline-item').filter({ hasText: 'Dormir' }).last()
        await expect(sleep.getByTestId('timeline-start')).toHaveText('10:00 p. m.')
        await expect(sleep.getByTestId('timeline-end')).toHaveCount(0)
        await expect(sleep.getByTestId('timeline-span-hint')).toHaveText('Hasta las 6:00 a. m.')
        await expect(page.getByText('12:00 a. m.')).toHaveCount(0)
        const task = page.locator('[data-kind="task"]').first()
        await expect(task.getByTestId('timeline-start')).toHaveText('10:35 a. m.')
      })

      test('a task that starts before the next block is listed in "Después" and done in one tap, with undo', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:15:30.000Z')
        await open(page, 'today', 'Hoy')
        const next = page.getByTestId('now-next')
        await expect(next).toContainText('Después')
        await expect(next).toContainText('Llamar a la abuela')
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
        await expect(page.getByTestId('timeline-item').filter({ hasText: 'Trabajo profundo' }).getByTestId('status-control')).toHaveCount(0)
        const carry = page.getByTestId('timeline-carry')
        await expect(carry).toContainText('Dormir')
        await expect(carry).toContainText('Desde ayer · hasta')
        // A single line: the whole row is shorter than two text lines plus its padding.
        const row = page.locator('li.is-carry')
        expect((await box(row)).height).toBeLessThan(48)
        await expect(row.getByTestId('timeline-start')).toHaveCount(0)
        const lines = await carry.evaluate((element) => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)))
        expect(lines).toBe(1)
      })

      test('free time says when it ends, in one title under "AHORA"', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T16:30:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-eyebrow')).toHaveText('Ahora')
        await expect(card.getByTestId('now-eyebrow')).toHaveCSS('text-transform', 'uppercase')
        await expect(card.getByTestId('now-title')).toHaveText('Tiempo libre hasta las 6:00 p. m.')
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

const fact = (page: Page, testId: string) => page.getByTestId(testId)

for (const theme of THEMES) {
  test.describe(`check-in, ${theme}`, () => {
    for (const size of SIZES) {
      test(`${size.name}: card from 20:00, sentences, the day's blocks, saved and back on Today`, async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T19:59:00.000Z')
        await open(page, 'today', 'Hoy')
        await expect(page.getByTestId('checkin-card')).toHaveCount(0)
        await page.clock.fastForward(61_000)
        const card = page.getByTestId('checkin-card')
        await expect(card).toBeVisible()
        await expect(card).toContainText('Cierre del día')
        await expect(card).not.toContainText('Registro de la noche')

        // Tap 1: open the form. The route and the card agree on one name.
        await card.getByRole('link', { name: /Cierre del día/ }).click()
        await expect(page.getByRole('heading', { level: 1, name: 'Cierre del día' })).toBeVisible()
        await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
        // The day is a line under the title, not a field; the times are sentences prefilled from the plan.
        await expect(page.getByTestId('checkin-date')).toHaveText('miércoles, 21 de octubre')
        await expect(page.locator('input[type="date"]')).toHaveCount(0)
        await expect(page.getByLabel('Fecha en que despertaste')).toHaveCount(0)
        await expect(fact(page, 'fact-bedtime')).toHaveText('Anoche te acostaste a las 10:00 p. m.')
        await expect(fact(page, 'fact-wake')).toHaveText('Hoy te levantaste a las 6:00 a. m.')
        await expect(fact(page, 'fact-work-end')).toHaveText('Hoy terminaste de trabajar a las 11:00 a. m.')
        await expect(page.getByTestId('plan-hint')).toBeVisible()
        for (const testId of ['fact-bedtime', 'fact-wake', 'fact-work-end']) expect((await box(fact(page, testId))).height).toBeGreaterThanOrEqual(44)

        // The wake-up sentence opens its time when tapped, and goes back to a sentence when it is set.
        await fact(page, 'fact-wake').getByRole('button').click()
        const wake = fact(page, 'fact-wake').getByLabel('¿A qué hora te levantaste hoy?')
        await expect(wake).toHaveValue('06:00')
        await wake.fill('07:00')
        await wake.press('Enter')
        await expect(fact(page, 'fact-wake')).toHaveText('Hoy te levantaste a las 7:00 a. m.')
        await fact(page, 'fact-wake').getByRole('button').click()
        await fact(page, 'fact-wake').getByLabel('¿A qué hora te levantaste hoy?').fill('06:00')
        await fact(page, 'fact-wake').getByLabel('¿A qué hora te levantaste hoy?').press('Enter')

        // The exercise question is gone: the day's blocks that are over and unmarked ask instead, with the Hoy circle.
        await expect(page.getByText('¿Hiciste ejercicio?')).toHaveCount(0)
        const blocks = page.getByTestId('checkin-blocks')
        await expect(blocks).toContainText('Aún sin marcar')
        const gym = blocks.getByTestId('checkin-block').filter({ hasText: 'Gimnasio' })
        await expect(gym).toHaveCount(1)
        await expect(gym.getByTestId('status-control')).toHaveAccessibleName('Marcar como hecho: Gimnasio')
        expect((await box(gym.getByTestId('status-control'))).width).toBeGreaterThanOrEqual(44)
        // Stress keeps its question, with the ends of the scale named instead of folded into the label.
        const stress = page.getByRole('radiogroup', { name: 'Estrés hoy' })
        await expect(stress).toBeVisible()
        await expect(page.getByTestId('choice-ends')).toContainText('calma')
        await expect(page.getByTestId('choice-ends')).toContainText('alto')

        // Taps 2–4: the gym block, stress, save. Exercise is read from the block, so the timeline agrees with the check-in.
        await gym.getByTestId('status-control').click()
        await expect(gym.getByTestId('status-control')).toHaveAttribute('data-status', 'done')
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-gym', status: 'done' }])
        await stress.getByRole('radio', { name: '2' }).click()
        await page.getByRole('button', { name: 'Guardar cierre' }).click()

        await expect(page).toHaveURL(/#\/today$/)
        await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
        const done = page.getByTestId('checkin-done')
        await expect(done).toHaveText('Guardado ✓ · racha 2')
        await expect(page.getByTestId('checkin-card').getByRole('link')).toBeFocused()
        await expect.poll(async () => (await stored(page)).checkIns.at(-1)).toEqual({ date: '2026-10-21', bedtime: 1320, wake: 360, workEnd: 660, exercise: 'yes', stress: 2 })
        await page.clock.runFor(5000)
        await expect(done).toHaveText('Hecho ✓ · racha 2')
        // Hoy shows the same answer on the same block: one fact, one place.
        await expect(page.getByTestId('timeline-item').filter({ hasText: 'Gimnasio' }).getByTestId('status-control')).toHaveAttribute('data-status', 'done')
      })
    }

    test('the back control is top-leading in the toolbar, above the large title, and leads to Hoy', async ({ page }) => {
      await start(page, SIZES[0], theme, plan, '2026-10-21T20:30:00.000Z')
      await open(page, 'checkin', 'Cierre del día')
      const back = page.locator('.toolbar-inner').getByRole('link', { name: 'Volver a Hoy' })
      await expect(back).toBeVisible()
      const [backRect, gearRect, toolbarRect] = await Promise.all([box(back), box(page.locator('.toolbar-actions .gear')), box(page.locator('.toolbar'))])
      // Leading edge, on the toolbar row level with the settings gear, which is the trailing control of that row.
      expect(backRect.x).toBeLessThan(SIZES[0].width / 2)
      expect(backRect.x + backRect.width).toBeLessThan(gearRect.x)
      expect(Math.abs(backRect.y + backRect.height / 2 - (gearRect.y + gearRect.height / 2))).toBeLessThanOrEqual(2)
      expect(backRect.y + backRect.height).toBeLessThanOrEqual(toolbarRect.y + toolbarRect.height + 1)
      expect(backRect.height).toBeGreaterThanOrEqual(44)
      // Under the title there is the date line, not a back link.
      await expect(page.locator('.checkin').getByRole('link', { name: 'Volver a Hoy' })).toHaveCount(0)
      await back.click()
      await expect(page).toHaveURL(/#\/today$/)
    })

    test('Fin del trabajo is not said on a day without work (Saturday)', async ({ page }) => {
      await start(page, SIZES[0], theme, plan, '2026-10-24T20:30:00.000Z')
      await open(page, 'checkin', 'Cierre del día')
      await expect(page.getByTestId('checkin-date')).toHaveText('sábado, 24 de octubre')
      await expect(fact(page, 'fact-bedtime')).toBeVisible()
      await expect(fact(page, 'fact-work-end')).toHaveCount(0)
    })
  })
}

test.describe('check-in answers can be withdrawn', () => {
  test('Borrar clears stress, and the saved entry loses the field but keeps what was derived', async ({ page }) => {
    // Tonight's gym was marked done on Hoy, so the check-in derives "exercise: yes" from the timeline (an unmarked
    // block would leave it unknown, and the saved answer would be dropped).
    const gymDone = {
      date: '2026-10-21', blockId: 'b-gym', categoryId: 'c-exercise', plannedStartAt: '2026-10-21T18:00:00.000Z',
      plannedEndAt: '2026-10-21T19:00:00.000Z', plannedMinutes: 60, status: 'done',
    }
    const saved = { ...plan, actuals: [gymDone], checkIns: [...plan.checkIns, { date: '2026-10-21', bedtime: 1320, wake: 360, exercise: 'yes', stress: 3 }] }
    await start(page, SIZES[0], 'light', saved, '2026-10-21T20:30:00.000Z')
    await open(page, 'checkin', 'Cierre del día')
    const stress = page.getByRole('radiogroup', { name: 'Estrés hoy' })
    await expect(stress.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true')
    const clearStress = page.getByRole('button', { name: 'Borrar: Estrés hoy' })
    expect((await box(clearStress)).height).toBeGreaterThanOrEqual(44)
    await clearStress.click()
    await expect(stress.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'false')
    await expect(stress.getByRole('radio', { name: '1' })).toBeFocused()
    await expect(page.getByRole('button', { name: /^Borrar/ })).toHaveCount(0)
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
  const log = (page: Page) => page.evaluate(() => (window as unknown as { __notifications: { asked: number; shown: { title: string; body?: string }[] } }).__notifications)

  test('is asked for only on tap and notifies once at 22:00', async ({ page }) => {
    await stubNotifications(page, 'default')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    // es-CO reads a 12-hour clock: the reminder follows it (verify4 defect 9 wrote "Recordarme a las 22:00").
    const remind = page.getByRole('button', { name: /^Recordarme a las 10:00\sp\.\s?m\.$/u })
    await expect(remind).toHaveAttribute('aria-pressed', 'false')
    expect((await box(remind)).height).toBeGreaterThanOrEqual(44)
    expect((await log(page)).asked).toBe(0)

    await remind.click()
    await expect(remind).toHaveAttribute('aria-pressed', 'true')
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
    await open(page, 'today', 'Hoy')
    await expect(page.getByTestId('checkin-remind')).toHaveAttribute('aria-pressed', 'true')
    await page.clock.runFor(2 * 60 * 60_000)
    await expect.poll(async () => (await log(page)).shown).toEqual([{ title: 'Cierre del día', body: '¿Cómo fue hoy? Te lleva un minuto.' }])
  })

  test('does not remind someone who already did the check-in, even with the reminder armed', async ({ page }) => {
    await stubNotifications(page, 'granted', true)
    await start(page, SIZES[0], 'light', withCheckInToday, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    await expect(page.getByTestId('checkin-done')).toHaveText('Hecho ✓ · racha 2')
    // Armed for real: the opt-in is on, so only the completed check-in can keep the notification away.
    await expect(page.getByTestId('checkin-remind')).toHaveAttribute('aria-pressed', 'true')
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
    await open(page, 'today', 'Hoy')
    const remind = page.getByTestId('checkin-remind')
    await remind.click()
    await expect(remind).toHaveAttribute('aria-pressed', 'true')
    await remind.click()
    await expect(remind).toHaveAttribute('aria-pressed', 'false')
    await page.clock.runFor(2 * 60 * 60_000)
    expect((await log(page)).shown).toEqual([])
  })

  test('says so when the browser refuses the permission', async ({ page }) => {
    await stubNotifications(page, 'default', false, 'denied')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
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
    await expect(page.getByTestId('checkin-remind')).toHaveCount(0)
  })


  for (const permission of ['denied', 'absent'] as const) {
    test(`offers no reminder where notifications are ${permission === 'denied' ? 'blocked' : 'not supported'}`, async ({ page }) => {
      await stubNotifications(page, permission)
      await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
      await open(page, 'today', 'Hoy')
      await expect(page.getByTestId('checkin-card')).toBeVisible()
      await expect(page.getByRole('button', { name: /Recordarme/ })).toHaveCount(0)
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
