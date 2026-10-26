import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, onlyProject } from './fixtures'
import { installTapCounter, tapActions, tapCount } from './support/tapCounter'

// Tap-budget guard (P0 spec §5): each flow starts on Tasks with no sheet open and nothing focused, counts trusted
// actions only (support/tapCounter.ts), and asserts its outcome through the UI after a reload. The budgets were
// recorded by running this spec on 239b9bc, before any P0 change.
// TAP_BUDGET_MUTATION=extra-tap adds one extra tap to "Add a task", to show the gate fails and prints the counts.

const LOCALES = ['es', 'en', 'pt', 'de', 'fr'] as const
type Locale = (typeof LOCALES)[number]
const NOW = new Date('2026-10-26T13:02:00.000Z') // Mon 08:02 in Bogotá
const PLANNER = JSON.parse(readFileSync(new URL('./fixtures/tapBudgetPlanner.json', import.meta.url), 'utf8')) as { settings: Record<string, unknown> }
const EXTRA_TAP = process.env.TAP_BUDGET_MUTATION === 'extra-tap'

const catalog = (locale: Locale, file: string) => JSON.parse(readFileSync(new URL(`../src/i18n/${locale}/${file}.json`, import.meta.url), 'utf8'))
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key]!)
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The app keeps words together with no-break spaces and word joiners; the assertions read plain text.
const loose = (text: string) => new RegExp(escape(text).replace(/ /g, '[\\s\\u00a0]').replace(/'/g, "['’]"))

function strings(locale: Locale) {
  const tasks = catalog(locale, 'tasks')
  const common = catalog(locale, 'common')
  const due = (date: string) => fill(tasks.due, { date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)) })
  return {
    today: tasks.today as string,
    recentDone: tasks.recentDone as string,
    complete: (title: string) => fill(tasks.complete, { title }),
    undo: common.undo as string,
    thirtyMinutes: fill(common.duration.minutes, { minutes: '30' }),
    due,
  }
}

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, timezoneId: 'America/Bogota' })
test.beforeEach(onlyProject('phone'))

async function openTasks(page: Page, locale: Locale): Promise<void> {
  await page.clock.install({ time: NOW })
  await installTapCounter(page)
  const planner = JSON.stringify({ ...PLANNER, settings: { ...PLANNER.settings, locale } })
  await page.addInitScript(([key, raw, language]) => {
    if (sessionStorage.getItem('tap-budget-seeded')) return
    localStorage.setItem(key!, raw!)
    localStorage.setItem('next168-language', language!)
    sessionStorage.setItem('tap-budget-seeded', '1')
  }, [V2_KEY, planner, locale])
  await page.goto('./#/tasks')
  await settled(page)
  // Start state: the list is drawn, no sheet is open, nothing is focused and nothing was counted.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  expect(await tapCount(page)).toBe(0)
}

async function settled(page: Page): Promise<void> {
  await expect(page.getByTestId('placed-task').first()).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await settled(page)
}

const titleField = (page: Page) => page.locator('form.add input[type=text]')
// A tapped chip takes the focus, so Enter would press the chip again: these flows end on the form's own button.
const submitButton = (page: Page) => page.locator('form.add button[type=submit]')
const row = (page: Page, title: string) => page.getByTestId('placed-task').filter({ hasText: title })
const group = (page: Page, header: string) => page.locator('section.list-group').filter({ has: page.locator('h2', { hasText: new RegExp(`^${escape(header)}`) }) })

async function expectBudget(page: Page, budget: number): Promise<void> {
  const observed = await tapCount(page)
  expect(observed, `observed ${observed} actions, budget ${budget}: ${JSON.stringify(await tapActions(page))}`).toBe(budget)
}

// Counted: tap the field, Enter. Typing is not an action.
async function addTask(page: Page, title: string): Promise<void> {
  await titleField(page).tap()
  await page.keyboard.type(title)
  if (EXTRA_TAP) await titleField(page).tap()
  await page.keyboard.press('Enter')
  await expect(titleField(page)).toHaveValue('')
}

