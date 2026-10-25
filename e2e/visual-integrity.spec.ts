import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { legacyData, seedKey, V2_KEY } from './fixtures'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { addFromMenu } from './support/week'
import { syntheticWeekReply } from '../src/features/assistant/anyAi/syntheticWeek'

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
  en: { button: 'New event', more: 'More' },
  es: { button: 'Nuevo evento', more: 'Más' },
  fr: { button: 'Nouvel événement', more: 'Plus' },
  pt: { button: 'Novo evento', more: 'Mais' },
  de: { button: 'Neuer Termin', more: 'Mehr' },
} as const
const LOCALES = Object.keys(EVENT_COPY) as (keyof typeof EVENT_COPY)[]

async function widenInputFonts(page: Page): Promise<void> {
  // Exercise the Linux CI failure on every OS, including systems with narrower default fonts.
  await page.addStyleTag({ content: `
    .onboarding input.name, .onboarding .chip-name, .onboarding .goal-chip, .event-form input:not([type="checkbox"]), .event-form textarea, .task-form input, .task-form select {
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

// "Usar con tu IA": the closed row, the open panel, every error state and the Settings section. The clipboard is
// removed so the by-hand copy text is on the page too.
// At 200 % text the shell around the panel (title, tab bar) is audited elsewhere; here only the panel itself: nothing
// wider than its box or the screen, and every control a full 44 px target.
async function panelFits(page: Page, state: string): Promise<void> {
  await settle(page)
  const problems = await page.getByTestId('any-ai').evaluate((panel) => {
    const found: string[] = []
    const width = document.documentElement.clientWidth
    for (const element of [panel as HTMLElement, ...Array.from(panel.querySelectorAll<HTMLElement>('*'))]) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const name = `${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? '').trim().slice(0, 24)}"`
      if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === 'visible' && element.clientWidth > 0) found.push(`${name} overflows (${element.scrollWidth} > ${element.clientWidth})`)
      if (rect.right > width + 0.5 || rect.left < -0.5) found.push(`${name} leaves the screen`)
      if (element.matches('button, textarea') && rect.height < 43.5) found.push(`${name} is ${rect.height}px high`)
    }
    return found
  })
  expect.soft(problems, state).toEqual([])
}

async function anyAiStates(page: Page, theme: string, label: string, includeSettings = true): Promise<void> {
  const check = includeSettings ? audit : panelFits
  await open(page, 'assistant')
  await check(page, `${theme}/${label}/assistant with the use-with-your-AI row closed`)
  await page.getByTestId('any-ai-toggle').click()
  await expect(page.getByTestId('any-ai-copy')).toBeVisible()
  await check(page, `${theme}/${label}/use with your AI open`)
  await page.getByTestId('any-ai-copy').click()
  await expect(page.getByTestId('any-ai-manual')).toBeVisible()
  await check(page, `${theme}/${label}/use with your AI, text to copy by hand`)
  const reply = (overrides: Record<string, unknown>) => `Listo:\n\`\`\`next168\n${JSON.stringify({ contractVersion: '1.0', workspaceId: 'workspace-visual', baseRevision: 1, summary: 'Mover', ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides })}\n\`\`\``
  await page.getByTestId('any-ai-paste').fill('Sin cambios aquí, solo texto largo que ocupa varias líneas para comprobar que el campo y el mensaje no se cortan en ninguna pantalla.')
  await expect(page.getByTestId('any-ai-review')).toBeEnabled()
  await page.getByTestId('any-ai-review').click()
  await expect(page.getByTestId('any-ai-error')).toBeVisible()
  await check(page, `${theme}/${label}/use with your AI, no proposal found`)
  await page.getByTestId('any-ai-paste').fill(reply({ baseRevision: 99 }))
  await page.getByTestId('any-ai-review').click()
  await expect(page.getByTestId('any-ai-copy-again')).toBeVisible()
  await check(page, `${theme}/${label}/use with your AI, stale reply with Copy again`)
  if (!includeSettings) return
  await open(page, 'settings/ai')
  await expect(page.getByTestId('any-ai-copy')).toBeVisible()
  await check(page, `${theme}/${label}/settings connect section with the use-with-your-AI panel`)
}

