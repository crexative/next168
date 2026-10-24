import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { legacyData, seedKey, V2_KEY } from './fixtures'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { addFromMenu } from './support/week'

// Every tab and every sheet, at the three project widths (1440 / 768 / 375 px) and in both themes:
// no control, focus ring or text is clipped, select chevrons sit inside their padding and controls in a
// row neither overlap nor disagree on their edges. Geometry checks only; no screenshot baselines.

// WebGPU off keeps the assistant on the rules provider, whose reply the E2E build can replace.
test.use({ launchOptions: { args: ['--disable-features=WebGPU'] } })

// Wednesday 2026-10-21 10:15 UTC.
const NOW = new Date('2026-10-21T10:15:00.000Z')
const THEMES = ['light', 'dark'] as const
const LANGUAGE_KEY = 'next168-language'
const NARROW_WIDTHS = [320, 375] as const
const EVENT_COPY = {
  en: { button: 'New event', hint: 'Separate email addresses with commas' },
  es: { button: 'Nuevo evento', hint: 'Separa los correos con comas' },
  fr: { button: 'Nouvel événement', hint: 'Séparez les adresses par des virgules' },
  pt: { button: 'Novo evento', hint: 'Separe os endereços por vírgulas' },
  de: { button: 'Neuer Termin', hint: 'E-Mail-Adressen durch Kommas trennen' },
} as const
const LOCALES = Object.keys(EVENT_COPY) as (keyof typeof EVENT_COPY)[]

async function widenInputFonts(page: Page): Promise<void> {
  // Exercise the Linux CI failure on every OS, including systems with narrower default fonts.
  await page.addStyleTag({ content: `
    .onboarding input.name, .onboarding select.color, .event-form input[inputmode="email"] {
      font-family: Verdana, "DejaVu Sans", sans-serif !important;
      font-size: 1.16875rem !important; /* 110% of the shared 17 px input font. */
    }
  ` })
  await page.evaluate(() => document.fonts.ready)
}

const plannedDocument = {
  schemaVersion: 2,
  workspaceId: 'workspace-visual',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
    { id: 'c-study', name: 'Learning and side projects', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 },
    { id: 'b-meet', categoryId: 'c-work', title: 'Team sync', days: [3], start: 690, end: 720 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [1, 3, 5], start: 1080, end: 1140 },
    { id: 'b-study', categoryId: 'c-study', title: 'Evening course', days: [2, 4], start: 1170, end: 1260 },
  ],
  tasks: [
    { id: 't-report', title: 'Write the quarterly report', categoryId: 'c-work', durationMin: 90, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' },
    { id: 't-form', title: 'Hand in form', categoryId: 'c-study', durationMin: 60, dueDate: '2026-10-21', priority: 2, createdAt: '2026-10-20T08:00:00.000Z' },
    { id: 't-run', title: 'Long run', categoryId: 'c-exercise', durationMin: 180, priority: 3, createdAt: '2026-10-20T08:00:00.000Z' },
  ],
  checkIns: [{ date: '2026-10-20', bedtime: 1350, wake: 400, workEnd: 1080, exercise: 'yes', stress: 2, note: 'Good day' }],
  actuals: [],
  events: [{ id: 'e-review', title: 'Design review', start: '2026-10-22T14:00:00.000Z', end: '2026-10-22T15:00:00.000Z', allDay: false, location: 'Room 2', attendees: ['one@example.invalid'] }],
  calendarSources: [],
  appliedProposalIds: [],
}

const firstRunDocument = { ...plannedDocument, workspaceId: 'workspace-first-run', categories: [], blocks: [], tasks: [], checkIns: [], events: [], settings: { ...plannedDocument.settings, onboardingDone: false } }

async function start(page: Page, theme: (typeof THEMES)[number], document: unknown, locale = 'en', at: Date = NOW): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: at })
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [LANGUAGE_KEY, locale])
  await seedKey(page, V2_KEY, typeof document === 'string' ? document : JSON.stringify(document))
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = document.querySelector<HTMLElement>('[role="dialog"] ')
    const springing = panel !== null && !/^(|none|translateY\(0px\))$/.test(panel.style.transform)
    return !springing && document.getAnimations().every((animation) => animation.playState !== 'running')
  })
}

async function open(page: Page, view: string): Promise<void> {
  await page.goto(`./#/${view}`)
  await expect(page.locator('#main')).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await settle(page)
}

async function audit(page: Page, state: string): Promise<void> {
  await settle(page)
  expect.soft(await visualIntegrityViolations(page), state).toEqual([])
}