for (const locale of LOCALES) {
  test.describe(`tap budget (${locale})`, () => {
    const text = strings(locale)

    test('add a task: 2 actions, and it is on the first screen', async ({ page }) => {
      await openTasks(page, locale)
      await addTask(page, 'Comprar pan')
      await expectBudget(page, 2)
      await reload(page)
      await expect(row(page, 'Comprar pan')).toBeInViewport()
    })

    test('add a task for today with «Hoy»: 3 actions', async ({ page }) => {
      await openTasks(page, locale)
      await titleField(page).tap()
      await page.keyboard.type('Comprar pan')
      await page.getByTestId('task-today').tap()
      await submitButton(page).tap()
      await expect(titleField(page)).toHaveValue('')
      await expectBudget(page, 3)
      await reload(page)
      await expect(group(page, text.today).getByTestId('placed-task').filter({ hasText: 'Comprar pan' })).toBeVisible()
    })

    test('add a task with «30 min»: 3 actions', async ({ page }) => {
      await openTasks(page, locale)
      await titleField(page).tap()
      await page.keyboard.type('Comprar pan')
      await page.getByTestId('task-details').getByRole('radio', { name: text.thirtyMinutes, exact: true }).tap()
      await submitButton(page).tap()
      await expect(titleField(page)).toHaveValue('')
      await expectBudget(page, 3)
      await reload(page)
      await expect(row(page, 'Comprar pan')).toContainText(loose(text.thirtyMinutes))
    })

    test('add a task with a due date through «Más opciones»: 4 actions', async ({ page }) => {
      await openTasks(page, locale)
      await titleField(page).tap()
      await page.keyboard.type('Comprar pan')
      await page.getByTestId('task-more').tap()
      await page.getByTestId('task-due').tap()
      await page.getByTestId('task-due').fill('2026-10-30')
      await page.keyboard.press('Enter')
      await expect(titleField(page)).toHaveValue('')
      await expectBudget(page, 4)
      await reload(page)
      await expect(row(page, 'Comprar pan')).toContainText(loose(text.due('2026-10-30')))
    })

    test('complete a visible task: 1 action', async ({ page }) => {
      await openTasks(page, locale)
      await row(page, 'Llamar al banco').getByRole('button', { name: text.complete('Llamar al banco') }).tap()
      await expect(page.getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeVisible()
      await expectBudget(page, 1)
      await reload(page)
      await expect(group(page, text.recentDone).getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeVisible()
      await expect(row(page, 'Llamar al banco')).toHaveCount(0)
    })

    test('undo a completion: 1 action', async ({ page }) => {
      await openTasks(page, locale)
      await row(page, 'Llamar al banco').getByRole('button', { name: text.complete('Llamar al banco') }).tap()
      await expect(page.getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeVisible()
      const before = await tapCount(page)
      await page.getByRole('button', { name: text.undo, exact: true }).tap()
      expect(await tapCount(page) - before, 'Undo').toBe(1)
      await expect(row(page, 'Llamar al banco')).toBeVisible()
      await expect(page.getByTestId('done-task')).toHaveCount(0)
      await reload(page)
      await expect(row(page, 'Llamar al banco')).toBeVisible()
      await expect(page.getByTestId('done-task')).toHaveCount(0)
    })

    test('add, then complete, the task just added: 3 actions', async ({ page }) => {
      await openTasks(page, locale)
      await addTask(page, 'Comprar pan')
      await row(page, 'Comprar pan').getByRole('button', { name: text.complete('Comprar pan') }).tap()
      await expect(page.getByTestId('done-task').filter({ hasText: 'Comprar pan' })).toBeVisible()
      await expectBudget(page, 3)
      await reload(page)
      await expect(group(page, text.recentDone).getByTestId('done-task').filter({ hasText: 'Comprar pan' })).toBeVisible()
    })

    test('use a warning\'s fix «Hacerla hoy»: 1 action', async ({ page }) => {
      await openTasks(page, locale)
      await page.getByTestId('warning-t-bill').getByTestId('fix-today').tap()
      await expect(page.getByTestId('warning-t-bill')).toHaveCount(0)
      await expectBudget(page, 1)
      await reload(page)
      await expect(page.getByTestId('warning-t-bill')).toHaveCount(0)
      await expect(group(page, text.today).getByTestId('placed-task').filter({ hasText: 'Pagar la luz' })).toBeVisible()
    })
  })
}
