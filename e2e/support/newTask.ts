import { expect, type Locator, type Page } from '@playwright/test'

// Nueva tarea (R_HojaTarea): the "+" on Tareas opens it directly; on the other tabs "+" opens the menu and Tarea opens
// it. The capture is its title field; "Añadir" is in its header. Adding closes the sheet.
export async function openNewTask(page: Page): Promise<{ sheet: Locator; field: Locator; add: Locator }> {
  const plus = page.getByTestId('add-entry')
  await plus.click()
  if (await plus.getAttribute('aria-haspopup') === 'menu') await page.getByTestId('add-task').click()
  const sheet = page.getByRole('dialog').filter({ has: page.getByTestId('capture-field') })
  const field = sheet.getByTestId('capture-field')
  await expect(field).toBeVisible()
  return { sheet, field, add: sheet.getByTestId('task-add') }
}

// "Durante": a row that opens its choices in place (radios whose names wrap at any text size).
export const whenChoices = (sheet: Locator) => sheet.getByTestId('task-when').locator('label')
export const whenChecked = (sheet: Locator) => sheet.getByTestId('task-when').locator('input[type=radio]:checked')

export async function pickWhen(sheet: Locator, name: string): Promise<void> {
  await sheet.getByTestId('task-when-toggle').click()
  await whenChoices(sheet).filter({ hasText: name }).click()
  await expect(sheet.getByTestId('task-when-value')).toHaveText(name)
}