// A sheet that opens by itself must not light up a focus ring: focus goes to its title (or its first text field).
async function auditSheet(page: Page, state: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await settle(page)
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    const dialogElement = document.querySelector('[role="dialog"]')
    return {
      inside: Boolean(active && dialogElement?.contains(active)),
      calm: Boolean(active && (active.matches('h1, h2, [role="dialog"], input:not([type="checkbox"]):not([type="radio"]), textarea') || !active.matches(':focus-visible'))),
      element: active?.outerHTML.slice(0, 80) ?? 'none',
    }
  })
  expect.soft(focused.inside, `${state}: initial focus is inside the sheet`).toBe(true)
  expect.soft(focused.calm, `${state}: the sheet opened with a focus ring on ${focused.element}`).toBe(true)
  await audit(page, state)
}

for (const theme of THEMES) {
  test.describe(`visual integrity (${theme})`, () => {
    for (const locale of LOCALES) {
      for (const width of NARROW_WIDTHS) {
        test(`wider fonts: onboarding names (${locale}, ${width}px)`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
          await page.setViewportSize({ width, height: 812 })
          await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale } }, locale)
          await page.goto('./')
          const onboarding = page.getByTestId('onboarding')
          await expect(onboarding).toBeVisible()
          await widenInputFonts(page)
          await expect(onboarding.locator('input.name')).toHaveCount(7)
          if (locale === 'es') await expect(onboarding.locator('input.name').last()).toHaveValue('Desplazamientos')
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/onboarding step 1`)

          for (const checkbox of await onboarding.getByRole('checkbox').all()) await checkbox.check()
          await expect(onboarding.locator('input.name:disabled, select.color:disabled')).toHaveCount(0)
          await audit(page, `${theme}/${locale}/${width}/wider fonts/onboarding step 1 with picks`)
          const targets = await onboarding.locator('input.name, select.color, .check').evaluateAll((elements) =>
            elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
          )
          for (const target of targets) {
            expect(target.width).toBeGreaterThanOrEqual(44)
            expect(target.height).toBeGreaterThanOrEqual(44)
          }
        })

        test(`wider fonts: new event attendees (${locale}, ${width}px)`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
          await page.setViewportSize({ width, height: 812 })
          await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale } }, locale)
          await open(page, 'settings')
          await page.getByRole('button', { name: EVENT_COPY[locale].button, exact: true }).click()
          const attendees = page.getByRole('dialog').locator('input[inputmode="email"]')
          await expect(attendees).toBeVisible()
          await expect(attendees).toHaveValue('')
          await widenInputFonts(page)
          await attendees.scrollIntoViewIfNeeded()
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new event`)
          await expect(attendees).toHaveAccessibleDescription(EVENT_COPY[locale].hint)
          await expect(page.getByText(EVENT_COPY[locale].hint, { exact: true })).toBeVisible()
        })
      }
    }

    test('every tab', async ({ page }) => {
      await start(page, theme, plannedDocument)
      for (const view of ['today', 'week', 'tasks', 'insights', 'settings', 'assistant', 'checkin']) {
        await open(page, view)
        await audit(page, `${theme}/${view}`)
      }
    })

    test('onboarding steps 1–3 (owner\'s Spanish sheet)', async ({ page }) => {
      await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale: 'es' } }, 'es')
      await page.goto('./')
      await auditSheet(page, `${theme}/onboarding step 1`)
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('checkbox').first().check()
      await dialog.getByRole('checkbox').nth(1).check()
      await audit(page, `${theme}/onboarding step 1 with picks`)
      await dialog.getByRole('button', { name: 'Siguiente' }).click()
      await audit(page, `${theme}/onboarding step 2`)
      await dialog.getByRole('button', { name: 'Siguiente' }).click()
      await audit(page, `${theme}/onboarding step 3`)
    })

    test('week block editor and the day sheets', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'week')
      await addFromMenu(page, 'Block')
      await auditSheet(page, `${theme}/new block`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.locator('[data-date="2026-10-21"] [data-block-id="b-gym"]').first().click()
      await auditSheet(page, `${theme}/edit block`)
    })

    test('week in Spanish: tasks, week navigation, the add menu, the event sheet and the phone overview', async ({ page }, testInfo) => {
      await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }, 'es')
      await open(page, 'week')
      await expect(page.getByTestId('week-task').first()).toBeVisible()
      await audit(page, `${theme}/es/week with tasks`)
      await page.getByTestId('week-next').click()
      await audit(page, `${theme}/es/next week`)
      await page.getByTestId('week-today').click()
      await page.getByTestId('week-add').click()
      await expect(page.getByRole('menu')).toBeVisible()
      await audit(page, `${theme}/es/add menu`)
      await page.getByRole('menuitem', { name: 'Evento', exact: true }).click()
      await auditSheet(page, `${theme}/es/new event from +`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      if (testInfo.project.name === 'phone') {
        await page.getByRole('radio', { name: 'Semana', exact: true }).click()
        await expect(page.getByTestId('week-overview')).toBeVisible()
        await audit(page, `${theme}/es/week overview`)
      }
    })

    test('settings sheets, import preview and calendar details', async ({ page }, testInfo) => {
      await start(page, theme, plannedDocument)
      await open(page, 'settings')
      await page.getByRole('button', { name: 'Edit Learning and side projects' }).click()
      await auditSheet(page, `${theme}/edit category`)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Add category' }).click()
      await auditSheet(page, `${theme}/new category`)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'New event', exact: true }).click()
      await auditSheet(page, `${theme}/new event`)
      await page.keyboard.press('Escape')
      await page.getByTestId('planner-event').getByRole('button', { name: 'Edit', exact: true }).click()
      await auditSheet(page, `${theme}/edit event`)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Delete all data…' }).click()
      await auditSheet(page, `${theme}/delete everything`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.getByLabel('Import .ics file', { exact: true }).setInputFiles('src/core/__fixtures__/ics/google.ics')
      await expect(page.getByTestId('calendar-source')).toHaveCount(1)
      await audit(page, `${theme}/calendar details`)

      const v1Path = testInfo.outputPath('v1.json')
      await import('node:fs').then(({ writeFileSync }) => writeFileSync(v1Path, JSON.stringify(legacyData)))
      await page.getByLabel('Choose a Next168 export file').setInputFiles(v1Path)
      await expect(page.getByTestId('import-preview')).toBeVisible()
      await audit(page, `${theme}/import preview`)
    })

    test('proposal review and check-in', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'assistant')
      const gym = { op: 'add_block', block: { categoryId: 'c-exercise', title: 'Gym', days: [4], start: 1080, end: 1140 } }
      await page.evaluate((op) => (window as unknown as { __next168Test: { answerWithProposal(summary: string, ops: unknown[]): void } }).__next168Test.answerWithProposal('Add a gym block on Thursday', [op]), gym)
      await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Add a gym block on Thursday')
      await page.getByRole('button', { name: 'Ask', exact: true }).click()
      await expect(page.getByTestId('proposal-card')).toBeVisible()
      await audit(page, `${theme}/assistant with a proposal`)
      await page.getByTestId('proposal-card').getByRole('button', { name: 'Review changes' }).click()
      await auditSheet(page, `${theme}/proposal review`)
      await page.keyboard.press('Escape')

      await open(page, 'checkin')
      await page.getByLabel('Note').fill('A long evening note that wraps across more than one line to check the text area.')
      await audit(page, `${theme}/check-in filled`)
    })

    test('Today and the nightly check-in (Spanish): Now card chips, rows, free card, evening card, form and saved state', async ({ page }, testInfo) => {
      const spanish = { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }
      // Headless Chromium reports notifications as blocked; the reminder button only exists where they can be asked for.
      await page.addInitScript(() => {
        class AskableNotification { static permission: NotificationPermission = 'default'; static requestPermission = async () => 'granted' as const }
        Object.defineProperty(window, 'Notification', { value: AskableNotification, configurable: true })
      })
      // The Now card asks about the block in progress; the task is listed under "Después".
      await start(page, theme, spanish, 'es', new Date('2026-10-21T10:15:30.000Z'))
      await open(page, 'today')
      await expect(page.getByTestId('now-card').getByRole('group')).toBeVisible()
      await audit(page, `${theme}/today: now card with status chips`)
      await page.getByTestId('now-card').getByRole('button', { name: 'Parcial' }).click()
      await expect(page.getByLabel(/Minutos dedicados/)).toBeVisible()
      await audit(page, `${theme}/today: now card with the minutes field`)

      // Deep work is over: its row asks, the card says "Sin planificar", and an old block is one line.
      await page.clock.setSystemTime(new Date('2026-10-21T12:00:00.000Z'))
      await page.clock.fastForward(31_000)
      await expect(page.getByTestId('now-title')).toHaveText('Sin planificar')
      await expect(page.getByRole('group', { name: '¿Cómo fue Deep work?' })).toBeVisible()
      await audit(page, `${theme}/today: free card and a finished block asking`)
      await page.getByRole('group', { name: '¿Cómo fue Deep work?' }).getByRole('button', { name: 'Hecho' }).click()
      await audit(page, `${theme}/today: finished block answered`)
      await page.getByTestId('task-check').first().click()
      await expect(page.getByRole('button', { name: 'Deshacer' })).toBeVisible()
      await audit(page, `${theme}/today: task done with the undo toast`)

      // Evening: the card with the reminder, the form, and Today again after saving.
      await page.clock.fastForward(9 * 3600_000)
      await expect(page.getByTestId('checkin-card')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Recordarme a las 22:00' })).toBeVisible()
      await audit(page, `${theme}/today: check-in card with the reminder`)
      await page.getByTestId('checkin-card').getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1, name: 'Cierre del día' })).toBeVisible()
      await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
      await audit(page, `${theme}/check-in prefilled from the plan`)
      await page.getByRole('radio', { name: 'Sí' }).click()
      await page.getByRole('radiogroup', { name: /Estrés hoy/ }).getByRole('radio', { name: '2' }).click()
      await audit(page, `${theme}/check-in answered`)
      await page.getByRole('button', { name: 'Guardar cierre' }).click()
      await expect(page.getByTestId('checkin-done')).toContainText('Guardado ✓')
      await audit(page, `${theme}/today: check-in saved`)
      await page.clock.runFor(5000)
      await expect(page.getByTestId('checkin-done')).toContainText('Hecho ✓')
      await audit(page, `${theme}/today: check-in done`)

      if (testInfo.project.name === 'phone') {
        for (const width of NARROW_WIDTHS) {
          await page.setViewportSize({ width, height: 700 })
          await open(page, 'today')
          await audit(page, `${theme}/today at ${width}px: check-in done`)
        }
      }
    })

    test('Today with a plan first seen today and the first-run check-in (Spanish)', async ({ page }) => {
      const fresh = { ...plannedDocument, checkIns: [], tasks: [], settings: { ...plannedDocument.settings, locale: 'es' } }
      await start(page, theme, fresh, 'es', new Date('2026-10-21T23:30:00.000Z'))
      await open(page, 'today')
      await expect(page.getByTestId('checkin-card')).toBeVisible()
      await audit(page, `${theme}/today: plan seen for the first time, sleep in progress`)
      await open(page, 'checkin')
      await audit(page, `${theme}/check-in without a saved entry`)
    })

    test('recovery screen and its confirmation', async ({ page }) => {
      await start(page, theme, '{"schemaVersion":2,')
      await page.goto('./')
      await page.getByRole('button', { name: 'Start with an empty planner' }).click()
      await auditSheet(page, `${theme}/recovery confirmation`)
    })
  })
}

