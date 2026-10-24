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

      test('Enter adds a task that fits any free slot, never inside work hours', async ({ page }) => {
        await openTasks(page, theme, size)
        const field = page.getByPlaceholder('Añadir tarea…')
        await field.fill('Comprar regalo para mamá')
        await field.press('Enter')
        await expect(field).toHaveValue('')
        await expect.poll(async () => (await storedPlanner<{ tasks: { title: string; categoryId?: string }[] }>(page)).tasks.map((task) => task.title)).toContain('Comprar regalo para mamá')
        const gift = (await storedPlanner<{ tasks: { title: string; categoryId?: string }[] }>(page)).tasks.find((task) => task.title === 'Comprar regalo para mamá')!
        expect(gift).not.toHaveProperty('categoryId')
        // Work (10:00-12:00) holds the report; the gift goes to the first free hour after now, outside work.
        const row = page.getByTestId('placed-task').filter({ hasText: 'Comprar regalo para mamá' })
        await expect(row).toContainText(/12:00\s*p\.\s*m\.\s*[–-]\s*1:00\s*p\.\s*m\./)
        await expect(row).not.toContainText('Trabajo')
      })

      test('"¿Cuándo?" offers any free slot and the categories, never Sueño or Desplazamientos', async ({ page }) => {
        await openTasks(page, theme, size)
        await page.getByPlaceholder('Añadir tarea…').fill('Leer 30 páginas')
        const details = page.getByTestId('task-details')
        await details.getByRole('button', { name: 'Más opciones' }).click()
        await expect(details.getByLabel('¿Cuándo?').locator('option')).toHaveText(['En cualquier hueco libre', 'Durante Trabajo', 'Durante Familia'])
        await expect(details.getByLabel('¿Cuándo?')).toHaveValue('')
        await details.getByRole('radio', { name: '30 min' }).click()
        await details.getByLabel('¿Cuándo?').selectOption('c-family')
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
        await page.getByPlaceholder('Añadir tarea…').fill('Responder el hilo de correos')
        await page.getByTestId('task-more').click()
        await page.waitForFunction(() => document.getAnimations().length === 0)
        expect(await visualIntegrityViolations(page)).toEqual([])
      })
    })
  }
}
