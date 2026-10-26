import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { onlyProject, V2_KEY } from './fixtures'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { storedRecord } from './support/indexedDb'

// The capture box, end to end (tasks design rev 2.1 §7.5, rev 6 P1-9, P1-10 and P1-14). Unit specs cover the grammar
// and the preview's logic; these check what only a browser shows: a reload after chip removal, a rich-text paste, and
// the preview with 20 long rows at 320 px and 200 % text, light and dark.

// Sun 2026-10-25 08:00 in Bogotá (rev 2.1 §7.5).
const SUNDAY = new Date('2026-10-25T13:00:00.000Z')

function planner(theme: 'light' | 'dark') {
  return {
    schemaVersion: 2, workspaceId: 'ws-capture', revision: 1, updatedAt: '2026-10-24T12:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: true, theme },
    categories: [], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
  }
}

async function open(page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.clock.install({ time: SUNDAY })
  await page.addInitScript(([key, raw]) => {
    if (sessionStorage.getItem('capture-seeded')) return
    localStorage.setItem(key!, raw!)
    localStorage.setItem('next168-language', 'es')
    sessionStorage.setItem('capture-seeded', '1')
  }, [V2_KEY, JSON.stringify(planner(theme))])
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.goto('./#/tasks')
  await expect(page.getByTestId('capture-field')).toBeVisible()
}

const field = (page: Page) => page.getByTestId('capture-field')
const chip = (page: Page, kind: string) => page.locator(`[data-testid=capture-chip][data-field=${kind}]`)
type StoredTask = { title: string; dueDate?: string; at?: number }
const storedTasks = async (page: Page) => (JSON.parse(String(await storedRecord(page, 'document'))) as { tasks: StoredTask[] }).tasks

