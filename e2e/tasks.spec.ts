import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, onlyProject, seedKey } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { visualIntegrityViolations } from './support/visualIntegrity'

// Tareas: a task finds a free slot on its own, the length is one tap, a tap opens the task and a swipe removes it
// with Undo. Spanish (es-CO), 390x844 and 1440x900, both themes.
test.use({ locale: 'es-CO' })

// Wednesday 2026-10-21 10:07 UTC; the browser and the document both use UTC.
const NOW = new Date('2026-10-21T10:07:00.000Z')
const THEMES = ['light', 'dark'] as const
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } as const

const plannerDocument = () => ({
  schemaVersion: 2,
  workspaceId: 'workspace-tasks',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sueño', icon: '😴', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-commute', name: 'Desplazamientos', icon: '🚌', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'c-family', name: 'Familia', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  // Work covers 10:00-12:00 today, and sleep the night.
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [0, 1, 2, 3, 4, 5, 6], start: 600, end: 720 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
  ],
  tasks: [{ id: 't-report', title: 'Informe', categoryId: 'c-work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
  checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
})

async function openTasks(page: Page, theme: (typeof THEMES)[number], size: keyof typeof SIZES): Promise<void> {
  await page.setViewportSize(SIZES[size])
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: NOW })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(plannerDocument()))
  await page.goto('./#/tasks')
  await expect(page.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

for (const theme of THEMES) {
  for (const size of ['phone', 'desktop'] as const) {
    test.describe(`tasks (${size}, ${theme})`, () => {
      test.beforeEach(onlyProject(size))

      // With a length (typed here, read by the L0 grammar) a task is placed; without one it is a to-do (O-1).
      test('Enter adds a task that fits any free slot, never inside work hours', async ({ page }) => {
        await openTasks(page, theme, size)
        const field = page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)')
        await field.fill('Comprar regalo para mamá 1 h')
        await expect(page.getByTestId('capture-chip')).toHaveCount(1)
        await field.press('Enter')
        await expect(field).toHaveValue('')
        await expect.poll(async () => (await storedPlanner<{ tasks: { title: string; categoryId?: string }[] }>(page)).tasks.map((task) => task.title)).toContain('Comprar regalo para mamá')
        const gift = (await storedPlanner<{ tasks: { title: string; categoryId?: string }[] }>(page)).tasks.find((task) => task.title === 'Comprar regalo para mamá')!
        expect(gift).not.toHaveProperty('categoryId')
        // Work (10:00-12:00) holds the report; the gift goes to the first free hour after now, outside work.
        const row = page.getByTestId('placed-task').filter({ hasText: 'Comprar regalo para mamá' })
        await expect(row).toContainText(/12:00\s*p\.\s*m\.\s*\u2060?[–-]\u2060?\s*1:00\s*p\.\s*m\./)
        await expect(row).not.toContainText('Trabajo')
      })

      test('"Categoría" offers any free slot and the categories, never Sueño or Desplazamientos', async ({ page }) => {
        await openTasks(page, theme, size)
        await page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)').fill('Leer 30 páginas')
        const details = page.getByTestId('task-details')
        await details.getByRole('button', { name: 'Más opciones' }).click()
        await expect(details.getByLabel('Categoría').locator('option')).toHaveText(['En cualquier hueco libre', 'Trabajo', 'Familia'])
        await expect(details.getByLabel('Categoría')).toHaveValue('')
        await details.getByRole('radio', { name: '30 min' }).click()
        await details.getByLabel('Categoría').selectOption('c-family')
        await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click()
        await expect.poll(async () => (await storedPlanner<{ tasks: { title: string; categoryId?: string; durationMin: number }[] }>(page)).tasks.find((task) => task.title === 'Leer 30 páginas')).toMatchObject({ categoryId: 'c-family', durationMin: 30 })
      })

      test('a tap on a task opens it to edit; a swipe removes it and Deshacer brings it back', async ({ page }) => {
        await openTasks(page, theme, size)
        const row = page.getByTestId('placed-task').filter({ hasText: 'Informe' })
        await row.locator('.task-text').click()
        const sheet = page.getByRole('dialog', { name: 'Editar tarea' })
        await expect(sheet).toBeVisible()
        await expect(sheet.getByLabel('Tarea', { exact: true })).toHaveValue('Informe')
        await sheet.getByLabel('Tarea', { exact: true }).fill('Informe trimestral')
        await sheet.getByRole('button', { name: 'Guardar', exact: true }).click()
        await expect(sheet).toBeHidden()
        await expect.poll(async () => (await storedPlanner<{ tasks: { title: string }[] }>(page)).tasks[0]!.title).toBe('Informe trimestral')

        const content = page.getByTestId('placed-task').first().locator('.task-content')
        const box = (await content.boundingBox())!
        const y = box.y + box.height / 2
        await page.mouse.move(box.x + box.width - 30, y)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width - 160, y, { steps: 8 })
        await page.mouse.up()
        await expect(page.getByText('Eliminada «Informe trimestral»')).toBeVisible()
        await expect.poll(async () => (await storedPlanner<{ tasks: unknown[] }>(page)).tasks).toHaveLength(0)
        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect.poll(async () => (await storedPlanner<{ tasks: unknown[] }>(page)).tasks).toHaveLength(1)
      })

      test('the circle completes a task and the row has no delete button', async ({ page }) => {
        await openTasks(page, theme, size)
        const row = page.getByTestId('placed-task').filter({ hasText: 'Informe' })
        await expect(row.getByRole('button')).toHaveCount(2)
        const circle = await row.getByRole('button', { name: 'Completar Informe' }).boundingBox()
        expect(circle!.width).toBeGreaterThanOrEqual(44)
        expect(circle!.height).toBeGreaterThanOrEqual(44)
        await row.getByRole('button', { name: 'Completar Informe' }).click()
        await expect(page.getByTestId('done-task')).toContainText('Informe')
      })

      test('nothing is clipped with the form and its more options open', async ({ page }) => {
        await openTasks(page, theme, size)
        expect(await visualIntegrityViolations(page)).toEqual([])
        await page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)').fill('Responder el hilo de correos')
        await page.getByTestId('task-more').click()
        await page.waitForFunction(() => document.getAnimations().length === 0)
        expect(await visualIntegrityViolations(page)).toEqual([])
      })
    })
  }
}

