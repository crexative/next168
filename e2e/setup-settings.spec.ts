import { expect, test, type Page } from '@playwright/test'
import { seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'
import { visualIntegrityViolations } from './support/visualIntegrity'

// Slice E: tasks, settings, assistant entry and proposals, in Spanish (es-CO) at a phone and a desktop
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

    test(`tasks: one field first, length chips after typing, the category one level deeper, last choice suggested (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/tasks')
      await expect(page.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
      const field = page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)')
      await expect(field).toBeVisible()
      await expect(page.getByTestId('task-details')).toHaveCount(0)
      expect(await boxes(page, 'form.add textarea, form.add input, form.add select, form.add button')).toHaveLength(1)
      expect((await boxes(page, 'form.add textarea'))[0]!.height).toBeGreaterThanOrEqual(44)
      await field.fill('Leer un capítulo')
      const details = page.getByTestId('task-details')
      await expect(details).toBeVisible()
      await expect(details.getByRole('radiogroup', { name: 'Duración' }).getByRole('radio')).toHaveText(['Sin tiempo', '15 min', '30 min', '1 h', '2 h'])
      await expect(details.getByRole('radio', { name: 'Sin tiempo' })).toHaveAttribute('aria-checked', 'true')
      // The category, the deadline and the priority are one level deeper; by default a task fits any free slot.
      await expect(details.getByLabel('Categoría')).toBeHidden()
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await details.getByRole('button', { name: 'Más opciones' }).click()
      await expect(details.getByLabel('Categoría')).toHaveValue('')
      await expect(details.getByLabel('Categoría').locator('option')).toHaveText(['En cualquier hueco libre', 'Trabajo', 'Estudio'])
      await expect(details.getByLabel('Fecha límite')).toBeVisible()
      await expect(details.getByRole('radiogroup', { name: 'Prioridad' })).toBeVisible()
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await details.getByLabel('Categoría').selectOption('c-study')
      await page.getByRole('button', { name: 'Añadir tarea', exact: true }).click()
      await expect(field).toHaveValue('')
      await expect(page.getByTestId('task-details')).toHaveCount(0)
      await page.reload()
      await page.getByPlaceholder('Añadir tarea… (o pega o dicta varias)').fill('Otra más')
      // The remembered choice is only a one-tap suggestion: a new task still fits any free slot unless it is tapped.
      const suggestion = page.getByTestId('task-details').getByRole('button', { name: 'Durante Estudio' })
      await expect(suggestion).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByTestId('task-details').getByLabel('Categoría')).toBeHidden()
      await suggestion.click()
      await expect(suggestion).toHaveAttribute('aria-pressed', 'true')
      await page.getByTestId('task-details').getByRole('button', { name: 'Más opciones' }).click()
      await expect(page.getByTestId('task-details').getByLabel('Categoría')).toHaveValue('c-study')
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
    })

    test(`settings: Categorías y metas, General, then Calendarios, Tus datos and Avanzado; nothing filled, nothing technical on top (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/settings')
      await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
      await expect(page.locator('main .home h2')).toHaveText(['Categorías y metas', 'General'])
      const general = page.getByTestId('general-settings')
      await expect(general.getByLabel('Idioma')).toBeVisible()
      for (const name of ['La semana empieza el', 'Formato de hora', 'Apariencia']) await expect(general.getByRole('radiogroup', { name })).toBeVisible()
      await expect(general.locator('.list-footer')).not.toContainText('m..')
      await expect(page.getByTestId('settings-more').getByRole('link')).toHaveText([/^Calendarios/, /^Usar con tu IA/, /^Tus datos/, /^Avanzado/])
      await expect(page.getByRole('button', { name: /Borrar todos los datos/ })).toHaveCount(0)
      await expect(page.locator('main')).not.toContainText(/MCP|JSON|WebGPU|instantánea|Espacio de trabajo/)
      await expect(page.locator('main .ui-button.is-filled')).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])

      await page.getByTestId('data-link').click()
      await expect(page).toHaveURL(/#\/settings\/data$/)
      const data = page.getByTestId('settings-data')
      await expect(data.getByRole('heading', { level: 2, name: 'Tus datos' })).toBeVisible()
      await expect(data.locator('.ui-button')).toHaveText(['Exportar copia', 'Importar archivo…', 'Borrar todos los datos…'])
      await expect(page.locator('main .ui-button.is-filled')).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await data.getByTestId('back-button').click()

      await page.getByTestId('calendars-link').click()
      await expect(page).toHaveURL(/#\/settings\/calendars$/)
      await expect(page.getByTestId('settings-calendars').locator('h2')).toHaveText(['Calendarios'])
      await expect(page.locator('main .ui-button.is-filled')).toHaveCount(0)
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])
      await page.getByTestId('back-button').click()

      await page.getByTestId('advanced-link').click()
      await expect(page).toHaveURL(/#\/settings\/advanced$/)
      const advanced = page.getByTestId('settings-advanced')
      await expect(advanced.getByRole('heading', { level: 2, name: 'Avanzado', exact: true })).toBeVisible()
      await expect(advanced.getByText('Asistente en el dispositivo')).toBeVisible()
      await expect(advanced.getByTestId('assistant-status')).toContainText('Respuestas rápidas: Listo')
      await expect(advanced.getByText('Protección del almacenamiento')).toBeVisible()
      const technical = advanced.getByRole('region', { name: 'Detalles técnicos' })
      await expect(technical.getByRole('heading', { name: 'Conecta tu asistente de IA' })).toBeVisible()
      await expect(technical.getByTestId('data-workspace')).toHaveText('ws-e2e-onboarded')
      await expect(technical).toContainText('MCP')
      await expect(advanced.getByText(/LLM/)).toHaveCount(0)
      await expect(page.locator('main .ui-button.is-filled')).toHaveCount(0)
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
      await expect(page.getByTestId('category-usage')).toHaveText('Esta categoría tiene 1 rutina y 1 tarea. Para eliminarla, mueve todo a otra categoría.')
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

    test(`assistant without the model: back control and the three suggestions, no question box, status only in Advanced (${label})`, async ({ page }) => {
      await start(page, size, theme, planned())
      await page.goto('./#/tasks')
      await page.goto('./#/assistant')
      await expect(page.getByRole('heading', { level: 1, name: 'Asistente' })).toBeVisible()
      const back = page.getByTestId('back-button')
      await expect(back).toHaveAttribute('href', '#/tasks')
      const suggestions = page.getByTestId('suggestions').getByRole('button')
      await expect(suggestions).toHaveCount(3)
      await expect(page.getByRole('textbox')).toHaveCount(0)
      const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y
      expect(await top(back)).toBeLessThan(await top(suggestions.first()))
      await expect(page.getByTestId('assistant-status')).toHaveCount(0)
      await expect(page.locator('#main')).not.toContainText('WebGPU')
      // The toolbar's assistant entry is the same on every screen; here it marks the current page.
      const visibleEntry = page.locator('[data-testid=assistant-entry]:visible')
      if (await visibleEntry.count()) await expect(visibleEntry).toHaveAttribute('aria-current', 'page')
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])

      await suggestions.first().click()
      await expect(page.locator('[data-role=assistant]')).toHaveCount(1)
      await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(3)
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
  const setup = page.getByTestId('setup')
  await expect(setup).toHaveAttribute('data-screen', 'sleep')
  // Skip every question, then start: the guided setup's one commit.
  for (let guard = 0; guard < 6 && (await setup.getAttribute('data-screen')) !== 'summary'; guard++) {
    const screen = await setup.getAttribute('data-screen')
    await setup.locator('section.screen:not([aria-hidden=true]) [data-testid=setup-secondary]').click()
    await expect(setup).not.toHaveAttribute('data-screen', screen!)
  }
  await expect(setup).toHaveAttribute('data-screen', 'summary')
  expect(await page.evaluate(() => (window as unknown as { __persistCalls: number[] }).__persistCalls.length)).toBe(0)
  await setup.getByRole('button', { name: 'Crear mi semana' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __persistCalls: number[] }).__persistCalls.length)).toBe(0)

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
    const proposal = { contractVersion: '1.1', workspaceId: 'ws-e2e-onboarded', baseRevision: 1, summary: 'Añadir una hora de estudio', ops: [{ op: 'add_block', block: { categoryId: 'c-study', title: 'Estudio', days: [2], start: 1080, end: 1140 } }] }
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
