import { expect, test, type Page } from '@playwright/test'
import { seedKey, V2_KEY } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { onboardedDocument } from './support/seed'
import { visualIntegrityViolations } from './support/visualIntegrity'

// Slice E: onboarding, tasks, settings, assistant entry and proposals, in Spanish (es-CO) at a phone and a desktop
// size, light and dark. Geometry, behaviour and accessibility assertions, one per plan item.
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test: 390x844 and 1440x900') })

const SIZES = [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const
const THEMES = ['light', 'dark'] as const
const NOW = new Date('2026-10-21T10:15:00.000Z')

const categories = [
  { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
  { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
  { id: 'c-study', name: 'Estudio', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
]
const planned = () => onboardedDocument({
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: true, theme: 'system' },
  categories,
  blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 540, end: 1020 }],
  tasks: [{ id: 't-1', title: 'Escribir informe', categoryId: 'c-work', durationMin: 90, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
})
const firstRun = () => onboardedDocument({ workspaceId: 'ws-first-run', settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: false, theme: 'system' } })

async function start(page: Page, size: (typeof SIZES)[number], theme: (typeof THEMES)[number], document: unknown): Promise<void> {
  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: NOW })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(document))
}

async function calm(page: Page): Promise<void> {
  // Sheets move with scripted springs, not CSS animations: wait for the panel to rest as well.
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')
    const springing = panel !== null && !/^(|none|translateY\(0px\))$/.test(panel.style.transform)
    return !springing && document.getAnimations().every((animation) => animation.playState !== 'running')
  })
}

