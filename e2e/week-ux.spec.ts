import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, seedKey } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { cssColorAlpha } from './support/cssColor'
import { addFromMenu } from './support/week'

// Week UX slice (#3): tasks drawn in Week, block outcomes, week navigation, "+" with Tarea / Evento / Rutina,
// stable task times and the phone's whole-week overview. Spanish (es-CO), 390x844 and 1440x900, both themes.
test.use({ locale: 'es-CO' })

// Wednesday 2026-10-21 10:07 UTC; the browser and the document both use UTC. A few seconds after a quarter hour
// would round the first task up to the next one, so "now" sits well inside a quarter.
const NOW = new Date('2026-10-21T10:07:00.000Z')
const WEDNESDAY = '2026-10-21'
const THEMES = ['light', 'dark'] as const
// Chromium writes "19–25 oct", Node "19 a 25 de oct".
const RANGE_THIS_WEEK = /^19\s*(–|-|a)\s*25( de)? oct/
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } as const

function plannerDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    workspaceId: 'workspace-week-ux',
    revision: 1,
    updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
      { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
      { id: 'c-exercise', name: 'Ejercicio', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
    ],
    blocks: [
      { id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [1, 2, 3, 4, 5], start: 540, end: 780 },
      { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
      { id: 'b-gym', categoryId: 'c-exercise', title: 'Gimnasio', days: [3], start: 1080, end: 1140 },
    ],
    tasks: [
      { id: 't-report', title: 'Informe', categoryId: 'c-work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' },
      { id: 't-mail', title: 'Responder correos', categoryId: 'c-work', durationMin: 30, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' },
    ],
    checkIns: [],
    actuals: [
      { date: '2026-10-19', blockId: 'b-work', categoryId: 'c-work', plannedStartAt: '2026-10-19T09:00:00.000Z', plannedEndAt: '2026-10-19T13:00:00.000Z', plannedMinutes: 240, status: 'done' },
      { date: '2026-10-20', blockId: 'b-work', categoryId: 'c-work', plannedStartAt: '2026-10-20T09:00:00.000Z', plannedEndAt: '2026-10-20T13:00:00.000Z', plannedMinutes: 240, status: 'skipped' },
    ],
    events: [],
    calendarSources: [],
    appliedProposalIds: [],
    ...overrides,
  }
}

async function openWeek(page: Page, theme: (typeof THEMES)[number], size: keyof typeof SIZES, seed: unknown = plannerDocument(), now = NOW): Promise<void> {
  await page.setViewportSize(SIZES[size])
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: now })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(seed))
  await page.goto('./#/week')
  await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

const column = (page: Page, date: string): Locator => page.locator(`.day-column[data-date="${date}"]`)
const taskChunks = (page: Page, date = WEDNESDAY): Locator => column(page, date).getByTestId('week-task')
const startMinuteOf = async (chunk: Locator) => Number(await chunk.getAttribute('data-start-minute'))

async function box(locator: Locator) {
  const result = await locator.boundingBox()
  expect(result).not.toBeNull()
  return result!
}

