import { expect, test, type Page } from '@playwright/test'
import { seedKey, V2_KEY } from './fixtures'
import { storedPlanner } from './support/indexedDb'
import { onboardedDocument } from './support/seed'
import { visualIntegrityViolations } from './support/visualIntegrity'

// First-run setup in Spanish (es-CO) at a phone and a desktop size, light and dark: one editable list,
// the Semana editor on a tap, one number, one primary button, a draft that survives a reload.
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test: 390x844 and 1440x900') })

const SIZES = [{ width: 390, height: 844 }, { width: 1440, height: 900 }] as const
const THEMES = ['light', 'dark'] as const
const NOW = new Date('2026-10-21T10:15:00.000Z')
const firstRun = () => onboardedDocument({ workspaceId: 'ws-first-run', settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: false, theme: 'system' } })

async function start(page: Page, size: (typeof SIZES)[number], theme: (typeof THEMES)[number]): Promise<void> {
  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: NOW })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(firstRun()))
}

async function calm(page: Page): Promise<void> {
  // Sheets move with scripted springs, not CSS animations: wait for the topmost panel to rest as well.
  await page.waitForFunction(() => {
    const panels = document.querySelectorAll<HTMLElement>('[role="dialog"]')
    const panel = panels[panels.length - 1] ?? null
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

const counter = (page: Page) => page.getByTestId('week-counter')

for (const size of SIZES) {
  for (const theme of THEMES) {
    const label = `${size.width}x${size.height} ${theme}`

    test(`onboarding: one list, the Semana editor on a tap, one number and one primary button (${label})`, async ({ page }) => {
      await start(page, size, theme)
      await page.goto('./')
      const dialog = page.getByRole('dialog', { name: 'Tu semana tipo' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText('Sin cuenta. Todo se queda en este dispositivo.')).toBeVisible()
      await calm(page)

      // ON6: "Siguiente" is the only button; leaving is the sheet's ✕. ON2: no colour picker, no pencil.
      await expect(dialog.locator('.actions button')).toHaveText(['Siguiente'])
      await expect(dialog.getByRole('button', { name: 'Ahora no' })).toHaveCount(0)
      await expect(dialog.getByRole('radio')).toHaveCount(0)

      // ON3: one number, in whole hours, with the words "asignadas" and "sin asignar".
      await expect(dialog.getByRole('checkbox', { name: 'Usar Sueño' })).toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: 'Usar Trabajo' })).toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: 'Usar Ejercicio' })).not.toBeChecked()
      await expect(counter(page)).toHaveText(/^96 h asignadas · 72 h sin asignar$/)
      await dialog.getByRole('checkbox', { name: 'Usar Ejercicio' }).check()
      await expect(counter(page)).toHaveText(/^99 h asignadas · 69 h sin asignar$/)
      await dialog.getByRole('checkbox', { name: 'Usar Desplazamientos' }).check()
      await expect(counter(page)).toHaveText(/^104 h asignadas · 64 h sin asignar$/)

      // ON2: each routine reads as days and one clock range; the commute goes there and back.
      await expect(dialog.locator('[data-template=work] .routine-line')).toHaveText(/^lun–vie · 9:00\sa\. m\.–5:00\sp\. m\.$/)
      await expect(dialog.locator('[data-template=commute] .routine-line')).toHaveText([/^lun–vie · 7:30–8:00\sa\. m\.$/, /^lun–vie · 5:00–5:30\sp\. m\.$/])
      for (const box of await boxes(page, '.onboarding .routine-head, .onboarding .routine-line')) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      expect(await visualIntegrityViolations(page)).toEqual([])

      // Tapping a routine opens the Semana editor over the sheet; saving changes the line and the number.
      await dialog.getByRole('button', { name: /^Editar Trabajo:/ }).click()
      const editor = page.getByRole('dialog', { name: 'Editar bloque' })
      await expect(editor).toBeVisible()
      await calm(page)
      await editor.getByLabel('Termina').fill('14:00')
      expect(await visualIntegrityViolations(page)).toEqual([])
      await editor.getByRole('button', { name: 'Guardar' }).click()
      await expect(editor).toHaveCount(0)
      await expect(dialog.locator('[data-template=work] .routine-line')).toHaveText(/^lun–vie · 9:00\sa\. m\.–2:00\sp\. m\.$/)
      await expect(counter(page)).toHaveText(/^89 h asignadas · 79 h sin asignar$/)
      // The page behind stays marked as having a sheet open after the editor closes.
      expect(await page.evaluate(() => document.documentElement.dataset.sheetOpen !== undefined)).toBe(true)

      // Step 2: one field, no category choice, "Atrás" next to the primary button (ON5, ON6).
      const step = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Siguiente' }).click()
      await calm(page)
      await expect(step.getByText('Escribe algo que quieras hacer esta semana. Next168 le buscará un hueco libre.')).toBeVisible()
      await expect(step.locator('.actions button')).toHaveText(['Atrás', 'Terminar'])
      await expect(step.locator('select')).toHaveCount(0)
      await step.getByLabel('Tarea', { exact: true }).fill('Llamar al banco')
      expect(await visualIntegrityViolations(page)).toEqual([])
      await step.getByRole('button', { name: 'Terminar' }).click()

      // ON7: plain words at the first win, two clear exits.
      const done = page.getByRole('dialog', { name: 'Listo' })
      await expect(done).toBeVisible()
      await expect(page.getByTestId('onboarding-summary')).toHaveText('Tu semana está guardada solo en este dispositivo.')
      await expect(done.getByRole('button', { name: 'Empezar' })).toBeVisible()
      await calm(page)
      expect(await visualIntegrityViolations(page)).toEqual([])

      const stored = await storedPlanner(page)
      type StoredCategory = { id: string; name: string; goal: { type: string; hoursPerWeek: number } }
      const exercise = stored.categories.find((category: StoredCategory) => category.name === 'Ejercicio') as StoredCategory
      // ON1: the goal Exercise opens with is what its blocks give.
      expect(exercise.goal).toEqual({ type: 'min', hoursPerWeek: 3 })
      expect(stored.blocks.filter((block: { categoryId: string }) => block.categoryId === stored.categories.find((category: StoredCategory) => category.name === 'Desplazamientos').id)).toHaveLength(2)
      expect(stored.blocks.find((block: { title: string }) => block.title === 'Trabajo')).toMatchObject({ start: 540, end: 840 })
      expect(stored.tasks[0].title).toBe('Llamar al banco')
      await done.getByRole('link', { name: 'Ver mi semana' }).click()
      await expect(page).toHaveURL(/#\/week$/)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test(`onboarding: the ✕ leaves with an empty planner (${label})`, async ({ page }) => {
      await start(page, size, theme)
      await page.goto('./')
      await page.getByRole('dialog', { name: 'Tu semana tipo' }).getByRole('button', { name: 'Cerrar' }).click()
      await expect(page.getByTestId('onboarding')).toBeHidden()
      const stored = await storedPlanner(page)
      expect(stored.settings.onboardingDone).toBe(true)
      expect(stored.categories).toEqual([])
    })
  }
}

test('onboarding: a reload brings the unfinished setup back (ON8)', async ({ page }) => {
  await start(page, SIZES[0], 'light')
  await page.goto('./')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: 'Usar Ejercicio' }).check()
  await dialog.getByRole('button', { name: 'Siguiente' }).click()
  await dialog.getByLabel('Tarea', { exact: true }).fill('Llamar al banco')

  await page.reload()
  const again = page.getByRole('dialog', { name: 'Tu primera tarea' })
  await expect(again).toBeVisible()
  await expect(again.getByLabel('Tarea', { exact: true })).toHaveValue('Llamar al banco')
  await again.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByRole('dialog', { name: 'Tu semana tipo' }).getByRole('checkbox', { name: 'Usar Ejercicio' })).toBeChecked()
  await expect(counter(page)).toHaveText(/^99 h asignadas · 69 h sin asignar$/)
})