async function withoutClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
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
          await expect(onboarding.locator('.chip-name')).toHaveCount(7)
          if (locale === 'es') await expect(onboarding.locator('.chip-name').last()).toHaveText('Desplazamientos')
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/onboarding step 1`)

          for (const checkbox of await onboarding.getByRole('checkbox').all()) await checkbox.check()
          await expect(onboarding.locator('.edit-button:disabled')).toHaveCount(0)
          await onboarding.locator('[data-template=work] .edit-button').click()
          await expect(onboarding.locator('input.name')).toBeVisible()
          await audit(page, `${theme}/${locale}/${width}/wider fonts/onboarding step 1 with picks and the editor open`)
          const targets = await onboarding.locator('.chip, .edit-button, .swatch-choice').evaluateAll((elements) =>
            elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
          )
          for (const target of targets) {
            expect(target.width).toBeGreaterThanOrEqual(44)
            expect(target.height).toBeGreaterThanOrEqual(44)
          }
          await onboarding.getByRole('button', { name: /^(Next|Siguiente|Suivant|Weiter|Avançar|Próximo)$/ }).click()
          await onboarding.locator('[data-template=work] .goal-chip').click()
          await audit(page, `${theme}/${locale}/${width}/wider fonts/onboarding step 2 with the goal editor open`)
        })

        test(`wider fonts: new event (${locale}, ${width}px)`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
          await page.setViewportSize({ width, height: 812 })
          await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale } }, locale)
          await open(page, 'settings/calendars')
          await page.getByRole('button', { name: EVENT_COPY[locale].button, exact: true }).click()
          const times = page.getByRole('dialog').locator('input[type="time"]')
          await expect(times).toHaveCount(2)
          await widenInputFonts(page)
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new event`)
          // No attendees, no time zone: location and notes are one level deeper.
          await expect(page.getByRole('dialog').locator('input[inputmode="email"]')).toHaveCount(0)
          await page.getByRole('dialog').getByRole('button', { name: EVENT_COPY[locale].more, exact: true }).click()
          await page.getByRole('dialog').locator('textarea').scrollIntoViewIfNeeded()
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new event with location and notes`)
        })

        test(`wider fonts: new task and routine sheets (${locale}, ${width}px)`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
          await page.setViewportSize({ width, height: 812 })
          await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale } }, locale)
          await open(page, 'week')
          await page.getByTestId('week-add').click()
          await page.getByTestId('add-task').click()
          const sheet = page.getByRole('dialog')
          await expect(sheet.getByTestId('task-title')).toBeVisible()
          await widenInputFonts(page)
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new task`)
          await sheet.getByTestId('task-more').click()
          await expect(sheet.getByTestId('task-when')).toBeVisible()
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new task with more options`)
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await page.getByTestId('week-add').click()
          await page.getByTestId('add-block').click()
          await expect(page.getByRole('dialog').getByRole('radio').first()).toBeVisible()
          await widenInputFonts(page)
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new routine`)
        })
      }
    }

    for (const locale of LOCALES) {
      test(`use with your AI at 320 px (${locale})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 640 })
        await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale } }, locale)
        await withoutClipboard(page)
        await anyAiStates(page, theme, `${locale}/320`)
      })
    }

    test('use with your AI in German at 200 % text on a 320 px phone', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
      await page.setViewportSize({ width: 320, height: 640 })
      await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'de' } }, 'de')
      await withoutClipboard(page)
      await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
      // Settings at 200 % text is audited with the rest of that page, not here.
      await anyAiStates(page, theme, 'de/320/200%', false)
    })

    // The review of a whole week (#3): the summary line, closed groups, and Approve and Cancel in the footer, full 48 px
    // targets on screen without scrolling, at 320 px and with text at 200 %; nothing wider than the screen.
    for (const [locale, zoom] of [['es', '100%'], ['es', '200%'], ['de', '200%']] as const) {
      test(`review of a whole week on a 320 px phone (${locale}, text ${zoom})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 640 })
        await start(page, theme, { ...plannedDocument, categories: [], blocks: [], tasks: [], events: [], settings: { ...plannedDocument.settings, locale } }, locale)
        await withoutClipboard(page)
        if (zoom === '200%') await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
        await open(page, 'assistant')
        await page.getByTestId('any-ai-toggle').click()
        await page.getByTestId('any-ai-paste').fill(syntheticWeekReply('workspace-visual', 1))
        await page.getByTestId('any-ai-review').click()
        await expect(page.getByTestId('review-approve')).toBeEnabled()
        const footerFits = async (state: string) => {
          await settle(page)
          for (const id of ['review-approve', 'review-cancel']) {
            await expect.soft(page.getByTestId(id), `${state}: ${id} on screen`).toBeInViewport({ ratio: 1 })
            expect.soft((await page.getByTestId(id).boundingBox())!.height, `${state}: ${id} height`).toBeGreaterThanOrEqual(48)
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          expect.soft(overflow, `${state}: horizontal scroll`).toBeLessThanOrEqual(0)
          await audit(page, state)
        }
        await footerFits(`${theme}/${locale}/320/${zoom}/whole-week review`)
        await page.getByTestId('review-group-routines').getByRole('button', { expanded: false }).click()
        await expect(page.getByTestId('review-group-routines').locator('.change')).toHaveCount(32)
        await footerFits(`${theme}/${locale}/320/${zoom}/whole-week review with the routines open`)
      })
    }

    test('use with your AI (Spanish): the row, the open panel, copy by hand, errors and Settings', async ({ page }) => {
      await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }, 'es')
      await withoutClipboard(page)
      await anyAiStates(page, theme, 'es')
    })

    test('every tab', async ({ page }) => {
      await start(page, theme, plannedDocument)
      for (const view of ['today', 'week', 'tasks', 'insights', 'settings', 'settings/calendars', 'settings/ai', 'settings/data', 'settings/advanced', 'assistant', 'proposals', 'checkin']) {
        await open(page, view)
        await audit(page, `${theme}/${view}`)
      }
    })

    // Resumen: every row state (missing, kept, at the cap, over) and a row that only carries what was done.
    for (const locale of ['en', 'es'] as const) {
      test(`Summary rows in every goal state, and with no goals (${locale})`, async ({ page }) => {
        const goals: Record<string, unknown> = {
          'c-work': { type: 'max', hoursPerWeek: 8 }, 'c-sleep': { type: 'min', hoursPerWeek: 70 },
          'c-exercise': { type: 'max', hoursPerWeek: 3 }, 'c-study': { type: 'none', hoursPerWeek: 0 },
        }
        const withGoals = (byId: Record<string, unknown>) => plannedDocument.categories.map((category) => ({ ...category, goal: byId[category.id] }))
        const done = { date: '2026-10-20', blockId: 'b-study', categoryId: 'c-study', plannedStartAt: '2026-10-20T19:30:00.000Z', plannedEndAt: '2026-10-20T21:00:00.000Z', plannedMinutes: 90, status: 'done' }
        const settings = { ...plannedDocument.settings, locale }
        await start(page, theme, { ...plannedDocument, settings, categories: withGoals(goals), actuals: [done] }, locale)
        await open(page, 'insights')
        await expect(page.getByTestId('goal-state')).toHaveCount(3)
        await expect(page.getByTestId('actual-line')).toHaveCount(1)
        await audit(page, `${theme}/${locale}/summary with every goal state`)
      })

      test(`Summary with no goals invites setting one (${locale})`, async ({ page }) => {
        const none = plannedDocument.categories.map((category) => ({ ...category, goal: { type: 'none', hoursPerWeek: 0 } }))
        await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale }, categories: none }, locale)
        await open(page, 'insights')
        await expect(page.getByTestId('goals-empty')).toBeVisible()
        await audit(page, `${theme}/${locale}/summary without goals`)
      })
    }

    for (const [label, categories] of [['no categories', []], ['categories, no blocks', plannedDocument.categories]] as const) {
      test(`empty Today and Week offer "Set up my week" (${label})`, async ({ page }) => {
        await start(page, theme, { ...firstRunDocument, categories, settings: { ...firstRunDocument.settings, onboardingDone: true } })
        for (const view of ['today', 'week']) {
          await open(page, view)
          await expect(page.getByTestId('setup-week')).toBeVisible()
          await audit(page, `${theme}/${view} empty (${label})`)
        }
      })
    }

    test('Settings with each appearance choice', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'settings')
      const group = page.getByRole('radiogroup', { name: 'Appearance' })
      for (const name of ['Light', 'Dark', 'Automatic']) {
        await group.getByRole('radio', { name, exact: true }).click()
        await expect(group.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true')
        await audit(page, `${theme}/settings appearance ${name}`)
      }
    })

    test('the hidden sidebar, the tablet overlay and the Settings pages in Spanish', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'phone', 'phones have the tab bar and no sidebar')
      await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }, 'es')
      for (const view of ['settings', 'settings/calendars', 'settings/ai', 'settings/data', 'settings/advanced', 'assistant']) {
        await open(page, view)
        await audit(page, `${theme}/es/${view}`)
      }
      for (const view of ['today', 'week', 'insights']) {
        await open(page, view)
        const toggle = page.getByTestId('sidebar-toggle')
        // Desktop starts with the sidebar shown and hides it; the tablet starts collapsed and opens the overlay.
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', testInfo.project.name === 'desktop' ? 'false' : 'true')
        await audit(page, `${theme}/es/${view} with the sidebar toggled`)
        await toggle.click()
      }
    })

    test('onboarding steps 1–3 and the confirmation (owner\'s Spanish sheet)', async ({ page }) => {
      await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale: 'es' } }, 'es')
      await page.goto('./')
      await auditSheet(page, `${theme}/onboarding step 1`)
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('checkbox', { name: 'Usar Ejercicio' }).check()
      await audit(page, `${theme}/onboarding step 1 with picks`)
      await dialog.getByRole('button', { name: 'Editar Trabajo' }).click()
      await audit(page, `${theme}/onboarding step 1 editing a category`)
      await dialog.getByRole('button', { name: 'Siguiente' }).click()
      await audit(page, `${theme}/onboarding step 2`)
      await dialog.getByRole('button', { name: 'Cambiar la meta de Trabajo' }).click()
      await audit(page, `${theme}/onboarding step 2 editing a goal`)
      await dialog.getByRole('button', { name: 'Siguiente' }).click()
      await audit(page, `${theme}/onboarding step 3`)
      await dialog.getByLabel('Tarea', { exact: true }).fill('Llamar al banco')
      await dialog.getByRole('button', { name: 'Terminar' }).click()
      await expect(page.getByRole('dialog', { name: 'Tu semana está lista' })).toBeVisible()
      await auditSheet(page, `${theme}/onboarding confirmation`)
    })

    test('tasks quick add with its details, the task sheet, and the assistant page', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'tasks')
      await audit(page, `${theme}/tasks list`)
      await page.getByPlaceholder('Add task…').fill('Reply to the long email thread')
      await expect(page.getByTestId('task-details')).toBeVisible()
      await audit(page, `${theme}/tasks quick add with details`)
      await page.getByTestId('task-more').click()
      await expect(page.getByTestId('task-when')).toBeVisible()
      await audit(page, `${theme}/tasks quick add with more options`)
      await page.getByPlaceholder('Add task…').fill('')
      await page.getByTestId('placed-task').first().locator('.task-text').click()
      await auditSheet(page, `${theme}/task sheet`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await open(page, 'assistant')
      await audit(page, `${theme}/assistant with suggestions`)
    })

    for (const width of [390, 1440]) {
      test(`recently done tasks keep both row insets at ${width}px`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'explicit widths run once per theme')
        await page.setViewportSize({ width, height: 900 })
        const title = 'Ir por el kit de Edwin'
        const doneDocument = {
          ...plannedDocument,
          settings: { ...plannedDocument.settings, locale: 'es' },
          tasks: [{ id: 't-done', title, durationMin: 30, priority: 2, createdAt: '2026-10-20T08:00:00.000Z', doneAt: NOW.toISOString() }],
        }
        await start(page, theme, doneDocument, 'es')
        await open(page, 'tasks')
        const row = page.getByTestId('done-task')
        const reopen = row.getByRole('button', { name: 'Reabrir', exact: true })
        await expect(reopen).toBeVisible()
        await audit(page, `${theme}/${width}/tasks recently done`)
        const insets = await row.evaluate((element) => {
          const card = element.closest('.list-card')!.getBoundingClientRect()
          const button = element.querySelector('button')!.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(element.querySelector('.t-body')!)
          return { leading: range.getBoundingClientRect().left - card.left, trailing: card.right - button.right }
        })
        expect(insets.leading).toBeCloseTo(16, 0)
        expect(insets.trailing).toBeCloseTo(16, 0)
        await reopen.click()
        await expect(page.getByTestId('done-task')).toHaveCount(0)
        await expect(page.getByTestId('placed-task')).toContainText(title)
      })
    }

    test('week routine editor and the day sheets', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'week')
      await addFromMenu(page, 'Routine')
      await auditSheet(page, `${theme}/new routine`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // The long run fills the gym block below its title row: a tap on the title opens the routine, a tap on the task its sheet.
      await page.locator('[data-date="2026-10-21"] [data-block-id="b-gym"]').first().click({ position: { x: 12, y: 6 } })
      await auditSheet(page, `${theme}/edit routine`)
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
      await page.getByTestId('week-add').click()
      await page.getByRole('menuitem', { name: 'Tarea', exact: true }).click()
      await auditSheet(page, `${theme}/es/new task from +`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.getByTestId('week-task').first().click()
      await auditSheet(page, `${theme}/es/edit task from the grid`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      if (testInfo.project.name === 'phone') {
        await page.getByTestId('week-view-toggle').click()
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

      await open(page, 'settings/data')
      await page.getByRole('button', { name: 'Delete all data…' }).click()
      await auditSheet(page, `${theme}/delete everything`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      const v1Path = testInfo.outputPath('v1.json')
      await import('node:fs').then(({ writeFileSync }) => writeFileSync(v1Path, JSON.stringify(legacyData)))
      await page.getByLabel('Choose a Next168 export file').setInputFiles(v1Path)
      await expect(page.getByTestId('import-preview')).toBeVisible()
      await audit(page, `${theme}/import preview`)

      await open(page, 'settings/calendars')
      await page.getByRole('button', { name: 'New event', exact: true }).click()
      await auditSheet(page, `${theme}/new event`)
      await page.keyboard.press('Escape')
      await page.getByTestId('planner-event').getByRole('button', { name: 'Edit', exact: true }).click()
      await auditSheet(page, `${theme}/edit event`)
      await page.keyboard.press('Escape')

      await page.getByLabel('Import .ics file', { exact: true }).setInputFiles('src/core/__fixtures__/ics/google.ics')
      await expect(page.getByTestId('calendar-source')).toHaveCount(1)
      await audit(page, `${theme}/calendar details`)
    })

    test('proposal review and check-in', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'assistant')
      const gym = { op: 'add_block', block: { categoryId: 'c-exercise', title: 'Gym', days: [4], start: 1080, end: 1140 } }
      await page.evaluate((op) => (window as unknown as { __next168Test: { answerWithProposal(summary: string, ops: unknown[]): void } }).__next168Test.answerWithProposal('Add a gym block on Thursday', [op]), gym)
      // Without the on-device model the suggested questions are the way to ask; the E2E hook answers any of them.
      await page.getByTestId('suggestions').getByRole('button').first().click()
      await expect(page.getByTestId('proposal-card')).toBeVisible()
      await audit(page, `${theme}/assistant with a proposal`)
      await page.getByTestId('proposal-card').getByRole('button', { name: 'Review changes' }).click()
      await auditSheet(page, `${theme}/proposal review`)
      await page.keyboard.press('Escape')

      await open(page, 'checkin')
      await page.getByLabel('Note').fill('A long evening note that wraps across more than one line to check the text area.')
      await audit(page, `${theme}/check-in filled`)
    })

    test('Today and the nightly check-in (Spanish): Now card, circle and menu, rows, free card, evening card, form and saved state', async ({ page }, testInfo) => {
      const spanish = { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }
      // Headless Chromium reports notifications as blocked; the reminder button only exists where they can be asked for.
      await page.addInitScript(() => {
        class AskableNotification { static permission: NotificationPermission = 'default'; static requestPermission = async () => 'granted' as const }
        Object.defineProperty(window, 'Notification', { value: AskableNotification, configurable: true })
      })
      // Mid-block the card only tells the time left and what is next; the task is listed under "Después".
      await start(page, theme, spanish, 'es', new Date('2026-10-21T10:15:30.000Z'))
      await open(page, 'today')
      await expect(page.getByTestId('now-card').getByTestId('now-left')).toBeVisible()
      await expect(page.getByTestId('now-card').getByTestId('status-control')).toHaveCount(0)
      await audit(page, `${theme}/today: now card mid-block`)

      // In the block's last minutes the circle appears; right click opens its menu, A medias asks the minutes.
      await page.clock.fastForward(37 * 60_000)
      const circle = page.getByTestId('now-card').getByTestId('status-control')
      await expect(circle).toBeVisible()
      await audit(page, `${theme}/today: now card with the circle`)
      await circle.click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
      await audit(page, `${theme}/today: status menu open`)
      await page.getByRole('menuitem', { name: 'A medias' }).click()
      await expect(page.getByLabel(/Minutos dedicados/)).toBeVisible()
      await audit(page, `${theme}/today: now card with the minutes field`)
      await page.getByRole('button', { name: 'Guardar', exact: true }).click()
      await expect(circle).toHaveAttribute('data-status', 'partial')
      await audit(page, `${theme}/today: now card answered Partly`)
      await circle.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Quitar respuesta' }).click()
      await expect(circle).toHaveAttribute('data-status', 'none')

      // Deep work is over: its row carries a circle, the card says when the free time ends, and an old block is one line.
      await page.clock.setSystemTime(new Date('2026-10-21T12:00:00.000Z'))
      await page.clock.fastForward(31_000)
      await expect(page.getByTestId('now-title')).toHaveText('Tiempo libre hasta las 18:00')
      const deepRow = page.getByTestId('timeline-item').filter({ hasText: 'Deep work' })
      await expect(deepRow.getByTestId('status-control')).toBeVisible()
      await audit(page, `${theme}/today: free card and finished blocks with a circle`)
      await deepRow.getByTestId('status-control').click()
      await expect(deepRow.getByTestId('status-control')).toHaveAttribute('data-status', 'done')
      await audit(page, `${theme}/today: finished block answered`)
      await page.locator('[data-kind="task"]').first().getByTestId('status-control').click()
      // The previous toast may still be leaving; the one that stays is the newest.
      await expect(page.getByRole('button', { name: 'Deshacer' }).last()).toBeVisible()
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
      await page.getByTestId('fact-wake').getByRole('button').click()
      await expect(page.getByLabel('¿A qué hora te levantaste hoy?')).toBeVisible()
      await audit(page, `${theme}/check-in editing a time`)
      const gym = page.getByTestId('checkin-block').filter({ hasText: 'Gym' })
      await expect(gym).toBeVisible()
      await gym.getByTestId('status-control').click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
      await audit(page, `${theme}/check-in with a block menu open`)
      await page.getByRole('menuitem', { name: 'No', exact: true }).click()
      await expect(gym.getByTestId('status-control')).toHaveAttribute('data-status', 'skipped')
      await page.getByRole('radiogroup', { name: 'Estrés hoy' }).getByRole('radio', { name: '2' }).click()
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

    for (const locale of ['de', 'fr'] as const) {
      test(`Today and the check-in at 320 px in ${locale}: circles, menu, overlap line, sentences`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 700 })
        const crowded = {
          ...plannedDocument,
          settings: { ...plannedDocument.settings, locale },
          events: [...plannedDocument.events, { id: 'e-visit', title: 'Arzttermin und Rückruf', start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z', allDay: false, attendees: [] }],
        }
        await start(page, theme, crowded, locale, new Date('2026-10-21T21:00:00.000Z'))
        await open(page, 'today')
        await expect(page.getByTestId('timeline-overlap').first()).toBeVisible()
        await audit(page, `${theme}/${locale}/320 today: rows with circles and the overlap line`)
        await page.getByTestId('status-control').first().click({ button: 'right' })
        await expect(page.getByRole('menu')).toBeVisible()
        await audit(page, `${theme}/${locale}/320 today: status menu`)
        await page.keyboard.press('Escape')
        await open(page, 'checkin')
        await expect(page.getByTestId('checkin-block').first()).toBeVisible()
        await audit(page, `${theme}/${locale}/320 check-in: sentences, blocks and stress`)
        await page.getByTestId('fact-bedtime').getByRole('button').click()
        await audit(page, `${theme}/${locale}/320 check-in: editing a time`)
        await page.getByTestId('checkin-block').first().getByTestId('status-control').click({ button: 'right' })
        await page.getByRole('menuitem').first().click()
        await audit(page, `${theme}/${locale}/320 check-in: minutes field`)
      })
    }

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

test.describe('visual integrity guard: padded container edges', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  const stage = (content: string, extraStyle = '') => `
    <style>
      body { margin: 0; font: 16px/24px sans-serif; }
      .card { box-sizing: border-box; position: relative; margin: 24px; width: 280px; height: 160px; padding: 16px; border-radius: 16px; }
      button { box-sizing: border-box; width: 80px; height: 44px; border: 0; padding: 0; font: inherit; }
      ${extraStyle}
    </style>
    <section class="card">${content}</section>`

  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    test(`a flush button at the ${side} edge is reported through an unpadded wrapper`, async ({ page }) => {
      await page.setContent(stage('<div><button>Reopen</button></div>', `button { position: absolute; ${side}: 0; ${side === 'left' || side === 'right' ? 'top: 40px' : 'left: 80px'}; }`))
      expect(await visualIntegrityViolations(page, { focusRings: false })).toContain(
        `<button> "Reopen" touches the edge of <section.card> "Reopen" (${side}: 0.0px inset, 16.0px padding)`,
      )
    })
  }

  test('a stretched transparent checkbox is a chip hit target, not visible edge content', async ({ page }) => {
    await page.setContent(stage('<label class="chip"><input class="check-input" type="checkbox" aria-label="Use Work"><span>Work</span></label>', `
      .chip { position: relative; display: block; padding: 16px; }
      .check-input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  for (const inset of [0, 1]) {
    test(`a control covering all four container edges within ${inset} px is a full-area hit target`, async ({ page }) => {
      await page.setContent(stage('<label class="chip"><input type="checkbox" aria-label="Use Work"><span>Work</span></label>', `
        .chip { position: relative; display: block; padding: 16px; }
        input { position: absolute; inset: ${inset}px; width: calc(100% - ${inset * 2}px); height: calc(100% - ${inset * 2}px); margin: 0; }
      `))
      expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
    })
  }

  for (const hiddenStyle of ['opacity: 0', 'visibility: hidden', 'clip: rect(0, 0, 0, 0)', 'width: 1px; height: 1px; overflow: hidden']) {
    test(`an invisible edge control is accepted (${hiddenStyle})`, async ({ page }) => {
      await page.setContent(stage('<input type="checkbox" aria-label="Use Work">', `
        input { position: absolute; left: 0; top: 40px; width: 24px; height: 24px; margin: 0; ${hiddenStyle}; }
      `))
      expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
    })
  }

  test('a visible checkbox flush to the left edge is reported', async ({ page }) => {
    await page.setContent(stage('<input type="checkbox" aria-label="Use Work">', `
      input { position: absolute; left: 0; top: 40px; width: 24px; height: 24px; margin: 0; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([
      '<input> "Use Work" touches the edge of <section.card> "" (left: 0.0px inset, 16.0px padding)',
    ])
  })

  test('a properly inset trailing button is accepted, including borders and unequal padding', async ({ page }) => {
    await page.setContent(stage('<span>Title</span><button>Reopen</button>', `
      .card { display: flex; align-items: center; justify-content: space-between; border: 3px solid; padding: 12px 20px 18px 16px; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('a negative margin that borrows the card padding is reported even if the label stays inset', async ({ page }) => {
    await page.setContent(stage('<button>Reopen</button>', 'button { float: right; margin-right: -8px; padding-inline: 8px; }'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toContain(
      '<button> "Reopen" touches the edge of <section.card> "Reopen" (right: 8.0px inset, 16.0px padding)',
    )
  })

  test('subpixel rounding within the tolerance is accepted', async ({ page }) => {
    await page.setContent(stage('<button>Reopen</button>', 'button { float: right; margin-right: -0.5px; }'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('text moved into the padding is reported using its visible line box', async ({ page }) => {
    await page.setContent(stage('<p>Title</p>', 'p { margin: 0 0 0 -16px; }'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toContain(
      'text "Title" in <p> "Title" touches the edge of <section.card> "Title" (left: 0.0px inset, 16.0px padding)',
    )
  })

  test('a padded row inside an unpadded rounded group protects its trailing controls', async ({ page }) => {
    await page.setContent(stage('<div class="row"><span>Title</span><button>Reopen</button></div>', `
      .card { padding: 0; }
      .row { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; }
      button { margin-right: -16px; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toContain(
      '<button> "Reopen" touches the edge of <div.row> "TitleReopen" (right: 0.0px inset, 16.0px padding)',
    )
  })

  test('unpadded rounded containers allow full-width interactive rows', async ({ page }) => {
    await page.setContent(stage('<button>Reopen</button>', '.card { padding: 0; } button { width: 100%; }'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('scrolling a padded section does not turn scrolled-away content into an edge violation', async ({ page }) => {
    await page.setContent(stage('<button>First</button><div class="space"></div><button>Last</button>', `
      .card { overflow-y: auto; }
      .space { height: 200px; }
    `))
    await page.locator('.card').evaluate((element) => { element.scrollTop = element.scrollHeight })
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('a floating menu owns its padding independently of its trigger card', async ({ page }) => {
    await page.setContent(stage('<div role="menu"><button>Reopen</button></div>', `
      [role=menu] { position: absolute; top: 160px; right: 0; padding: 8px; border-radius: 12px; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
    await page.locator('button').evaluate((element) => { element.style.marginRight = '-8px' })
    expect((await visualIntegrityViolations(page, { focusRings: false })).some((violation) => violation.includes('touches the edge of <div>'))).toBe(true)
  })

  test('ellipsis and hidden flex columns do not report invisible text as touching the edge', async ({ page }) => {
    await page.setContent(stage(`
      <p class="ellipsis">A very long label that deliberately extends beyond its single visible line</p>
      <div class="columns"><span>First</span><span>Second</span><span>Third</span></div>
    `, `
      .ellipsis { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .columns { display: flex; flex-flow: column wrap; align-content: flex-start; gap: 0 16px; box-sizing: border-box; width: 100px; height: 44px; padding: 8px; overflow: hidden; }
      .columns span { flex: none; width: 100%; }
    `))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })
})

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

  test('a layered control wholly inside another is layering, one that sticks out of it is reported', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    const layered = (style: string) => `
      <style>body { margin: 0; } .host { position: absolute; left: 10px; top: 10px; width: 200px; height: 100px; } .task { position: absolute; z-index: 1; ${style} }</style>
      <button class="host">Deep work</button><button class="task" data-layered>Report</button>`
    await page.setContent(layered('left: 20px; top: 30px; width: 100px; height: 44px;'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
    await page.setContent(layered('left: 150px; top: 30px; width: 100px; height: 44px;'))
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual(['<button.host> "Deep work" overlaps <button.task> "Report"'])
  })

  test('a control that is not marked as layered is reported even when it lies inside another', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; } .host { position: absolute; left: 10px; top: 10px; width: 200px; height: 100px; } .task { position: absolute; left: 20px; top: 30px; width: 100px; height: 44px; }</style>
      <button class="host">Deep work</button><button class="task">Report</button>`)
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual(['<button.host> "Deep work" overlaps <button.task> "Report"'])
  })
})