// The owner's report (Sunday 25 Oct, es-CO): "Trotar", filed under Trabajo (no Trabajo block on Sundays) and due that
// day, was put on Monday 8:00 with "Cae después de su fecha límite" and no way out. The browser runs in UTC and the
// planner in Bogotá, so every "today" below has to come from the planner's zone.
// 9:57 a.m.: the next five-minute step is 10:00, with room for the clock to run during the test.
const SUNDAY_MORNING_BOGOTA = new Date('2026-10-25T14:57:00.000Z')
const sundayPlanner = (tasks: unknown[]) => ({
  ...plannerDocument(),
  workspaceId: 'workspace-today',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: true, theme: 'system' },
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 480, end: 1020 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
  ],
  tasks,
})
const trotar = (dueDate: string) => ({ id: 'jog', title: 'Trotar', categoryId: 'c-work', durationMin: 60, dueDate, priority: 2, createdAt: '2026-10-25T14:00:00.000Z' })

async function openOnSunday(page: Page, theme: (typeof THEMES)[number], size: keyof typeof SIZES, tasks: unknown[], tab = 'tasks'): Promise<void> {
  await page.setViewportSize(SIZES[size])
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: SUNDAY_MORNING_BOGOTA })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(sundayPlanner(tasks)))
  await page.goto(`./#/${tab}`)
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function expectTapTargets(buttons: ReturnType<Page['locator']>): Promise<void> {
  for (const button of await buttons.all()) {
    const box = (await button.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
}

for (const theme of THEMES) {
  for (const size of ['phone', 'desktop'] as const) {
    test.describe(`a task can be done today (${size}, ${theme})`, () => {
      test.beforeEach(onlyProject(size))

      test("the owner's Sunday jog goes in today's free time, says why, and Hoy and Semana agree", async ({ page }) => {
        await openOnSunday(page, theme, size, [trotar('2026-10-25')])
        await expect(page.getByTestId('task-warnings')).toHaveCount(0)
        const row = page.getByTestId('placed-task').filter({ hasText: 'Trotar' })
        await expect(row).toContainText(/10:00\s*a\.\s*m\.\s*\u2060?[–-]\u2060?\s*11:00\s*a\.\s*m\./)
        await expect(row.getByTestId('outside-note')).toHaveText('Hoy no tienes bloque de Trabajo; la puse en tu tiempo libre.')
        expect(await visualIntegrityViolations(page)).toEqual([])

        await page.goto('./#/today')
        await expect(page.getByTestId('timeline-item').filter({ hasText: 'Trotar' })).toContainText(/10:00\s*a\.\s*m\./)
        await page.goto('./#/week')
        await expect(page.locator('[data-date="2026-10-25"] [data-task-id="jog"]').first()).toHaveAttribute('data-start-minute', '600')
      })

      test('"Hoy" in the quick add puts a new task today, and the last category is only a suggestion', async ({ page }) => {
        await page.addInitScript(() => window.localStorage.setItem('next168-last-task-category', 'c-work'))
        await openOnSunday(page, theme, size, [])
        const field = page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)')
        // An hour, so the week places it (a task with no length is a to-do).
        await field.fill('Trotar 1 h')
        const details = page.getByTestId('task-details')
        const suggestion = details.getByRole('button', { name: 'Durante Trabajo' })
        await expect(suggestion).toHaveAttribute('aria-pressed', 'false')
        const today = details.getByRole('button', { name: 'Hoy', exact: true })
        await expect(today).toHaveAttribute('aria-pressed', 'false')
        await expectTapTargets(details.getByTestId('task-today').or(details.getByTestId('task-suggested-category')))
        await today.click()
        await expect(today).toHaveAttribute('aria-pressed', 'true')
        expect(await visualIntegrityViolations(page)).toEqual([])
        await field.press('Enter')
        await expect(field).toHaveValue('')
        await expect.poll(async () => (await storedPlanner<{ tasks: { title: string }[] }>(page)).tasks).toHaveLength(1)
        const [task] = (await storedPlanner<{ tasks: { title: string; categoryId?: string; dueDate?: string }[] }>(page)).tasks
        expect(task).toMatchObject({ title: 'Trotar', dueDate: '2026-10-25' })
        expect(task).not.toHaveProperty('categoryId')
        await expect(page.getByTestId('placed-task').filter({ hasText: 'Trotar' })).toContainText(/10:00\s*a\.\s*m\.\s*\u2060?[–-]\u2060?\s*11:00\s*a\.\s*m\./)
        await expect(page.getByTestId('task-warnings')).toHaveCount(0)
      })

      test('an overdue task offers one-tap fixes; "Hacerla hoy" puts it today and Deshacer brings the date back', async ({ page }) => {
        await openOnSunday(page, theme, size, [trotar('2026-10-24')])
        const card = page.getByTestId('warning-jog')
        await expect(card.getByTestId('late-text')).toHaveText('Cae después de su fecha límite (24 oct).')
        await expect(card.getByRole('button')).toHaveText(['Hacerla hoy', 'Mover al 26 oct', 'Cambiar categoría'])
        await expectTapTargets(card.getByRole('button'))
        expect(await visualIntegrityViolations(page)).toEqual([])
        await card.getByRole('button', { name: 'Hacerla hoy' }).click()
        await expect(page.getByTestId('task-warnings')).toHaveCount(0)
        await expect(page.getByTestId('placed-task').filter({ hasText: 'Trotar' })).toContainText(/10:00\s*a\.\s*m\./)
        await expect.poll(async () => (await storedPlanner<{ tasks: { dueDate?: string }[] }>(page)).tasks[0]!.dueDate).toBe('2026-10-25')
        await page.getByRole('button', { name: 'Deshacer' }).click()
        await expect.poll(async () => (await storedPlanner<{ tasks: { dueDate?: string }[] }>(page)).tasks[0]!.dueDate).toBe('2026-10-24')
        await expect(page.getByTestId('warning-jog')).toBeVisible()
        await page.getByTestId('warning-jog').getByRole('button', { name: 'Cambiar categoría' }).click()
        await expect(page.getByRole('dialog', { name: 'Editar tarea' }).getByLabel('Categoría')).toHaveValue('c-work')
      })
    })
  }
}

// verify7. A 3 h task due Sunday with 1 h 30 min free that day: its Sunday pieces are on time and only Monday's is late
// (Hoy and Semana marked every piece). Its long list of ranges never breaks a line at a dash (Tareas at 390 px wrote
// "11:30 a. m.–" / "11:40 a. m."). "Hoy" tapped at 23:58 and added at 00:03 is due the new day.
const longTask = { id: 'big', title: 'Informe largo', categoryId: 'c-work', durationMin: 180, dueDate: '2026-10-25', priority: 2, createdAt: '2026-10-25T14:00:00.000Z' }
const busySunday = { id: 'e-trip', title: 'Viaje', start: '2026-10-25T15:30:00.000Z', end: '2026-10-26T02:00:00.000Z', allDay: false, attendees: [] }

// The text of each line an element is drawn on, read from the position of every character.
async function drawnLines(element: ReturnType<Page['locator']>): Promise<string[]> {
  return element.evaluate((root) => {
    const lines: string[] = []
    let top: number | undefined
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      for (let index = 0; index < text.length; index++) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rect = range.getClientRects()[0]
        if (rect && rect.width > 0 && (top === undefined || rect.top > top + 2)) {
          lines.push('')
          top = rect.top
        }
        if (!lines.length) lines.push('')
        lines[lines.length - 1] += text[index]
      }
    }
    return lines.map((line) => line.replace(/⁠/g, ''))
  })
}