async function boxes(page: Page, selector: string): Promise<{ width: number; height: number }[]> {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }))
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    const label = `${size.width}x${size.height} ${theme}`

    test(`onboarding: promise, counter, preselected, chips, one exit, confirmation (${label})`, async ({ page }) => {
      await start(page, size, theme, firstRun())
      await page.goto('./')
      const dialog = page.getByRole('dialog', { name: 'Tu semana tiene 168 horas. Decide a qué van.' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Sin cuenta. Todo se queda en este dispositivo.')).toBeVisible()
      await calm(page)

      // Sueño and Trabajo come ticked; the counter adds their typical week.
      await expect(dialog.getByRole('checkbox', { name: 'Usar Sueño' })).toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: 'Usar Trabajo' })).toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: 'Usar Ejercicio' })).not.toBeChecked()
      await expect(dialog.getByTestId('week-counter')).toContainText('96 de 168 h planificadas')
      await dialog.getByRole('checkbox', { name: 'Usar Ejercicio' }).check({ force: true })
      await expect(dialog.getByTestId('week-counter')).toContainText('99 de 168 h planificadas')
      await dialog.getByRole('checkbox', { name: 'Usar Ejercicio' }).uncheck({ force: true })

      // Unticked rows look and act disabled; every target is at least 44 px.
      const off = dialog.locator('[data-template=familia], [data-template=family]').first()
      await expect(off.locator('.edit-button')).toBeDisabled()
      expect(await off.evaluate((element) => Number(getComputedStyle(element.querySelector('.chip-text')!).opacity))).toBeLessThan(1)
      for (const box of await boxes(page, '.onboarding .chip, .onboarding .edit-button')) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      // Colour dots sit beside the names, not instead of them.
      await expect(dialog.locator('[data-template=work] .color-dot')).toBeVisible()
      expect(await visualIntegrityViolations(page)).toEqual([])

      // Rename and recolour through Edit.
      await dialog.getByRole('button', { name: 'Editar Trabajo' }).click()
      await dialog.locator('input.name').fill('Empleo')
      await dialog.getByRole('radio', { name: 'Rojo' }).check({ force: true })
      expect(await visualIntegrityViolations(page)).toEqual([])
      await expect(dialog.getByRole('checkbox', { name: 'Usar Empleo' })).toBeChecked()

      // "Siguiente" needs a category.
      await dialog.getByRole('checkbox', { name: 'Usar Sueño' }).uncheck({ force: true })
      await dialog.getByRole('checkbox', { name: 'Usar Empleo' }).uncheck({ force: true })
      await expect(dialog.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
      await dialog.getByRole('checkbox', { name: 'Usar Sueño' }).check({ force: true })
      await dialog.getByRole('checkbox', { name: 'Usar Empleo' }).check({ force: true })
      await expect(dialog.getByRole('button', { name: 'Ahora no' })).toHaveCount(1)
      await dialog.getByRole('button', { name: 'Siguiente' }).click()

      // Step 2: goal chips are editable (the sheet's title changes with the step).
      const step = page.getByTestId('onboarding')
      await expect(step.getByRole('button', { name: 'Cambiar la meta de Empleo' })).toContainText('Máx. 40 h')
      await step.getByRole('button', { name: 'Cambiar la meta de Empleo' }).click()
      await step.locator('[data-template=work] input[type=number]').fill('30')
      await expect(step.getByRole('button', { name: 'Cambiar la meta de Empleo' })).toContainText('Máx. 30 h')
      for (const box of await boxes(page, '.onboarding .goal-chip')) expect(box.height).toBeGreaterThanOrEqual(44)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await step.getByRole('button', { name: 'Siguiente' }).click()

      // Step 3 and the confirmation.
      await step.getByLabel('Tarea', { exact: true }).fill('Llamar al banco')
      await step.getByRole('button', { name: 'Terminar' }).click()
      await expect(page.getByRole('dialog', { name: 'Tu semana está lista' })).toBeVisible()
      await expect(page.getByTestId('onboarding-summary')).toContainText('2 categorías y 2 bloques')
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      const stored = await storedPlanner(page)
      expect(stored.categories.map((category: { name: string; goal: unknown }) => [category.name, category.goal])).toContainEqual(['Empleo', { type: 'max', hoursPerWeek: 30 }])
      expect(stored.tasks[0].title).toBe('Llamar al banco')
      await page.getByTestId('see-week').click()
      await expect(page).toHaveURL(/#\/week$/)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test(`onboarding: one "Ahora no" leaves with an empty planner (${label})`, async ({ page }) => {
      await start(page, size, theme, firstRun())
      await page.goto('./')
      await page.getByRole('button', { name: 'Ahora no' }).click()
      await expect(page.getByTestId('onboarding')).toBeHidden()
      const stored = await storedPlanner(page)
      expect(stored.settings.onboardingDone).toBe(true)
      expect(stored.categories).toEqual([])
    })

    test(`tasks: one field first, details after typing, last category remembered (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/tasks')
      await expect(page.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
      const field = page.getByPlaceholder('Añadir tarea…')
      await expect(field).toBeVisible()
      await expect(page.getByTestId('task-details')).toHaveCount(0)
      expect(await boxes(page, 'form.add input, form.add select, form.add button')).toHaveLength(1)
      expect((await boxes(page, 'form.add input'))[0]!.height).toBeGreaterThanOrEqual(44)
      await field.fill('Leer un capítulo')
      const details = page.getByTestId('task-details')
      await expect(details).toBeVisible()
      await expect(details.getByLabel('Duración')).toBeVisible()
      await expect(details.getByLabel('Categoría')).toHaveValue('c-work')
      await expect(details.getByLabel('Fecha límite (opcional)')).toBeVisible()
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await details.getByLabel('Categoría').selectOption('c-study')
      await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click()
      await expect(field).toHaveValue('')
      await expect(page.getByTestId('task-details')).toHaveCount(0)
      await page.reload()
      await page.getByPlaceholder('Añadir tarea…').fill('Otra más')
      await expect(page.getByTestId('task-details').getByLabel('Categoría')).toHaveValue('c-study')
    })

    test(`settings: Categorías and Datos on top, everything else one level down (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/settings')
      await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
      const headings = page.locator('main h2')
      await expect(headings).toHaveText(['Categorías', 'Datos', 'Borrar todos los datos'])
      await expect(page.getByText('Dónde viven tus datos')).toHaveCount(0)
      await expect(page.getByText('Calendarios', { exact: true })).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])

      await page.getByTestId('advanced-link').click()
      await expect(page).toHaveURL(/#\/settings\/advanced$/)
      const advanced = page.getByTestId('settings-advanced')
      await expect(advanced.getByRole('heading', { name: 'Integraciones y avanzado' })).toBeVisible()
      for (const name of ['Calendarios', 'Conecta tu asistente de IA']) await expect(advanced.getByRole('heading', { name })).toBeVisible()
      await expect(advanced.getByText('Asistente en el dispositivo')).toBeVisible()
      await expect(advanced.getByText('Protección del almacenamiento')).toBeVisible()
      await expect(advanced.getByText('Detalles técnicos')).toBeVisible()
      await expect(advanced.getByTestId('data-workspace')).toHaveText('ws-e2e-onboarded')
      await expect(advanced.getByText(/LLM/)).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      expect((await boxes(page, '[data-testid=back-button]'))[0]!.height).toBeGreaterThanOrEqual(44)
      await advanced.getByTestId('back-button').click()
      await expect(page).toHaveURL(/#\/settings$/)
      await expect(page.getByTestId('settings-advanced')).toHaveCount(0)
    })

    test(`settings: the category editor uses plurals and does not preselect a destination (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/settings')
      await page.getByRole('button', { name: 'Editar Trabajo' }).click()
      await expect(page.getByTestId('category-usage')).toHaveText('Esta categoría tiene 1 bloque y 1 tarea. Para eliminarla, mueve todo a otra categoría.')
      const destination = page.getByLabel('Moverlos a')
      await expect(destination).toHaveValue('')
      await expect(page.getByRole('button', { name: 'Mover y eliminar' })).toBeDisabled()
      await destination.selectOption('c-study')
      await expect(page.getByRole('button', { name: 'Mover y eliminar' })).toBeEnabled()
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
    })

    test(`settings: a weekly backup nudge appears and an export silences it (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.addInitScript(() => window.localStorage.setItem('next168-first-seen', '2026-10-01T00:00:00.000Z'))
      await page.goto('./#/settings')
      const nudge = page.getByTestId('export-nudge')
      await expect(nudge).toContainText('Aún no has exportado una copia de tu semana.')
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      const download = page.waitForEvent('download')
      await nudge.getByRole('button', { name: 'Exportar copia' }).click()
      await download
      await expect(nudge).toHaveCount(0)
    })

    test(`assistant: back control, question box and three suggestions first, status as a footnote (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/tasks')
      await page.goto('./#/assistant')
      await expect(page.getByRole('heading', { level: 1, name: 'Asistente' })).toBeVisible()
      const back = page.getByTestId('back-button')
      await expect(back).toHaveAttribute('href', '#/tasks')
      const question = page.getByRole('textbox', { name: 'Pregunta al asistente' })
      const suggestions = page.getByTestId('suggestions').getByRole('button')
      await expect(suggestions).toHaveCount(3)
      const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y
      expect(await top(back)).toBeLessThan(await top(question))
      expect(await top(question)).toBeLessThan(await top(suggestions.first()))
      expect(await top(suggestions.first())).toBeLessThan(await top(page.getByTestId('assistant-status')))
      expect(await page.getByTestId('assistant-status').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(15)
      await expect(page.getByTestId('assistant-status')).toContainText('Respuestas rápidas: Listo')
      await expect(page.locator('main').getByRole('link', { name: 'Preguntar al asistente' })).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])

      await suggestions.first().click()
      await expect(page.locator('[data-role=assistant]')).toHaveCount(1)
      await expect(page.getByTestId('suggestions')).toHaveCount(0)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await back.click()
      await expect(page).toHaveURL(/#\/tasks$/)
    })
  }
}

test('assistant back control falls back to Hoy when the page was opened directly', async ({ page }) => {
  await start(page, SIZES[0], 'light', planned())
  await page.goto('./#/assistant')
  await expect(page.getByTestId('back-button')).toHaveAttribute('href', '#/today')
  await expect(page.getByTestId('back-button')).toHaveAccessibleName('Volver a Hoy')
})

test('onboarding does not ask the browser to protect storage; the first check-in does', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: number[] = []
    ;(window as unknown as { __persistCalls: number[] }).__persistCalls = calls
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => { calls.push(Date.now()); return true }, persisted: async () => false } })
  })
  await start(page, SIZES[0], 'light', firstRun())
  await page.goto('./')
  await page.getByRole('dialog').getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Siguiente' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Terminar' }).click()
  await expect(page.getByRole('dialog', { name: 'Tu semana está lista' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __persistCalls: number[] }).__persistCalls.length)).toBe(0)
  await page.getByTestId('onboarding').getByRole('button', { name: 'Cerrar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto('./#/checkin')
  // An empty check-in saves nothing, so there must be something in it.
  await page.locator('textarea').fill('Un buen día')
  await page.getByRole('button', { name: /Guardar/ }).first().click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __persistCalls: number[] }).__persistCalls.length)).toBe(1)
})

for (const theme of THEMES) {
  test(`proposals: a capsule pill that keeps the end of the page clear, and a calm review sheet (${theme})`, async ({ page }) => {
    await start(page, SIZES[0], theme, planned())
    await page.goto('./#/settings/advanced')
    const proposal = { contractVersion: '1.0', workspaceId: 'ws-e2e-onboarded', baseRevision: 1, summary: 'Añadir una hora de estudio', ops: [{ op: 'add_block', block: { categoryId: 'c-study', title: 'Estudio', days: [2], start: 1080, end: 1140 } }] }
    await page.locator('#proposal-json').fill(JSON.stringify(proposal))
    await page.getByRole('button', { name: 'Importar propuesta JSON' }).click()
    await expect(page).toHaveURL(/#\/proposals$/)
    const pill = page.getByTestId('proposal-badge')
    await expect(pill).toHaveText('1 propuesta pendiente')
    const shape = await pill.evaluate((element) => ({ radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), height: element.getBoundingClientRect().height }))
    expect(shape.height).toBeGreaterThanOrEqual(44)
    expect(shape.radius).toBeGreaterThanOrEqual(shape.height / 2)

    // On a long page the last row clears the pill when scrolled to the end.
    await page.goto('./#/settings')
    await expect(page.getByTestId('proposal-badge')).toBeVisible()
    await expect(page.locator('main h2').first()).toBeVisible()
    // The shell scrolls a new view to its top once the old one has left: wait for that before going to the end.
    await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
    await calm(page)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await calm(page)
    const clearance = await page.evaluate(() => {
      const pillBox = document.querySelector('[data-testid=proposal-badge]')!.getBoundingClientRect()
      const last = document.querySelector('[data-testid=advanced-link]')!.closest('.list-group')!.getBoundingClientRect()
      return pillBox.top - last.bottom
    })
    expect(clearance).toBeGreaterThanOrEqual(0)

    await page.goto('./#/proposals')
    await expect(page.getByTestId('back-button')).toBeVisible()
    expect(await visualIntegrityViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Añadir una hora de estudio' }).click()
    const sheet = page.getByRole('dialog', { name: 'Revisar propuesta' })
    await expect(sheet.getByTestId('change-after')).toContainText('Estudio')
    await expect(sheet.getByTestId('review-loading')).toHaveCount(0)
    await expect(sheet.locator('.side')).toHaveCount(2)
    await calm(page)
    expect(await visualIntegrityViolations(page)).toEqual([])
  })
}