for (const theme of THEMES) {
  for (const size of ['phone', 'desktop'] as const) {
    test.describe(`week UX (${size}, ${theme})`, () => {
      test.beforeEach(onlyProject(size))

      test('tasks are drawn dashed inside their block, and blocks show their outcome', async ({ page }) => {
        await openWeek(page, theme, size)
        const chunks = taskChunks(page)
        await expect(chunks).toHaveCount(2)
        // On the five-minute grid, first in priority order: 10:10 Informe, then 11:10 Responder correos.
        expect(await startMinuteOf(chunks.nth(0))).toBe(610)
        expect(await startMinuteOf(chunks.nth(1))).toBe(670)
        await expect(chunks.nth(0)).toHaveAttribute('aria-label', /^Tarea: Informe, /)

        // Geometry: the chunk lies inside the block it was fitted into, with a dashed outline.
        const host = await box(column(page, WEDNESDAY).locator('[data-block-id="b-work"]'))
        for (const index of [0, 1]) {
          const chunk = await box(chunks.nth(index))
          expect(chunk.y).toBeGreaterThanOrEqual(host.y - 0.5)
          expect(chunk.y + chunk.height).toBeLessThanOrEqual(host.y + host.height + 0.5)
          expect(chunk.x).toBeGreaterThanOrEqual(host.x - 0.5)
          expect(chunk.x + chunk.width).toBeLessThanOrEqual(host.x + host.width + 0.5)
        }
        await expect(chunks.nth(0).locator('.task-box')).toHaveCSS('border-top-style', 'dashed')
        await expect(chunks.nth(0)).toBeVisible()
        await expect(chunks.nth(0).getByText('Informe')).toBeVisible()
        // A task is something to tap: it opens the task sheet.
        await expect(chunks.nth(0)).toHaveCSS('pointer-events', 'auto')

        // Outcomes recorded from Today: text and an icon, not colour alone.
        if (size === 'phone') await page.locator('.strip-day').first().click()
        const done = column(page, '2026-10-19').locator('[data-block-id="b-work"]')
        await expect(done).toHaveAttribute('data-status', 'done')
        await expect(done.getByTestId('block-status')).toContainText('Hecho')
        await expect(done.getByTestId('block-status').locator('svg')).toBeVisible()
        await expect(done).toHaveAttribute('aria-label', /, Hecho$/)
        // One visual, one meaning: done is dimmed (60 %) with its check, never struck through.
        await expect(done).toHaveCSS('opacity', '0.6')
        await expect(done.locator('.block-title')).not.toHaveCSS('text-decoration-line', 'line-through')
        if (size === 'phone') await page.locator('.strip-day').nth(1).click()
        const skipped = column(page, '2026-10-20').locator('[data-block-id="b-work"]')
        await expect(skipped.getByTestId('block-status')).toContainText('No')
        await expect(skipped).toHaveCSS('opacity', '1')
        await expect(skipped.locator('.block-title')).toHaveCSS('text-decoration-line', 'line-through')
      })

      test('week navigation pages with the range label and Today returns to this week', async ({ page }) => {
        await openWeek(page, theme, size)
        const range = page.getByTestId('week-range')
        const today = page.getByTestId('week-today')
        await expect(range).toHaveText(RANGE_THIS_WEEK)
        await expect(range).toHaveAttribute('aria-live', 'polite')
        // "Hoy" is only there when another week is shown.
        await expect(today).toHaveCount(0)

        await page.getByRole('button', { name: 'Semana siguiente' }).click()
        await expect(range).toHaveText(/^26( de)? oct.*1( de)? nov/)
        await expect(column(page, '2026-10-26')).toHaveCount(1)
        await expect(column(page, '2026-10-19')).toHaveCount(0)
        await expect(page.getByTestId('now-line')).toHaveCount(0)
        await expect(today).toBeVisible()
        // Planned blocks repeat in the next week; today's tasks stay out of past days but fill the coming ones.
        await expect(column(page, '2026-10-26').locator('[data-block-id="b-work"]')).toHaveCount(1)

        await page.getByRole('button', { name: 'Semana anterior' }).click()
        await page.getByRole('button', { name: 'Semana anterior' }).click()
        await expect(range).toHaveText(/^12\s*(–|-|a)\s*18( de)? oct/)
        await expect(taskChunks(page, '2026-10-14')).toHaveCount(0)

        await expect(today).toBeVisible()
        await today.click()
        await expect(range).toHaveText(RANGE_THIS_WEEK)
        await expect(today).toHaveCount(0)
        await expect(page.getByTestId('now-line')).toHaveCount(1)
        if (size === 'phone') await expect(page.locator('.pager')).toHaveAttribute('data-active-date', WEDNESDAY)

        for (const name of ['Semana anterior', 'Semana siguiente']) {
          const target = await box(page.getByRole('button', { name, exact: true }))
          expect(target.width, name).toBeGreaterThanOrEqual(44)
          expect(target.height, name).toBeGreaterThanOrEqual(44)
        }
        await page.getByRole('button', { name: 'Semana siguiente' }).click()
        const away = await box(page.getByRole('button', { name: 'Hoy', exact: true }))
        expect(away.width).toBeGreaterThanOrEqual(44)
        expect(away.height).toBeGreaterThanOrEqual(44)
        // One compact toolbar: the range with the free hours under it, not a card of its own.
        await expect(page.getByTestId('week-free-hours-slot')).toHaveCount(1)
      })

      test('"+" offers Tarea, Evento and Rutina, and an event created there shows in Week', async ({ page }) => {
        await openWeek(page, theme, size)
        const trigger = page.getByTestId('week-add')
        await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await trigger.click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByRole('menuitem')).toHaveText([/^TareaAlgo por hacer; busca su hueco libre$/, /^EventoUna cita con día y hora$/, /^RutinaSe repite cada semana$/])
        await expect(page.getByRole('menuitem', { name: 'Rutina', exact: true })).toHaveAccessibleDescription('Se repite cada semana')
        // Keyboard: the first entry has focus; Escape closes and gives focus back.
        await expect(page.getByRole('menuitem', { name: 'Tarea', exact: true })).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('menuitem', { name: 'Evento', exact: true })).toBeFocused()
        await page.keyboard.press('ArrowUp')
        await expect(page.getByRole('menuitem', { name: 'Tarea', exact: true })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(trigger).toBeFocused()

        await addFromMenu(page, 'Evento')
        const dialog = page.getByRole('dialog', { name: 'Nuevo evento' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Título').fill('Reunión con Ana')
        await dialog.getByLabel('De', { exact: true }).fill('15:00')
        await expect(dialog.getByLabel('A', { exact: true })).toHaveValue('16:00')
        await dialog.getByRole('button', { name: 'Guardar evento' }).click()
        await expect(dialog).toBeHidden()
        await expect.poll(async () => (await storedPlanner<{ events: { title: string }[] }>(page)).events.map((event) => event.title)).toEqual(['Reunión con Ana'])

        const event = column(page, WEDNESDAY).getByTestId('busy-overlay').filter({ hasText: 'Reunión con Ana' })
        await expect(event).toHaveCount(1)
        const eventBox = await box(event)
        const bounds = await box(column(page, WEDNESDAY))
        // 15:00 sits 15 hours down the 48 px/hour column.
        expect(eventBox.y - bounds.y).toBeCloseTo(15 * 48, 0)
      })

      test('a routine can still be added from "+" and the menu closes on outside press', async ({ page }) => {
        await openWeek(page, theme, size)
        await page.getByTestId('week-add').click()
        await expect(page.getByRole('menu')).toBeVisible()
        await page.getByRole('heading', { level: 1 }).click({ force: true })
        await expect(page.getByRole('menu')).toHaveCount(0)
        await addFromMenu(page, 'Rutina')
        await expect(page.getByRole('dialog', { name: 'Nueva rutina' })).toBeVisible()
      })

      test('axe finds no serious or critical issues with tasks, the menu and the sheet', async ({ page }) => {
        await openWeek(page, theme, size)
        await page.getByTestId('week-add').click()
        await expect(page.getByRole('menu')).toBeVisible()
        // The menu fades in: axe must not sample it halfway (contrast is judged on the blended colours).
        await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
        const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
        expect(results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => `${item.id}: ${item.nodes[0]?.html}`)).toEqual([])
      })
    })
  }

  test.describe(`week on a phone (${theme})`, () => {
    test.beforeEach(onlyProject('phone'))

    // Material 3 FAB placement: 56 px, 16 px above the tab bar and 16 px from the trailing edge (the owner, 2026-10-25:
    // "+" sat too high, over the grid).
    test('"+" floats in the thumb zone 16 px above the tab bar, and the toolbar has no second one', async ({ page }) => {
      await openWeek(page, theme, 'phone')
      const add = page.getByTestId('week-add')
      await expect(add).toHaveCount(1)
      await expect(page.locator('#toolbar-actions').getByTestId('week-add')).toHaveCount(0)
      const target = await box(add)
      const tabbar = await box(page.locator('.tabbar'))
      expect(target.width).toBeCloseTo(56, 0)
      expect(target.height).toBeCloseTo(56, 0)
      expect(tabbar.y - (target.y + target.height)).toBeCloseTo(16, 0)
      expect(SIZES.phone.width - (target.x + target.width)).toBeCloseTo(16, 0)
    })

    test('the last hours scroll clear of "+", and "+" stacks above the undo toast', async ({ page }) => {
      await openWeek(page, theme, 'phone')
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      const add = await box(page.getByTestId('week-add'))
      const lastHour = await box(column(page, WEDNESDAY))
      expect(lastHour.y + lastHour.height).toBeLessThanOrEqual(add.y)

      await column(page, WEDNESDAY).locator('[data-block-id="b-gym"]').first().click({ position: { x: 12, y: 6 } })
      await page.getByRole('button', { name: 'Eliminar rutina' }).click()
      const toast = page.getByTestId('undo-toast')
      await expect(toast).toBeVisible()
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
      const lifted = await box(page.getByTestId('week-add'))
      const toastBox = await box(toast)
      expect(toastBox.y - (lifted.y + lifted.height)).toBeCloseTo(16, 0)
      await toast.getByRole('button', { name: 'Deshacer' }).click()
      await expect(toast).toHaveCount(0)
      await expect.poll(async () => (await box(page.getByTestId('week-add'))).y).toBeCloseTo(add.y, 0)
    })

    test('one toolbar button shows the whole week at a glance and a day opens from it', async ({ page }) => {
      await openWeek(page, theme, 'phone')
      const toggle = page.getByTestId('week-view-toggle')
      await expect(page.getByRole('radiogroup', { name: 'Vista' })).toHaveCount(0)
      await expect(toggle).toHaveAccessibleName('Ver toda la semana')
      await expect(page.getByTestId('week-overview')).toHaveCount(0)
      const toggleBox = await box(toggle)
      expect(toggleBox.width).toBeGreaterThanOrEqual(44)
      expect(toggleBox.height).toBeGreaterThanOrEqual(44)

      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Ver un día')
      const overview = page.getByTestId('week-overview')
      await expect(overview).toBeVisible()
      await expect(overview.locator('.day-column')).toHaveCount(7)
      await expect(page.locator('.pager')).toHaveCount(0)

      // Seven columns and all 24 hours fit the screen: no sideways scroll, and the grid is shorter than the day view.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const columns = overview.locator('.day-column')
      const widths = await columns.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))
      for (const width of widths) expect(width).toBeGreaterThan(30)
      const first = await box(columns.first())
      expect(first.height).toBeLessThan(500)
      expect(first.y + first.height).toBeLessThan(SIZES.phone.height)
      // Planned blocks, the dashed tasks and the now line are all there.
      await expect(columns.nth(2).locator('[data-block-id="b-work"]')).toHaveCount(1)
      await expect(columns.nth(2).getByTestId('week-task')).toHaveCount(2)
      await expect(overview.getByTestId('now-line')).toHaveCount(1)
      // Names for the colours.
      await expect(overview.getByRole('list', { name: 'Categorías' })).toContainText('Trabajo')
      await expect(overview.getByRole('list', { name: 'Categorías' })).toContainText('Tarea')

      for (const day of await overview.locator('.overview-day').all()) {
        const target = await box(day)
        expect(target.width).toBeGreaterThanOrEqual(36)
        expect(target.height).toBeGreaterThanOrEqual(44)
      }
      await overview.getByRole('button', { name: 'Abrir jueves, 22 de octubre' }).click()
      await expect(page.locator('.pager')).toHaveAttribute('data-active-date', '2026-10-22')
      await expect(page.getByTestId('week-overview')).toHaveCount(0)
      await expect(toggle).toHaveAccessibleName('Ver toda la semana')
    })
  })
}

