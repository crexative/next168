import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, seedKey, storedValue } from './fixtures'

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

async function start(page: Page, size: (typeof SIZES)[number], theme: (typeof THEMES)[number], doc: unknown = plan, at = NOW): Promise<void> {
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
  return JSON.parse((await storedValue(page, V2_KEY))!)
}

async function box(locator: Locator) {
  return (await locator.boundingBox())!
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name}, ${theme}`, () => {
      test('the header shows the free hours and how many are done today', async ({ page }) => {
        await start(page, size, theme)
        await open(page, 'today', 'Hoy')
        // 109.75 h to Monday 00:00 minus 4.75 h of Trabajo profundo, 1 h of Gimnasio and 34 h of Dormir.
        await expect(page.getByTestId('free-hours')).toHaveText('Quedan 70 h libres de aquí al domingo · de 168')
        const progress = page.getByTestId('day-progress')
        await expect(progress).toHaveText('0 de 4 hechos hoy')
        await page.getByTestId('now-card').getByRole('button', { name: 'Hecho' }).click()
        await expect(progress).toHaveText('1 de 4 hechos hoy')
        // Both chips sit in the header, inside the viewport, and nothing is clipped.
        for (const chip of [page.getByTestId('free-hours'), progress]) {
          const rect = await box(chip)
          expect(rect.x).toBeGreaterThanOrEqual(0)
          expect(rect.x + rect.width).toBeLessThanOrEqual(size.width)
        }
      })

      test('Hecho / Parcial / Omitido live in the Now card: one row, 44 px targets, filled with an icon when chosen', async ({ page }) => {
        await start(page, size, theme)
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-title')).toHaveText('Trabajo profundo')
        const group = card.getByRole('group', { name: '¿Cómo fue Trabajo profundo?' })
        const chips = group.getByRole('button')
        await expect(chips).toHaveText(['Hecho', 'Parcial', 'Omitido'])
        const rects = await Promise.all([0, 1, 2].map((index) => box(chips.nth(index))))
        for (const rect of rects) {
          expect(rect.height).toBeGreaterThanOrEqual(44)
          expect(rect.width).toBeGreaterThanOrEqual(44)
        }
        // One row: identical top edge, laid out left to right without overlapping, all inside the card.
        expect(new Set(rects.map((rect) => Math.round(rect.y))).size).toBe(1)
        expect(rects[1]!.x).toBeGreaterThanOrEqual(rects[0]!.x + rects[0]!.width)
        expect(rects[2]!.x).toBeGreaterThanOrEqual(rects[1]!.x + rects[1]!.width)
        const cardRect = await box(card)
        expect(rects[2]!.x + rects[2]!.width).toBeLessThanOrEqual(cardRect.x + cardRect.width)
        // Every chip carries an icon, and nothing is pressed yet.
        for (let index = 0; index < 3; index += 1) {
          await expect(chips.nth(index).locator('svg')).toHaveCount(1)
          await expect(chips.nth(index)).toHaveAttribute('aria-pressed', 'false')
        }
        const idle = await chips.nth(0).evaluate((element) => getComputedStyle(element).backgroundColor)

        await chips.nth(0).click()
        await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true')
        await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false')
        // The filled state differs from the idle chip by more than the label weight (the fill eases in over 100 ms).
        await expect.poll(() => chips.nth(0).evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(idle)
        await expect.poll(async () => (await stored(page)).actuals).toMatchObject([{ blockId: 'b-work', status: 'done' }])
        // Tapping the filled chip again takes the answer back.
        await chips.nth(0).click()
        await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false')
        await expect.poll(async () => (await stored(page)).actuals).toEqual([])
      })

      test('a task that starts before the next block is listed in "Después" and done in one tap, with undo', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T10:15:30.000Z')
        await open(page, 'today', 'Hoy')
        const next = page.getByTestId('now-next')
        await expect(next).toContainText('Después')
        await expect(next).toContainText('Llamar a la abuela')
        const check = page.getByTestId('task-check')
        await expect(check).toHaveAccessibleName('Completar Llamar a la abuela')
        const rect = await box(check)
        expect(rect.width).toBeGreaterThanOrEqual(44)
        expect(rect.height).toBeGreaterThanOrEqual(44)
        await check.click()
        await expect(page.getByRole('status').filter({ hasText: 'Tarea hecha: Llamar a la abuela' })).toBeVisible()
        await expect(page.getByTestId('task-check')).toHaveCount(0)
        await expect.poll(async () => (await stored(page)).tasks[0].doneAt).toBeTruthy()
        await expect(page.getByTestId('day-progress')).toHaveText('1 de 4 hechos hoy')

        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect(page.getByTestId('task-check')).toHaveCount(1)
        await expect.poll(async () => (await stored(page)).tasks[0].doneAt).toBeUndefined()
        await expect(page.getByTestId('day-progress')).toHaveText('0 de 4 hechos hoy')
      })

      test('nothing is asked about blocks that started before the plan existed, and last night’s sleep is one line', async ({ page }) => {
        await start(page, size, theme, freshPlan)
        await open(page, 'today', 'Hoy')
        await expect(page.getByTestId('now-title')).toHaveText('Trabajo profundo')
        await expect(page.getByRole('group')).toHaveCount(0)
        await expect(page.getByTestId('day-progress')).toHaveText('0 de 2 hechos hoy')
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

      test('"Sin planificar" and the time until the next block', async ({ page }) => {
        await start(page, size, theme, plan, '2026-10-21T16:30:00.000Z')
        await open(page, 'today', 'Hoy')
        const card = page.getByTestId('now-card')
        await expect(card.getByTestId('now-title')).toHaveText('Sin planificar')
        await expect(card.getByTestId('now-free-for')).toHaveText('en 1 h 30 min')
        await expect(card).not.toContainText('Tiempo libre')
        await expect(card.getByTestId('now-next')).toContainText('Gimnasio')
        await expect(card.getByRole('group')).toHaveCount(0)
      })
    })
  }
}

for (const theme of THEMES) {
  test.describe(`check-in, ${theme}`, () => {
    for (const size of SIZES) {
      test(`${size.name}: card from 20:00, a short form, saved and back on Today`, async ({ page }) => {
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
        // Visible labels on both questions, and the times come from the plan.
        await expect(page.getByText('¿Hiciste ejercicio?', { exact: true })).toBeVisible()
        await expect(page.getByText('Estrés hoy (1 calma – 5 alto)', { exact: true })).toBeVisible()
        await expect(page.getByRole('radiogroup', { name: '¿Hiciste ejercicio?' })).toBeVisible()
        await expect(page.getByRole('radiogroup', { name: 'Estrés hoy (1 calma – 5 alto)' })).toBeVisible()
        await expect(page.getByLabel('Hora de acostarte')).toHaveValue('22:00')
        await expect(page.getByLabel('Hora de despertar')).toHaveValue('06:00')
        await expect(page.getByLabel('Fin del trabajo')).toHaveValue('11:00')
        await expect(page.getByTestId('plan-hint')).toBeVisible()
        // "Fin del trabajo" is not asked on a day without work (Saturday).
        await page.getByLabel('Fecha en que despertaste').fill('2026-10-17')
        await expect(page.getByLabel('Fin del trabajo')).toHaveCount(0)
        await page.getByLabel('Fecha en que despertaste').fill('2026-10-21')
        await expect(page.getByLabel('Fin del trabajo')).toHaveValue('11:00')

        // Taps 2–4: exercise, stress, save.
        await page.getByRole('radio', { name: 'Sí' }).click()
        await page.getByRole('radiogroup', { name: 'Estrés hoy (1 calma – 5 alto)' }).getByRole('radio', { name: '2' }).click()
        await page.getByRole('button', { name: 'Guardar cierre' }).click()

        await expect(page).toHaveURL(/#\/today$/)
        await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
        const done = page.getByTestId('checkin-done')
        await expect(done).toHaveText('Guardado ✓ · racha 2')
        await expect(page.getByTestId('checkin-card').getByRole('link')).toBeFocused()
        await expect.poll(async () => (await stored(page)).checkIns.at(-1)).toEqual({ date: '2026-10-21', bedtime: 1320, wake: 360, workEnd: 660, exercise: 'yes', stress: 2 })
        await page.clock.runFor(5000)
        await expect(done).toHaveText('Hecho ✓ · racha 2')
      })
    }
  })
}

test.describe('check-in answers can be withdrawn', () => {
  test('Borrar clears exercise and stress, and the saved entry loses both fields', async ({ page }) => {
    const saved = { ...plan, checkIns: [...plan.checkIns, { date: '2026-10-21', bedtime: 1320, wake: 360, exercise: 'yes', stress: 3 }] }
    await start(page, SIZES[0], 'light', saved, '2026-10-21T20:30:00.000Z')
    await open(page, 'checkin', 'Cierre del día')
    const exercise = page.getByRole('radiogroup', { name: '¿Hiciste ejercicio?' })
    const stress = page.getByRole('radiogroup', { name: 'Estrés hoy (1 calma – 5 alto)' })
    await expect(exercise.getByRole('radio', { name: 'Sí' })).toHaveAttribute('aria-checked', 'true')
    await expect(stress.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true')
    const clearExercise = page.getByRole('button', { name: 'Borrar: ¿Hiciste ejercicio?' })
    expect((await box(clearExercise)).height).toBeGreaterThanOrEqual(44)
    await clearExercise.click()
    await expect(exercise.getByRole('radio', { name: 'Sí' })).toHaveAttribute('aria-checked', 'false')
    await expect(exercise.getByRole('radio', { name: 'Sí' })).toBeFocused()
    await page.getByRole('button', { name: 'Borrar: Estrés hoy (1 calma – 5 alto)' }).click()
    await expect(page.getByRole('button', { name: /^Borrar/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Guardar cierre' }).click()
    await expect(page).toHaveURL(/#\/today$/)
    await expect.poll(async () => (await stored(page)).checkIns.at(-1)).toEqual({ date: '2026-10-21', bedtime: 1320, wake: 360 })
  })
})

test.describe('nightly reminder', () => {
  // `armed` preloads the opt-in the way a returning user has it: permission already granted and the preference stored
  // before the app starts, so the ticker is running from the first frame and nothing depends on a tap.
  async function stubNotifications(page: Page, permission: NotificationPermission | 'absent', armed = false): Promise<void> {
    if (armed) await page.addInitScript(() => window.localStorage.setItem('next168-checkin-reminder', '1'))
    await page.addInitScript((initial) => {
      const log = { asked: 0, shown: [] as { title: string; body?: string }[] }
      ;(window as unknown as { __notifications: typeof log }).__notifications = log
      if (initial === 'absent') {
        delete (window as unknown as { Notification?: unknown }).Notification
        return
      }
      class FakeNotification {
        static permission = initial as NotificationPermission
        static async requestPermission(): Promise<NotificationPermission> {
          log.asked += 1
          FakeNotification.permission = 'granted'
          return 'granted'
        }
        constructor(title: string, options?: NotificationOptions) { log.shown.push({ title, body: options?.body }) }
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
    }, permission)
  }
  const log = (page: Page) => page.evaluate(() => (window as unknown as { __notifications: { asked: number; shown: { title: string; body?: string }[] } }).__notifications)

  test('is asked for only on tap and notifies once at 22:00', async ({ page }) => {
    await stubNotifications(page, 'default')
    await start(page, SIZES[0], 'light', plan, '2026-10-21T20:30:00.000Z')
    await open(page, 'today', 'Hoy')
    const remind = page.getByRole('button', { name: 'Recordarme a las 22:00' })
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