test.describe('chips survive a reload exactly as left (rev 2.1 §7.5)', () => {
  test.beforeEach(onlyProject('phone'))

  test('(a) both chips removed: the whole text is the title, with no date and no time', async ({ page }) => {
    await open(page)
    await field(page).fill('dentista mañana 9am')
    await chip(page, 'date').getByTestId('capture-chip-remove').click()
    await chip(page, 'time').getByTestId('capture-chip-remove').click()
    await field(page).press('End')
    await page.keyboard.type(' ya')
    // (c) A removed chip does not come back while typing on.
    await expect(page.getByTestId('capture-chip')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(field(page)).toHaveValue('')
    await page.reload()
    await expect(page.getByTestId('undated-task').filter({ hasText: 'Dentista mañana 9am ya' })).toBeVisible()
    const [task] = await storedTasks(page)
    expect(task).toMatchObject({ title: 'Dentista mañana 9am ya' })
    expect(task).not.toHaveProperty('dueDate')
    expect(task).not.toHaveProperty('at')
  })

  test('(b) only the date chip removed: the time alone means today, while 9:00 is still ahead', async ({ page }) => {
    await open(page)
    await field(page).fill('dentista mañana 9am')
    await chip(page, 'date').getByTestId('capture-chip-remove').click()
    await page.keyboard.type(' ')
    await expect(chip(page, 'date')).toHaveCount(0)
    await expect(chip(page, 'time')).toContainText('Hoy')
    await field(page).press('Enter')
    await expect(field(page)).toHaveValue('')
    await page.reload()
    await expect(page.getByTestId('placed-task').filter({ hasText: 'Dentista mañana' })).toBeVisible()
    expect(await storedTasks(page)).toMatchObject([{ title: 'Dentista mañana', dueDate: '2026-10-25', at: 540 }])
  })
})

test.describe('a rich-text paste', () => {
  test.beforeEach(onlyProject('desktop'))

  test('lands as plain text, one row per line', async ({ page }) => {
    await open(page)
    await field(page).focus()
    await field(page).evaluate((element) => {
      const data = new DataTransfer()
      data.setData('text/html', '<ul><li><b>Comprar</b> pan</li><li><a href="https://example.invalid">Pagar</a> luz</li></ul>')
      data.setData('text/plain', 'Comprar pan\nPagar luz')
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      // A textarea inserts text/plain; script-made paste events are not acted on, so the default is applied the same way.
      if (!event.defaultPrevented) document.execCommand('insertText', false, data.getData('text/plain'))
    })
    await expect(field(page)).toHaveValue('Comprar pan\nPagar luz')
    await expect(page.getByTestId('capture-row-title')).toHaveCount(2)
    await expect(page.locator('[data-testid=capture-preview] a, [data-testid=capture-preview] b')).toHaveCount(0)
  })
})

// P1-14: the preview at its hardest: 20 rows of 120 characters, 320 px wide, text at 200 %, light and dark.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`the capture preview's accessibility (${theme})`, () => {
    test.beforeEach(onlyProject('phone'))
    test.use({ viewport: { width: 320, height: 720 } })

    test('names, states, keyboard editing, both buttons reached and operated, announcements, nothing clipped', async ({ page }) => {
      await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
      await open(page, theme)
      const lines = Array.from({ length: 20 }, (_, index) => `${String(index + 1).padStart(2, '0')} ${'Revisar el informe del equipo y enviar los comentarios '.repeat(3)}`.slice(0, 120).trimEnd())
      await field(page).focus()
      await page.keyboard.insertText(lines.join('\n'))
      const rows = page.getByTestId('capture-row')
      await expect(rows).toHaveCount(20)
      await expect(page.getByTestId('live-announcer')).toHaveText('20 líneas: puedes añadirlas como tareas.')

      // Each row has its own name and announced state.
      const third = page.getByRole('checkbox', { name: `Tarea 3: ${lines[2]}` })
      await expect(third).toBeChecked()
      await expect(page.getByRole('textbox', { name: 'Título de la tarea 3', exact: true })).toHaveValue(lines[2]!)

      // Keyboard only: edit a title (Enter stays in the row), uncheck a row, then reach and press «Añadir como 19 tareas».
      await page.getByRole('textbox', { name: 'Título de la tarea 1', exact: true }).focus()
      await page.keyboard.press('End')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('capture-row')).toHaveCount(20)
      await page.keyboard.press('Tab')
      await expect(page.getByRole('checkbox', { name: /^Tarea 2:/ })).toBeFocused()
      await page.keyboard.press('Space')
      await expect(page.getByRole('checkbox', { name: /^Tarea 2:/ })).not.toBeChecked()
      await expect(page.getByTestId('live-announcer')).toHaveText('19 seleccionadas')

      expect(await visualIntegrityViolations(page)).toEqual([])
      const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid=capture-preview]').analyze()
      expect(axe.violations.map((violation) => violation.id)).toEqual([])

      const addAll = page.getByRole('button', { name: 'Añadir como 19 tareas' })
      for (let step = 0; step < 60 && !(await addAll.evaluate((element) => element === document.activeElement)); step++) await page.keyboard.press('Tab')
      await expect(addAll).toBeFocused()
      // «Dejar como una tarea» is reachable too, and says why it cannot take 20 long lines.
      await expect(page.getByRole('button', { name: 'Dejar como una tarea' })).toBeDisabled()
      await expect(page.getByTestId('capture-keep-one-too-long')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(field(page)).toHaveValue('')
      await expect(page.getByTestId('live-announcer')).toHaveText('Añadidas 19 tareas')
      const stored = await storedTasks(page)
      expect(stored).toHaveLength(19)
      expect(stored[0]!.title).toBe(lines[0]!.slice(0, -1))
      expect(stored.map((task) => task.title)).not.toContain(lines[1])
    })

    test('«Dejar como una tarea» and «Descartar» are reached and operated by keyboard', async ({ page }) => {
      await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
      await open(page, theme)
      await field(page).focus()
      await page.keyboard.insertText('Comprar pan\nLeche')
      const keepOne = page.getByRole('button', { name: 'Dejar como una tarea' })
      await keepOne.focus()
      await page.keyboard.press('Enter')
      await expect(field(page)).toHaveValue('Comprar pan; Leche')
      await expect(field(page)).toBeFocused()
      await page.keyboard.insertText('\nOtra')
      const discard = page.getByRole('button', { name: 'Descartar' })
      await discard.focus()
      await page.keyboard.press('Enter')
      await expect(field(page)).toHaveValue('')
      expect(await storedTasks(page)).toEqual([])
      expect(await visualIntegrityViolations(page)).toEqual([])
    })
  })
}