test.describe('week on desktop', () => {
  test.beforeEach(onlyProject('desktop'))

  test('"+" sits in the toolbar and there is no floating one', async ({ page }) => {
    await openWeek(page, 'light', 'desktop')
    await expect(page.locator('#toolbar-actions').getByTestId('week-add')).toHaveCount(1)
    await expect(page.locator('.fab-anchor')).toHaveCount(0)
    await expect(page.getByTestId('week-view-toggle')).toHaveCount(0)
  })
})

test.describe('stable task times', () => {
  test.beforeEach(onlyProject('desktop'))

  test('a task keeps its slot while the clock moves on, and starts on the five-minute grid', async ({ page }) => {
    await openWeek(page, 'light', 'desktop', plannerDocument(), NOW)
    const first = taskChunks(page).nth(0)
    expect(await startMinuteOf(first)).toBe(610)
    expect((await startMinuteOf(first)) % 5).toBe(0)

    await page.clock.fastForward(13 * 60_000)
    await expect(taskChunks(page).nth(0)).toHaveAttribute('data-start-minute', '610')
    await expect(taskChunks(page).nth(1)).toHaveAttribute('data-start-minute', '670')
  })

  test('a task that moves to another day says so, and Deshacer keeps it where it was', async ({ page }) => {
    const document = plannerDocument({
      blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [0, 1, 2, 3, 4, 5, 6], start: 540, end: 600 }],
      tasks: [{ id: 't-report', title: 'Informe', categoryId: 'c-work', durationMin: 45, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
      actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document, new Date('2026-10-21T09:07:00.000Z'))
    const chunk = taskChunks(page)
    await expect(chunk).toHaveCount(1)
    expect(await startMinuteOf(chunk)).toBe(550)
    await expect(page.getByRole('status').getByText('pasó a mañana')).toHaveCount(0)

    // Still under way at 09:50: it stays.
    await page.clock.fastForward(43 * 60_000)
    await expect(taskChunks(page)).toHaveAttribute('data-start-minute', '550')
    await expect(page.getByText('pasó a mañana')).toHaveCount(0)

    // Past its end it moves on to tomorrow, and the notice offers to undo.
    await page.clock.fastForward(15 * 60_000)
    await expect(page.getByText('«Informe» pasó a mañana')).toBeVisible()
    await expect(taskChunks(page, WEDNESDAY)).toHaveCount(0)
    await expect(taskChunks(page, '2026-10-22')).toHaveCount(1)
    expect(await startMinuteOf(taskChunks(page, '2026-10-22'))).toBe(540)

    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(taskChunks(page, WEDNESDAY)).toHaveCount(1)
    expect(await startMinuteOf(taskChunks(page, WEDNESDAY))).toBe(550)
    await expect(taskChunks(page, '2026-10-22')).toHaveCount(0)
    await expect(page.getByText('«Informe» pasó a mañana')).toHaveCount(0)
  })
})

// Tasks that find a free slot, the task sheet and the craft fixes of the Tareas / Semana simplification.
test.describe('tasks in Week', () => {
  test.beforeEach(onlyProject('desktop'))

  test('a task with no category sits in time no routine covers, and a tap opens its sheet to edit, delete and undo', async ({ page }) => {
    const document = plannerDocument({
      tasks: [{ id: 't-gift', title: 'Comprar regalo para mamá', durationMin: 60, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }],
      actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document)
    const chunk = taskChunks(page).first()
    await expect(chunk).toHaveAttribute('aria-label', /^Tarea: Comprar regalo para mamá, /)
    // Trabajo profundo covers 09:00-13:00 on Wednesday: the gift goes after it, not inside work hours.
    expect(await startMinuteOf(chunk)).toBe(780)

    await chunk.click()
    const sheet = page.getByRole('dialog', { name: 'Editar tarea' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByLabel('Tarea', { exact: true })).toHaveValue('Comprar regalo para mamá')
    await sheet.getByLabel('Tarea', { exact: true }).fill('Comprar regalo de cumpleaños')
    await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(taskChunks(page).first()).toHaveAttribute('aria-label', /^Tarea: Comprar regalo de cumpleaños, /)

    await taskChunks(page).first().click()
    await page.getByRole('dialog', { name: 'Editar tarea' }).getByRole('button', { name: 'Eliminar tarea' }).click()
    await expect(taskChunks(page)).toHaveCount(0)
    await expect.poll(async () => (await storedPlanner<{ tasks: unknown[] }>(page)).tasks).toHaveLength(0)
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(taskChunks(page)).toHaveCount(1)
  })

  test('a "+ Tarea" is added without choosing anything and lands in a free slot', async ({ page }) => {
    await openWeek(page, 'light', 'desktop', plannerDocument({ tasks: [], actuals: [] }))
    await addFromMenu(page, 'Tarea')
    const sheet = page.getByRole('dialog', { name: 'Nueva tarea' })
    await sheet.getByLabel('Tarea', { exact: true }).fill('Llamar al banco')
    await sheet.getByRole('radio', { name: '30 min' }).click()
    await sheet.getByRole('button', { name: 'Añadir tarea' }).click()
    await expect(sheet).toBeHidden()
    await expect.poll(async () => (await storedPlanner<{ tasks: { title: string; categoryId?: string; durationMin: number }[] }>(page)).tasks).toMatchObject([{ title: 'Llamar al banco', durationMin: 30 }])
    expect((await storedPlanner<{ tasks: object[] }>(page)).tasks[0]).not.toHaveProperty('categoryId')
    expect(await startMinuteOf(taskChunks(page).first())).toBe(780)
  })

  test('a 30-minute block opens from just outside it: its target is 44 px', async ({ page }) => {
    const document = plannerDocument({
      blocks: [{ id: 'b-walk', categoryId: 'c-exercise', title: 'Caminata', days: [3], start: 720, end: 750 }],
      tasks: [], actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document)
    const walk = column(page, WEDNESDAY).locator('[data-block-id="b-walk"]')
    const drawn = await box(walk)
    expect(drawn.height).toBeLessThan(44)
    const x = drawn.x + drawn.width / 2
    // 9 px under the block, in the empty part of the column.
    await page.mouse.click(x, drawn.y + drawn.height + 9)
    await expect(page.getByRole('dialog', { name: 'Editar rutina' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Farther away, an empty slot still starts a new routine.
    await page.mouse.click(x, drawn.y + drawn.height + 16)
    await expect(page.getByRole('dialog', { name: 'Nueva rutina' })).toBeVisible()
  })

  // verify10 C1: a tap 10.9 px below an 18 px task drawn inside a routine opened the routine. A task has a 44 px target
  // laid over its routine; the routine keeps the rest of its box.
  test('a short task inside a routine opens from just outside it, over the routine', async ({ page }) => {
    await openWeek(page, 'light', 'desktop')
    const found = await page.evaluate(() => {
      for (const task of Array.from(document.querySelectorAll<HTMLElement>('.day-column [data-testid="week-task"][data-layered]'))) {
        const own = task.getBoundingClientRect()
        const host = Array.from(task.parentElement!.querySelectorAll<HTMLElement>(':scope > .block')).find((block) => {
          const box = block.getBoundingClientRect()
          return box.top <= own.top && box.bottom >= own.bottom && box.left <= own.left && box.right >= own.right
        })
        if (!host || own.height >= 44) continue
        const box = host.getBoundingClientRect()
        if (box.bottom - own.bottom < (44 - own.height) / 2 + 1) continue
        task.scrollIntoView({ block: 'center' })
        const at = task.getBoundingClientRect()
        // Inside its 44 px target, just above the target's lower edge (10.9 px below an 18 px task in the report).
        return { x: at.left + at.width / 2, y: at.bottom + (44 - at.height) / 2 - 1, title: task.getAttribute('title') ?? '' }
      }
      return null
    })
    expect(found, 'a task shorter than 44 px inside a routine, with room under it').not.toBeNull()
    await page.mouse.click(found!.x, found!.y)
    // Where the task crowds its routine the press asks which to open (verify11); either way it reaches the task.
    const chooser = page.getByRole('dialog', { name: '¿Cuál quieres abrir?' })
    if (await chooser.isVisible()) await chooser.getByRole('button', { name: new RegExp(found!.title) }).click()
    await expect(page.getByRole('dialog', { name: 'Editar tarea' })).toBeVisible()
  })

  // verify11 C1: where items crowd each other no item may be left without a 44 px press. A task with exactly the time
  // of its routine is drawn as an outline that takes no presses, and a 45-minute task leaves its one-hour routine 5 px:
  // one shared 44 px target asks which of them to open.
  async function pressSharedTarget(page: Page, hitKey: string) {
    const centre = await page.evaluate((key) => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-shared-target]')).find((element) => (element.dataset.sharedItems ?? '').split(' ').includes(key))
      if (!target) return null
      target.scrollIntoView({ block: 'center' })
      const box = target.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height }
    }, hitKey)
    expect(centre, `a shared press target lists ${hitKey}`).not.toBeNull()
    expect(centre!.width).toBeGreaterThanOrEqual(44)
    expect(centre!.height).toBeGreaterThanOrEqual(44)
    await page.mouse.click(centre!.x, centre!.y)
    const chooser = page.getByRole('dialog', { name: '¿Cuál quieres abrir?' })
    await expect(chooser).toBeVisible()
    for (const row of await chooser.getByTestId('press-choice').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    return chooser
  }

  test('a task with the same time as its routine opens from a shared 44 px target that asks which one', async ({ page }) => {
    const document = plannerDocument({
      categories: [...plannerDocument().categories, { id: 'c-learn', name: 'Estudio', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }],
      blocks: [...plannerDocument().blocks, { id: 'b-reading', categoryId: 'c-learn', title: 'Lectura', days: [3], start: 1260, end: 1290 }],
      tasks: [{ id: 't-course', title: 'Terminar el módulo 4', categoryId: 'c-learn', durationMin: 30, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
      actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document)
    const task = column(page, WEDNESDAY).locator('[data-task-id="t-course"]')
    await expect(task).toHaveAttribute('data-start-minute', '1260')
    const key = await task.getAttribute('data-hit-key')
    const chooser = await pressSharedTarget(page, key!)
    await expect(chooser.getByTestId('press-choice')).toHaveText([/Lectura/, /Terminar el módulo 4/])
    await chooser.getByRole('button', { name: /Terminar el módulo 4/ }).click()
    await expect(page.getByRole('dialog', { name: 'Editar tarea' })).toBeVisible()
  })

  test('a one-hour routine its 45-minute task fills opens from a shared 44 px target, and Escape closes the chooser', async ({ page }) => {
    const document = plannerDocument({
      tasks: [{ id: 't-route', title: 'Planear la ruta', categoryId: 'c-exercise', durationMin: 45, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
      actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document)
    const gym = column(page, WEDNESDAY).locator('[data-block-id="b-gym"]')
    await expect(column(page, WEDNESDAY).locator('[data-task-id="t-route"]')).toBeVisible()
    const chooser = await pressSharedTarget(page, (await gym.getAttribute('data-hit-key'))!)
    await expect(chooser.getByTestId('press-choice')).toHaveText([/Gimnasio/, /Planear la ruta/])
    await page.keyboard.press('Escape')
    await expect(chooser).toBeHidden()
    await pressSharedTarget(page, (await gym.getAttribute('data-hit-key'))!)
    await page.getByRole('dialog', { name: '¿Cuál quieres abrir?' }).getByRole('button', { name: /Gimnasio/ }).click()
    await expect(page.getByRole('dialog', { name: 'Editar rutina' })).toBeVisible()
  })

  // verify12: the chooser closed after the editor had taken focus and handed focus back to the page, so Escape did
  // nothing in the editor (focus on <main>, outside the dialog). Focus stays in the newest sheet; closing it returns
  // focus to the item chosen.
  const focusInside = (page: Page, name: string) => page.getByRole('dialog', { name }).evaluate((dialog) => dialog.contains(document.activeElement))
  for (const [label, row, editor, anchor] of [
    ['a routine', /Gimnasio/, 'Editar rutina', '[data-block-id="b-gym"]'],
    ['a task', /Planear la ruta/, 'Editar tarea', '[data-task-id="t-route"]'],
  ] as const) {
    test(`${label} opened from the chooser keeps focus, closes on Escape and gives focus back to it`, async ({ page }) => {
      const document = plannerDocument({
        tasks: [{ id: 't-route', title: 'Planear la ruta', categoryId: 'c-exercise', durationMin: 45, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
        actuals: [],
      })
      await openWeek(page, 'light', 'desktop', document)
      const gym = column(page, WEDNESDAY).locator('[data-block-id="b-gym"]')
      const chooser = await pressSharedTarget(page, (await gym.getAttribute('data-hit-key'))!)
      await chooser.getByRole('button', { name: row }).click()
      const sheet = page.getByRole('dialog', { name: editor })
      await expect(sheet).toBeVisible()
      await expect(chooser).toBeHidden()
      // Past the chooser's own close animation.
      await page.waitForTimeout(400)
      expect(await focusInside(page, editor)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden()
      await expect(column(page, WEDNESDAY).locator(anchor)).toBeFocused()
    })
  }

  test('a sheet opened from the add menu closes on Escape and gives focus back to the menu button', async ({ page }) => {
    await openWeek(page, 'light', 'desktop')
    await addFromMenu(page, 'Rutina')
    const sheet = page.getByRole('dialog', { name: 'Nueva rutina' })
    await expect(sheet).toBeVisible()
    await page.waitForTimeout(400)
    expect(await focusInside(page, 'Nueva rutina')).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(page.getByTestId('week-add')).toBeFocused()
  })

  test('the sticky day header is a thick material that hides what scrolls under it, and labels are drawn above the now-line', async ({ page }) => {
    await openWeek(page, 'light', 'desktop')
    const header = await page.locator('.grid-header').evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(cssColorAlpha(header), header).toBeGreaterThanOrEqual(0.95)
    const layers = await page.evaluate(() => ({
      line: getComputedStyle(document.querySelector('[data-testid="now-line"]')!).zIndex,
      title: getComputedStyle(document.querySelector('button .block-title')!).zIndex,
      task: getComputedStyle(document.querySelector('.task-title')!).zIndex,
    }))
    expect(Number(layers.title)).toBeGreaterThan(Number(layers.line))
    expect(Number(layers.task)).toBeGreaterThan(Number(layers.line))
  })

  // docs/design/visual-design.md › Week items: an event on a routine's title row takes a lane beside it, and each shows
  // its whole title or none, never "D…" or a word cut by the other.
  test('an event on a routine\'s title row, in a narrow column, sits beside it and both titles are whole or not drawn', async ({ page }) => {
    const document = plannerDocument({
      events: [{ id: 'e-1', title: 'Reunión', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, attendees: [] }],
      actuals: [],
    })
    await openWeek(page, 'light', 'desktop', document)
    await page.setViewportSize({ width: 1100, height: 900 })
    const work = column(page, WEDNESDAY).locator('[data-block-id="b-work"]')
    const event = column(page, WEDNESDAY).getByTestId('busy-overlay')
    await work.scrollIntoViewIfNeeded()
    const [block, band] = [await box(work), await box(event)]
    expect(band.x, 'the event starts where the routine ends').toBeGreaterThanOrEqual(block.x + block.width - 0.5)
    const drawn = await page.locator(`.day-column[data-date="${WEDNESDAY}"]`).evaluate((day) => Array.from(day.querySelectorAll<HTMLElement>('button .block-title, button .busy-title:not(.visually-hidden)')).map((title) => {
      const item = title.closest('button')!.getBoundingClientRect()
      const range = window.document.createRange()
      range.selectNodeContents(title)
      return Array.from(range.getClientRects()).every((line) => line.left >= item.left - 0.5 && line.right <= item.right + 0.5 && line.bottom <= item.bottom + 0.5)
    }))
    expect(drawn.every(Boolean)).toBe(true)
    if (await work.locator('.block-title').count()) await expect(work.locator('.block-title')).toHaveCSS('overflow-wrap', 'normal')
  })

  test('a block whose first half hour holds a task shows only its title, not its time range', async ({ page }) => {
    // Now is 08:07, so the first task starts with the 09:00 block.
    await openWeek(page, 'light', 'desktop', plannerDocument({ actuals: [] }), new Date('2026-10-21T08:07:00.000Z'))
    const work = column(page, WEDNESDAY).locator('[data-block-id="b-work"]')
    await expect(work.locator('.block-time')).toBeHidden()
    await expect(work.locator('.block-title')).toBeVisible()
  })
})

test.describe('a block keeps its time when its first task starts later', () => {
  test.beforeEach(onlyProject('desktop'))

  test('the first task starts 75 minutes into the block, so the time range stays', async ({ page }) => {
    await openWeek(page, 'light', 'desktop', plannerDocument({ actuals: [] }))
    const work = column(page, WEDNESDAY).locator('[data-block-id="b-work"]')
    await expect(work.locator('.block-time')).toBeVisible()
  })
})

test.describe('week overview', () => {
  test.beforeEach(onlyProject('phone'))

  test('the hour labels are compact and a short block keeps a drawn height', async ({ page }) => {
    const document = plannerDocument({
      blocks: [
        { id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [1, 2, 3, 4, 5], start: 540, end: 780 },
        { id: 'b-commute', categoryId: 'c-exercise', title: 'Trayecto', days: [3], start: 480, end: 495 },
      ],
      tasks: [], actuals: [],
    })
    await openWeek(page, 'light', 'phone', document)
    await page.getByTestId('week-view-toggle').click()
    const overview = page.getByTestId('week-overview')
    const labels = await overview.locator('.time-axis .hour-label').allTextContents()
    expect(labels.filter(Boolean)).toEqual(['6a', '12p', '6p'])
    const commute = await box(overview.locator('[data-block-id="b-commute"]'))
    expect(commute.height).toBeGreaterThanOrEqual(8)
  })
})