for (const theme of THEMES) {
  for (const size of ['phone', 'desktop'] as const) {
    test.describe(`verify7 (${size}, ${theme})`, () => {
      test.beforeEach(onlyProject(size))

      test('only the piece after the due date is late, and a range never breaks at its dash', async ({ page }) => {
        await page.setViewportSize(SIZES[size])
        await page.emulateMedia({ colorScheme: theme })
        await page.clock.install({ time: SUNDAY_MORNING_BOGOTA })
        await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
        await seedKey(page, V2_KEY, JSON.stringify({ ...sundayPlanner([longTask]), events: [busySunday] }))
        await page.goto('./#/tasks')
        await page.waitForFunction(() => document.getAnimations().length === 0)

        const subtitle = page.getByTestId('placed-task').filter({ hasText: 'Informe largo' }).locator('.task-text .t-footnote').first()
        await expect(subtitle).toContainText(/10:00\s*a\.\s*m\.\D*10:30\s*a\.\s*m\., 9:00\s*p\.\s*m\.\D*10:00\s*p\.\s*m\., lun 6:00\s*a\.\s*m\.\D*7:30\s*a\.\s*m\./)
        const lines = await drawnLines(subtitle)
        for (const line of lines) {
          expect(line.trimEnd(), lines.join(' | ')).not.toMatch(/–$/)
          expect(line.trimStart(), lines.join(' | ')).not.toMatch(/^–/)
        }
        await expect(page.getByTestId('warning-big').getByTestId('late-text')).toHaveText('Solo hay hueco para 1 h 30 min antes de su fecha límite (25 oct).')

        await page.goto('./#/today')
        const pieces = page.getByTestId('timeline-item').filter({ hasText: 'Informe largo' })
        await expect(pieces).toHaveCount(2)
        await expect(pieces.filter({ hasText: 'Tarde' })).toHaveCount(0)

        await page.goto('./#/week')
        const sunday = page.locator('[data-date="2026-10-25"] [data-task-id="big"]')
        await expect(sunday.first()).toBeAttached()
        await expect(page.locator('[data-date="2026-10-25"] [data-task-id="big"][data-late]')).toHaveCount(0)
        if (size === 'desktop') {
          // The week starts on Monday: Monday 26 is next week, where the one late piece is.
          await page.getByRole('button', { name: 'Semana siguiente' }).click()
          await expect(page.locator('[data-date="2026-10-26"] [data-task-id="big"][data-late]')).toHaveCount(1)
        }
      })

      test('"Hoy" tapped at 23:58 and added at 00:03 is due the new day, and the chip stays on', async ({ page }) => {
        await page.setViewportSize(SIZES[size])
        await page.emulateMedia({ colorScheme: theme })
        await page.clock.install({ time: new Date('2026-10-26T04:58:00.000Z') }) // 23:58 on Sunday in Bogotá
        await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
        await seedKey(page, V2_KEY, JSON.stringify(sundayPlanner([])))
        await page.goto('./#/tasks')
        await page.waitForFunction(() => document.getAnimations().length === 0)
        const field = page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)')
        await field.fill('Trotar')
        const today = page.getByTestId('task-details').getByRole('button', { name: 'Hoy', exact: true })
        await today.click()
        await expect(today).toHaveAttribute('aria-pressed', 'true')
        await page.clock.fastForward('05:00')
        await expect(today).toHaveAttribute('aria-pressed', 'true')
        await field.press('Enter')
        await expect.poll(async () => (await storedPlanner<{ tasks: { dueDate?: string }[] }>(page)).tasks[0]?.dueDate).toBe('2026-10-26')
        await expect(page.getByTestId('task-warnings')).toHaveCount(0)
      })
    })
  }
}
