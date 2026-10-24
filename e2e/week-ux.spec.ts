import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, seedKey, storedValue } from './fixtures'
import { addFromMenu } from './support/week'

// Week UX slice (#3): tasks drawn in Week, block outcomes, week navigation, "+" with Block / Event,
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
        // Snapped to the quarter hour, first in priority order: 10:15 Informe, then 11:15 Responder correos.
        expect(await startMinuteOf(chunks.nth(0))).toBe(615)
        expect(await startMinuteOf(chunks.nth(1))).toBe(675)
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
        // The block underneath stays tappable: the chunk does not catch pointer events.
        await expect(chunks.nth(0)).toHaveCSS('pointer-events', 'none')

        // Outcomes recorded from Today: text and an icon, not colour alone.
        if (size === 'phone') await page.locator('.strip-day').first().click()
        const done = column(page, '2026-10-19').locator('[data-block-id="b-work"]')
        await expect(done).toHaveAttribute('data-status', 'done')
        await expect(done.getByTestId('block-status')).toContainText('Hecho')
        await expect(done.getByTestId('block-status').locator('svg')).toBeVisible()
        await expect(done).toHaveAttribute('aria-label', /, Hecho$/)
        if (size === 'phone') await page.locator('.strip-day').nth(1).click()
        const skipped = column(page, '2026-10-20').locator('[data-block-id="b-work"]')
        await expect(skipped.getByTestId('block-status')).toContainText('Omitido')
      })

      test('week navigation pages with the range label and Today returns to this week', async ({ page }) => {
        await openWeek(page, theme, size)
        const range = page.getByTestId('week-range')
        const today = page.getByTestId('week-today')
        await expect(range).toHaveText(RANGE_THIS_WEEK)
        await expect(range).toHaveAttribute('aria-live', 'polite')
        await expect(today).toBeDisabled()

        await page.getByRole('button', { name: 'Semana siguiente' }).click()
        await expect(range).toHaveText(/^26( de)? oct.*1( de)? nov/)
        await expect(column(page, '2026-10-26')).toHaveCount(1)
        await expect(column(page, '2026-10-19')).toHaveCount(0)
        await expect(page.getByTestId('now-line')).toHaveCount(0)
        await expect(today).toBeEnabled()
        // Planned blocks repeat in the next week; today's tasks stay out of past days but fill the coming ones.
        await expect(column(page, '2026-10-26').locator('[data-block-id="b-work"]')).toHaveCount(1)

        await page.getByRole('button', { name: 'Semana anterior' }).click()
        await page.getByRole('button', { name: 'Semana anterior' }).click()
        await expect(range).toHaveText(/^12\s*(–|-|a)\s*18( de)? oct/)
        await expect(taskChunks(page, '2026-10-14')).toHaveCount(0)

        await today.click()
        await expect(range).toHaveText(RANGE_THIS_WEEK)
        await expect(today).toBeDisabled()
        await expect(page.getByTestId('now-line')).toHaveCount(1)
        if (size === 'phone') await expect(page.locator('.pager')).toHaveAttribute('data-active-date', WEDNESDAY)

        for (const name of ['Semana anterior', 'Semana siguiente', 'Hoy']) {
          const target = await box(page.getByRole('button', { name, exact: true }))
          expect(target.width, name).toBeGreaterThanOrEqual(44)
          expect(target.height, name).toBeGreaterThanOrEqual(44)
        }
        await expect(page.getByTestId('week-free-hours-slot')).toHaveCount(1)
      })

      test('"+" offers Bloque and Evento, and an event created there shows in Week', async ({ page }) => {
        await openWeek(page, theme, size)
        const trigger = page.getByTestId('week-add')
        await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await trigger.click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(page.getByRole('menuitem')).toHaveText(['Bloque', 'Evento'])
        // Keyboard: the first entry has focus; Escape closes and gives focus back.
        await expect(page.getByRole('menuitem', { name: 'Bloque' })).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('menuitem', { name: 'Evento' })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(trigger).toBeFocused()

        await addFromMenu(page, 'Evento')
        const dialog = page.getByRole('dialog', { name: 'Nuevo evento' })
        await expect(dialog).toBeVisible()
        await dialog.getByLabel('Título').fill('Reunión con Ana')
        await dialog.getByLabel('Hora').fill('15:00')
        await dialog.getByRole('button', { name: 'Guardar evento' }).click()
        await expect(dialog).toBeHidden()
        await expect.poll(async () => JSON.parse((await storedValue(page, V2_KEY))!).events.map((event: { title: string }) => event.title)).toEqual(['Reunión con Ana'])

        const event = column(page, WEDNESDAY).getByTestId('busy-overlay').filter({ hasText: 'Reunión con Ana' })
        await expect(event).toHaveCount(1)
        const eventBox = await box(event)
        const bounds = await box(column(page, WEDNESDAY))
        // 15:00 sits 15 hours down the 48 px/hour column.
        expect(eventBox.y - bounds.y).toBeCloseTo(15 * 48, 0)
      })

      test('a block can still be added from "+" and the menu closes on outside press', async ({ page }) => {
        await openWeek(page, theme, size)
        await page.getByTestId('week-add').click()
        await expect(page.getByRole('menu')).toBeVisible()
        await page.getByRole('heading', { level: 1 }).click({ force: true })
        await expect(page.getByRole('menu')).toHaveCount(0)
        await addFromMenu(page, 'Bloque')
        await expect(page.getByRole('dialog', { name: 'Nuevo bloque' })).toBeVisible()
      })

      test('axe finds no serious or critical issues with tasks, the menu and the sheet', async ({ page }) => {
        await openWeek(page, theme, size)
        await page.getByTestId('week-add').click()
        await expect(page.getByRole('menu')).toBeVisible()
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
        const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
        expect(results.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical').map((item) => `${item.id}: ${item.nodes[0]?.html}`)).toEqual([])
      })
    })
  }

  test.describe(`week on a phone (${theme})`, () => {
    test.beforeEach(onlyProject('phone'))

    test('"+" floats in the thumb zone above the tab bar, and the toolbar has no second one', async ({ page }) => {
      await openWeek(page, theme, 'phone')
      const add = page.getByTestId('week-add')
      await expect(add).toHaveCount(1)
      await expect(page.locator('#toolbar-actions').getByTestId('week-add')).toHaveCount(0)
      const target = await box(add)
      const tabbar = await box(page.locator('.tabbar'))
      expect(target.y).toBeGreaterThan(SIZES.phone.height / 2)
      expect(target.y + target.height).toBeLessThanOrEqual(tabbar.y)
      expect(target.x + target.width).toBeLessThanOrEqual(SIZES.phone.width)
      expect(target.width).toBeGreaterThanOrEqual(44)
      expect(target.height).toBeGreaterThanOrEqual(44)
    })

    test('the Día / Semana toggle shows the whole week at a glance and a day opens from it', async ({ page }) => {
      await openWeek(page, theme, 'phone')
      const toggle = page.getByRole('radiogroup', { name: 'Vista' })
      await expect(toggle.getByRole('radio', { name: 'Día' })).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('week-overview')).toHaveCount(0)

      await toggle.getByRole('radio', { name: 'Semana' }).click()
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
      await expect(toggle.getByRole('radio', { name: 'Día' })).toHaveAttribute('aria-checked', 'true')
    })
  })
}