// The overlap rule judges what a user can see: a field a scroll container has scrolled out of sight is not
// under the button that occupies its page coordinates, but a visible collision still is an overlap.
test.describe('visual integrity guard: overlapping controls', () => {
  const stage = (closeTop: number, fields: string) => `
    <style>
      body { margin: 0; font: 16px sans-serif; }
      .stage { position: relative; width: 300px; height: 300px; }
      .close { position: absolute; right: 0; top: ${closeTop}px; width: 44px; height: 44px; }
      .body { position: absolute; top: 44px; left: 0; width: 300px; height: 200px; overflow-y: auto; }
      input { display: block; box-sizing: border-box; width: 300px; height: 44px; margin: 0 0 12px; }
    </style>
    <div class="stage"><button class="close" aria-label="Close">x</button><div class="body">${fields}</div></div>`
  const fiveFields = '<input aria-label="Name">'.repeat(5)

  const phoneOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== 'phone', 'the guard self-test runs once, in the phone project')

  test('a field scrolled above its container does not overlap the button at those coordinates', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(stage(0, fiveFields))
    await page.locator('.body').evaluate((element) => { element.scrollTop = 44 })
    const rects = await page.evaluate(() => ({
      close: document.querySelector('.close')!.getBoundingClientRect(),
      first: document.querySelector('.body input')!.getBoundingClientRect(),
      body: document.querySelector('.body')!.getBoundingClientRect(),
    }))
    expect(rects.first.bottom, 'the first field is entirely above the scroll container').toBeLessThanOrEqual(rects.body.top)
    expect(rects.first.top, 'in the same rows as the close button').toBeLessThan(rects.close.bottom)
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('a button over a field the container shows is reported', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(stage(60, fiveFields))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([
      '<button.close> "Close" overlaps <input> "Name"',
    ])
  })

  test('a field only partly scrolled out still collides through the part that shows', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(stage(30, fiveFields))
    await page.locator('.body').evaluate((element) => { element.scrollTop = 20 })
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([
      '<button.close> "Close" overlaps <input> "Name"',
    ])
  })

  test('two fields that overlap inside the container are reported', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(stage(0, '<input aria-label="Name"><input aria-label="Name" style="margin-top: -20px">'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([
      '<input> "Name" overlaps <input> "Name"',
    ])
  })
})
