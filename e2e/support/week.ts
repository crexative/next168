import type { Page } from '@playwright/test'

// "+" in Week opens a menu with Block and Event (in English); `name` is the entry's visible text.
export async function addFromMenu(page: Page, name: string): Promise<void> {
  await page.getByTestId('week-add').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