test.describe('week on desktop', () => {
  test.beforeEach(onlyProject('desktop'))

  test('"+" sits in the toolbar and there is no floating one', async ({ page }) => {
    await openWeek(page, 'light', 'desktop')
    await expect(page.locator('#toolbar-actions').getByTestId('week-add')).toHaveCount(1)
    await expect(page.locator('.fab-anchor')).toHaveCount(0)
    await expect(page.getByRole('radiogroup', { name: 'Vista' })).toHaveCount(0)
  })
})

test.describe('stable task times', () => {
  test.beforeEach(onlyProject('desktop'))

  test('a task keeps its slot while the clock moves on, and snaps to the quarter hour', async ({ page }) => {
    await openWeek(page, 'light', 'desktop', plannerDocument(), NOW)
    const first = taskChunks(page).nth(0)
    expect(await startMinuteOf(first)).toBe(615)
    expect((await startMinuteOf(first)) % 15).toBe(0)

    await page.clock.fastForward(13 * 60_000)
    await expect(taskChunks(page).nth(0)).toHaveAttribute('data-start-minute', '615')
    await expect(taskChunks(page).nth(1)).toHaveAttribute('data-start-minute', '675')
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
    expect(await startMinuteOf(chunk)).toBe(555)
    await expect(page.getByRole('status').getByText('pasó a mañana')).toHaveCount(0)

    // Still under way at 09:50: it stays.
    await page.clock.fastForward(43 * 60_000)
    await expect(taskChunks(page)).toHaveAttribute('data-start-minute', '555')
    await expect(page.getByText('pasó a mañana')).toHaveCount(0)

    // Past its end it moves on to tomorrow, and the notice offers to undo.
    await page.clock.fastForward(15 * 60_000)
    await expect(page.getByText('«Informe» pasó a mañana')).toBeVisible()
    await expect(taskChunks(page, WEDNESDAY)).toHaveCount(0)
    await expect(taskChunks(page, '2026-10-22')).toHaveCount(1)
    expect(await startMinuteOf(taskChunks(page, '2026-10-22'))).toBe(540)

    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(taskChunks(page, WEDNESDAY)).toHaveCount(1)
    expect(await startMinuteOf(taskChunks(page, WEDNESDAY))).toBe(555)
    await expect(taskChunks(page, '2026-10-22')).toHaveCount(0)
    await expect(page.getByText('«Informe» pasó a mañana')).toHaveCount(0)
  })
})
