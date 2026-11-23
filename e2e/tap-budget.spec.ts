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
  const today = catalog(locale, 'today')
  const capture = catalog(locale, 'capture')
  return {
    today: tasks.today as string,
    undated: tasks.sections.undated as string,
    todayTodo: today.todo.title as string,
    addAll: (count: number) => fill((capture.preview.addAll as string).split(' | ')[1]!, { count: String(count) }),
    recentDone: tasks.recentDone as string,
    complete: (title: string) => fill(tasks.complete, { title }),
    undo: common.undo as string,
    thirtyMinutes: fill(common.duration.minutes, { minutes: '30' }),
    due,
  }
}

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, timezoneId: 'America/Bogota' })
test.beforeEach(onlyProject('phone'))

async function openTasks(page: Page, locale: Locale, tab: 'tasks' | 'today' = 'tasks'): Promise<void> {
  await page.clock.install({ time: NOW })
  await installTapCounter(page)
  const planner = JSON.stringify({ ...PLANNER, settings: { ...PLANNER.settings, locale } })
  await page.addInitScript(([key, raw, language]) => {
    if (sessionStorage.getItem('tap-budget-seeded')) return
    localStorage.setItem(key!, raw!)
    localStorage.setItem('next168-language', language!)
    sessionStorage.setItem('tap-budget-seeded', '1')
  }, [V2_KEY, planner, locale])
  await page.goto(`./#/${tab}`)
  await (tab === 'tasks' ? settled(page) : expect(page.getByTestId('add-entry')).toBeVisible())
  if (tab === 'today') await page.waitForFunction(() => document.getAnimations().length === 0)
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

// Nueva tarea (R_HojaTarea): the "+" on Tareas opens it with its title focused, so the "+" is the field's tap.
const titleField = (page: Page) => page.getByTestId('capture-field')
// A tapped chip takes the focus, so Enter would press the chip again: these flows end on the header's "Añadir".
const submitButton = (page: Page) => page.getByTestId('task-add')
async function openNewTask(page: Page): Promise<void> {
  await page.getByTestId('add-entry').tap()
  await expect(titleField(page)).toBeFocused()
  // Taps land once the sheet has finished sliding in: one landing on the moving sheet would count twice.
  await page.waitForFunction(() => document.getAnimations().length === 0)
}
// Adding closes the sheet.
const added = (page: Page) => expect(page.getByRole('dialog')).toHaveCount(0)
// Any open task's row, in whichever section it is filed.
const row = (page: Page, title: string) => page.locator('[data-testid=placed-task], [data-testid=undated-task], [data-testid=overdue-task], [data-testid=later-task]').filter({ hasText: title })
const group = (page: Page, header: string) => page.locator('section.group').filter({ has: page.locator('h2', { hasText: new RegExp(`^${escape(header)}`) }) })

async function expectBudget(page: Page, budget: number): Promise<void> {
  const observed = await tapCount(page)
  expect(observed, `observed ${observed} actions, budget ${budget}: ${JSON.stringify(await tapActions(page))}`).toBe(budget)
}

// Counted: "+", Enter. Typing is not an action.
async function addTask(page: Page, title: string): Promise<void> {
  await openNewTask(page)
  await page.keyboard.type(title)
  if (EXTRA_TAP) await titleField(page).tap()
  await page.keyboard.press('Enter')
  await added(page)
}

for (const locale of LOCALES) {
  test.describe(`tap budget (${locale})`, () => {
    const text = strings(locale)

    // O-1 (design rev 3 §0.1): a task added with no length is a to-do, filed under «Sin fecha», visible without expanding.
    test('add a task: 2 actions, and it is in «Sin fecha»', async ({ page }) => {
      await openTasks(page, locale)
      await addTask(page, 'Comprar pan')
      await expectBudget(page, 2)
      await reload(page)
      await expect(group(page, text.undated).getByTestId('undated-task').filter({ hasText: 'Comprar pan' })).toBeVisible()
    })

    // P1 (design rev 6 P1-15): a pasted list, one task per line: tap the field, paste, «Añadir como 5 tareas».
    test('add a pasted 5-line list: 2 actions', async ({ page }) => {
      const lines = ['Comprar pan', 'Llamar a mamá', 'Pagar la luz', 'Lavar el carro', 'Leer un capítulo']
      await openTasks(page, locale)
      await openNewTask(page)
      await page.keyboard.insertText(lines.join('\n'))
      // The rows grow to their titles after they appear: tap once the preview has stopped moving.
      await expect(page.getByTestId('capture-row')).toHaveCount(5)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.getByRole('button', { name: text.addAll(5), exact: true }).tap()
      await added(page)
      await expectBudget(page, 2)
      await reload(page)
      for (const line of lines) await expect(group(page, text.undated).getByTestId('undated-task').filter({ hasText: line })).toBeVisible()
    })

    test('add a task for today with «Hoy»: 3 actions', async ({ page }) => {
      await openTasks(page, locale)
      await openNewTask(page)
      await page.keyboard.type('Comprar pan')
      await page.getByTestId('task-today').tap()
      await submitButton(page).tap()
      await added(page)
      await expectBudget(page, 3)
      await reload(page)
      await expect(group(page, text.today).getByTestId('placed-task').filter({ hasText: 'Comprar pan' })).toBeVisible()
    })

    test('add a task with «30 min»: 3 actions', async ({ page }) => {
      await openTasks(page, locale)
      await openNewTask(page)
      await page.keyboard.type('Comprar pan')
      await page.getByRole('dialog').getByRole('radio', { name: text.thirtyMinutes, exact: true }).tap()
      await submitButton(page).tap()
      await added(page)
      await expectBudget(page, 3)
      await reload(page)
      await expect(row(page, 'Comprar pan')).toContainText(loose(text.thirtyMinutes))
    })

    test('add a task with a due date through «Más opciones»: 4 actions', async ({ page }) => {
      await openTasks(page, locale)
      await openNewTask(page)
      await page.keyboard.type('Comprar pan')
      await page.getByTestId('task-more').tap()
      await page.getByTestId('task-due').tap()
      await page.getByTestId('task-due').fill('2026-10-30')
      await page.keyboard.press('Enter')
      await added(page)
      await expectBudget(page, 4)
      await reload(page)
      // Filed under its day (30 Oct): the group says the date, so the row does not repeat it.
      await expect(page.locator('section.group').filter({ has: page.locator('h2', { hasText: /30/ }) }).filter({ hasText: 'Comprar pan' })).toHaveCount(1)
    })

    test('complete a visible task: 1 action', async ({ page }) => {
      await openTasks(page, locale)
      await row(page, 'Llamar al banco').getByRole('button', { name: text.complete('Llamar al banco') }).tap()
      // «Hechas recientemente» starts closed (R_Tareas): the row is there, behind it.
      await expect(page.getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeAttached()
      await expectBudget(page, 1)
      await reload(page)
      await expect(page.getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeAttached()
      await expect(row(page, 'Llamar al banco')).toHaveCount(0)
    })

    test('undo a completion: 1 action', async ({ page }) => {
      await openTasks(page, locale)
      await row(page, 'Llamar al banco').getByRole('button', { name: text.complete('Llamar al banco') }).tap()
      // «Hechas recientemente» starts closed (R_Tareas): the row is there, behind it.
      await expect(page.getByTestId('done-task').filter({ hasText: 'Llamar al banco' })).toBeAttached()
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
      await expect(page.getByTestId('done-task').filter({ hasText: 'Comprar pan' })).toBeAttached()
      await expectBudget(page, 3)
      await reload(page)
      await expect(page.getByTestId('done-task').filter({ hasText: 'Comprar pan' })).toBeAttached()
    })

    // Calm by default (R_Tareas, DIRECTION §3): the warnings are one closed row; its fixes are one tap away, so a fix
    // takes 2 actions (it took 1 with the cards always open).
    test('use a warning\'s fix «Hacerla hoy»: 2 actions', async ({ page }) => {
      await openTasks(page, locale)
      await page.getByTestId('warnings-toggle').tap()
      await page.getByTestId('warning-t-bill').getByTestId('fix-today').tap()
      await expect(page.getByTestId('warning-t-bill')).toHaveCount(0)
      await expectBudget(page, 2)
      await reload(page)
      await expect(page.getByTestId('warning-t-bill')).toHaveCount(0)
      await expect(group(page, text.today).getByTestId('placed-task').filter({ hasText: 'Pagar la luz' })).toBeVisible()
    })
  })
}

// P1 rows of rev 2.1 §1.2 with the L0 grammar (es, en, pt): the date or time is typed, not tapped.
const NL: Record<'es' | 'en' | 'pt', { today: string; appointment: string; todayAdd: string }> = {
  es: { today: 'Comprar pan hoy', appointment: 'dentista mañana 9am', todayAdd: 'Llamar a mamá' },
  en: { today: 'Buy bread today', appointment: 'dentist tomorrow 9am', todayAdd: 'Call mum' },
  pt: { today: 'Comprar pão hoje', appointment: 'dentista amanhã às 9h', todayAdd: 'Ligar para a mãe' },
}
for (const locale of ['es', 'en', 'pt'] as const) {
  test.describe(`tap budget with typed dates (${locale})`, () => {
    const text = strings(locale)
    const phrases = NL[locale]

    test('add a task for today with «… hoy»: 2 actions', async ({ page }) => {
      await openTasks(page, locale)
      await addTask(page, phrases.today)
      await expectBudget(page, 2)
      await reload(page)
      const title = phrases.today.split(' ').slice(0, -1).join(' ')
      await expect(group(page, text.today).getByTestId('placed-task').filter({ hasText: title })).toBeVisible()
    })

    test('add an appointment with «… mañana 9am»: 2 actions', async ({ page }) => {
      await openTasks(page, locale)
      await addTask(page, phrases.appointment)
      await expectBudget(page, 2)
      await reload(page)
      const title = phrases.appointment.split(' ')[0]!
      const appointment = row(page, title.charAt(0).toUpperCase() + title.slice(1))
      await expect(appointment).toBeVisible()
      await expect(appointment).toContainText(/9[:.]00/)
    })

    // The inline «Añadir para hoy» row gave way to the one "+" (redesign principle 4). "+" › Tarea on Hoy starts the task
    // with "Hoy" on and Nueva tarea opens on its title, focused: 3 actions ("+", Tarea, Enter), 2 before.
    test('add from Today with "+" › Tarea: 3 actions', async ({ page }) => {
      await openTasks(page, locale, 'today')
      await page.getByTestId('add-entry').tap()
      // Each tap waits for what it opened to settle, so a press never lands on something still moving (Linux CI).
      await expect(page.getByRole('menu')).toHaveCSS('opacity', '1')
      await page.getByTestId('add-task').tap()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
      await expect(titleField(page)).toBeFocused()
      await page.keyboard.type(phrases.todayAdd)
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('today-todo-task').filter({ hasText: phrases.todayAdd })).toBeVisible()
      await expectBudget(page, 3)
      await page.reload()
      await expect(page.getByTestId('today-todo').getByTestId('today-todo-task').filter({ hasText: phrases.todayAdd })).toBeVisible()
    })
  })
}
