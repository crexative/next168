import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { legacyData, seedKey, V2_KEY } from './fixtures'
import { auditFloatingActionButtonInPage } from './support/fabPlacement'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { itemsMissingTitles, openClassicRoutine, seededTitles } from './support/week'
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
    [data-testid=setup] .name, [data-testid=setup] .line, [data-testid=setup] .value, [data-testid=setup] .range .label, .event-form input:not([type="checkbox"]), .event-form textarea, .task-form input, .task-form select {
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
    // Due Thursday, when its Evening course block holds it: due Wednesday it would go in Wednesday's free time instead.
    { id: 't-form', title: 'Hand in form', categoryId: 'c-study', durationMin: 60, dueDate: '2026-10-22', priority: 2, createdAt: '2026-10-20T08:00:00.000Z' },
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
    const panels = document.querySelectorAll<HTMLElement>('[role="dialog"]')
    const panel = panels[panels.length - 1] ?? null
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
  // The topmost sheet.
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  await settle(page)
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const dialogElement = dialogs[dialogs.length - 1]
    return {
      inside: Boolean(active && dialogElement?.contains(active)),
      calm: Boolean(active && (active.matches('h1, h2, h3[tabindex="-1"], [role="dialog"], input:not([type="checkbox"]):not([type="radio"]), textarea') || !active.matches(':focus-visible'))),
      element: active?.outerHTML.slice(0, 80) ?? 'none',
    }
  })
  expect.soft(focused.inside, `${state}: initial focus is inside the sheet`).toBe(true)
  expect.soft(focused.calm, `${state}: the sheet opened with a focus ring on ${focused.element}`).toBe(true)
  // One rule for a sheet's primary action: below 480 px its submit button spans the form, never hugs its label (from
  // 480 px up every button hugs its label, Button.vue).
  const hugging = await page.evaluate(() => {
    if (window.innerWidth >= 480) return []
    const dialogs = document.querySelectorAll('[role="dialog"]')
    const buttons = Array.from(dialogs[dialogs.length - 1]?.querySelectorAll<HTMLElement>('button[type="submit"]') ?? []).filter((button) => button.getClientRects().length > 0)
    return buttons.flatMap((button) => {
      const form = button.parentElement!
      const style = getComputedStyle(form)
      const room = form.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      const width = button.getBoundingClientRect().width
      return width < room - 1 ? [`"${(button.textContent ?? '').trim()}" is ${width.toFixed(1)}px of ${room.toFixed(1)}px`] : []
    })
  })
  expect.soft(hugging, `${state}: the sheet's primary action is full width`).toEqual([])
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
  const reply = (overrides: Record<string, unknown>) => `Listo:\n\`\`\`weeklid\n${JSON.stringify({ contractVersion: '1.1', workspaceId: 'workspace-visual', baseRevision: 1, summary: 'Mover', ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides })}\n\`\`\``
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
        test(`wider fonts: the guided setup's names, times and summary (${locale}, ${width}px)`, async ({ page }, testInfo) => {
          test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
          await page.setViewportSize({ width, height: 812 })
          await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale } }, locale)
          await page.goto('./')
          const setup = page.getByTestId('setup')
          const live = setup.locator('section.screen:not([aria-hidden=true])')
          await expect(setup).toHaveAttribute('data-screen', 'sleep')
          await widenInputFonts(page)
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/setup sleep`)
          // Every topic, so the summary lists every name, including the longest ones.
          for (const [selector, next] of [['[data-testid=setup-primary]', 'workStudy'], ['[data-value=both]', 'work'], ['[data-testid=setup-primary]', 'study'],
            ['[data-testid=setup-primary]', 'commute'], ['[data-value=yes]', 'commuteRanges'], ['[data-testid=setup-primary]', 'exercise'], ['[data-value=yes]', 'exerciseRanges'],
            ['[data-testid=setup-primary]', 'more']] as const) {
            await live.locator(selector).click()
            await expect(setup).toHaveAttribute('data-screen', next)
            await expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
          }
          await audit(page, `${theme}/${locale}/${width}/wider fonts/setup commute`)
          // "Anything else?" one at a time: each extra, its times, and the question again.
          for (const [index, topic] of ['family', 'friends', 'me', 'learning'].entries()) {
            await live.locator(`[data-value=${topic}]`).click()
            await expect(setup).toHaveAttribute('data-screen', `extra:${topic}`)
            await expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
            await live.getByTestId('setup-primary').click()
            await expect(setup).toHaveAttribute('data-screen', `more:${index + 1}`)
            await expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
            if (index === 0) await audit(page, `${theme}/${locale}/${width}/wider fonts/setup more:1`)
          }
          await live.getByTestId('more-done').click()
          await expect(setup).toHaveAttribute('data-screen', 'summary')
          if (locale === 'es') await expect(live.locator('[data-category] .name')).toContainText(['Sueño', 'Trabajo', 'Estudio', 'Desplazamientos'])
          await audit(page, `${theme}/${locale}/${width}/wider fonts/setup summary`)
          const targets = await live.locator('[data-category] > button').evaluateAll((elements) =>
            elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
          )
          expect(targets.length).toBe(9)
          for (const target of targets) {
            expect(target.width).toBeGreaterThanOrEqual(48)
            expect(target.height).toBeGreaterThanOrEqual(48)
          }
          await live.getByTestId('card-commute').click()
          await live.locator('[data-category=commute] [data-field=end]').first().click()
          await audit(page, `${theme}/${locale}/${width}/wider fonts/setup summary with a picker`)
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
          // No time zone: guests, location and notes are one level deeper.
          await expect(page.getByRole('dialog').locator('input[inputmode="email"]')).toBeHidden()
          await page.getByRole('dialog').getByRole('button', { name: EVENT_COPY[locale].more, exact: true }).click()
          const guest = page.getByRole('dialog').locator('input[inputmode="email"]')
          await guest.fill('a.very.long.guest.address.for.layout@example.org')
          await guest.press('Enter')
          await expect(page.getByTestId('event-guests').getByRole('listitem')).toHaveCount(1)
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
          await openClassicRoutine(page)
          await expect(page.getByRole('dialog').getByRole('radio').first()).toBeVisible()
          await widenInputFonts(page)
          await auditSheet(page, `${theme}/${locale}/${width}/wider fonts/new routine`)
        })
      }
    }

    // The time rows of the guided setup at 320 px with text at 200 % and wider (Linux) fonts, in every language: each
    // label fits beside its icon or wraps (#3: "Ich gehe schlafen" ran out of its row on Linux).
    for (const locale of LOCALES) {
      test(`the guided setup's time rows at 320 px and 200 % text (${locale})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 640 })
        await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale } }, locale)
        await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
        await page.goto('./')
        const setup = page.getByTestId('setup')
        const live = setup.locator('section.screen:not([aria-hidden=true])')
        await expect(setup).toHaveAttribute('data-screen', 'sleep')
        await widenInputFonts(page)
        await audit(page, `${theme}/${locale}/320/200%/setup sleep`)
        await live.locator('[data-testid=setup-primary]').click()
        await expect(setup).toHaveAttribute('data-screen', 'workStudy')
        await live.locator('[data-value=both]').click()
        await expect(setup).toHaveAttribute('data-screen', 'work')
        await expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
        await audit(page, `${theme}/${locale}/320/200%/setup work`)
      })
    }

    // Label and value rows on one line at 100 % text from 360 px, in every language (owner, 2026-10-25: "Me levanto" put
    // "7:00 a. m. (al día siguiente)" under its label): sleep, work, the trip, the summary with a card open.
    for (const locale of LOCALES) {
      test(`the guided setup's label and value rows on one line at 360 px (${locale})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 360, height: 780 })
        await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale } }, locale)
        await page.goto('./')
        const setup = page.getByTestId('setup')
        const live = setup.locator('section.screen:not([aria-hidden=true])')
        const settled = () => expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
        await expect(setup).toHaveAttribute('data-screen', 'sleep')
        await live.locator('[data-chip=split]').click()
        await audit(page, `${theme}/${locale}/360/setup sleep, weekends different`)
        for (const [selector, next] of [['[data-testid=setup-primary]', 'workStudy'], ['[data-value=both]', 'work'], ['[data-testid=setup-primary]', 'study'],
          ['[data-testid=setup-primary]', 'commute'], ['[data-value=yes]', 'commuteRanges'], ['[data-testid=setup-primary]', 'exercise'], ['[data-value=yes]', 'exerciseRanges']] as const) {
          await live.locator(selector).click()
          await expect(setup).toHaveAttribute('data-screen', next)
          await settled()
          if (['work', 'study', 'commuteRanges', 'exerciseRanges'].includes(next)) await audit(page, `${theme}/${locale}/360/setup ${next}`)
        }
        await live.getByTestId('setup-primary').click()
        await expect(setup).toHaveAttribute('data-screen', 'more')
        for (const [index, topic] of ['family', 'friends', 'me', 'learning'].entries()) {
          await settled()
          await live.locator(`[data-value=${topic}]`).click()
          await expect(setup).toHaveAttribute('data-screen', `extra:${topic}`)
          await settled()
          await live.getByTestId('setup-primary').click()
          await expect(setup).toHaveAttribute('data-screen', `more:${index + 1}`)
        }
        await settled()
        await live.getByTestId('more-done').click()
        await expect(setup).toHaveAttribute('data-screen', 'summary')
        await settled()
        await audit(page, `${theme}/${locale}/360/setup summary`)
        await live.getByTestId('card-sleep').click()
        await audit(page, `${theme}/${locale}/360/setup summary, sleep open`)
      })
    }

    // Summary › Day wrap-up at 320 px and 200 % text: the toolbar's back link ends before the ✦ and gear entries.
    for (const locale of ['es', 'de', 'en'] as const) {
      test(`the check-in's back link beside the toolbar entries at 320 px and 200 % text (${locale})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 640 })
        await start(page, theme, { ...plannedDocument, checkIns: [], settings: { ...plannedDocument.settings, locale } }, locale)
        await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
        await open(page, 'insights')
        // The empty state's link must be what a tap reaches (on Linux its label ran out of it and the card took the tap).
        await page.getByTestId('measures-empty').getByRole('link').scrollIntoViewIfNeeded()
        await audit(page, `${theme}/${locale}/320/200%/Summary with no check-ins`)
        await page.getByTestId('measures-empty').getByRole('link').click()
        await expect(page.getByTestId('back-button')).toBeVisible()
        await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
        await audit(page, `${theme}/${locale}/320/200%/check-in from Summary`)
      })
    }

    // Summary at 320 px and 200 % text with wide fonts (Verdana here, DejaVu Sans on Linux, like the Linux runner): the
    // headline's "zugewiesen", the title's "Standardwoche" and the empty state's "Tagesabschluss" ran out of their
    // boxes there, the page grew wider than the screen and pushed the tab bar's "Übersicht" off it.
    test(`Summary at 320 px and 200 % text with wide fonts (de)`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
      await page.setViewportSize({ width: 320, height: 640 })
      await start(page, theme, { ...plannedDocument, checkIns: [], settings: { ...plannedDocument.settings, locale: 'de' } }, 'de')
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = '200%'
          const style = document.createElement('style')
          style.textContent = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }'
          document.head.append(style)
        })
      })
      await open(page, 'insights')
      await page.getByTestId('measures-empty').getByRole('link').scrollIntoViewIfNeeded()
      await audit(page, `${theme}/de/320/200%/wide fonts/Summary with no check-ins`)
    })

    // The collapsed toolbar title beside the check-in's back link at 320 px: "Bilan du jour" ran 4 px into "Aujourd'hui"
    // whenever the page had scrolled far enough to show it (the run-together rule caught it now and then).
    for (const locale of LOCALES) {
      test(`the check-in's collapsed toolbar title clear of its back link at 320 px (${locale})`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'phone', 'the narrow-width regression runs in the phone project')
        await page.setViewportSize({ width: 320, height: 640 })
        await start(page, theme, { ...plannedDocument, settings: { ...plannedDocument.settings, locale } }, locale)
        await open(page, 'checkin')
        await expect(page.getByTestId('back-button')).toBeVisible()
        await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight))
        await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
        await audit(page, `${theme}/${locale}/320/check-in with the collapsed toolbar title`)
      })
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

    test('the guided setup: a question, a picker, the time editor and the summary (owner\'s Spanish sheet)', async ({ page }) => {
      await start(page, theme, { ...firstRunDocument, settings: { ...firstRunDocument.settings, locale: 'es' } }, 'es')
      await page.goto('./')
      const setup = page.getByTestId('setup')
      const live = setup.locator('section.screen:not([aria-hidden=true])')
      // A leaving screen stays in the DOM, inert, while it fades out.
      const settled = () => expect(setup.locator('section.screen[aria-hidden=true]')).toHaveCount(0)
      await expect(setup).toHaveAttribute('data-screen', 'sleep')
      await auditSheet(page, `${theme}/setup sleep`)
      await live.getByRole('button', { name: 'Enviar respuesta', exact: true }).click()
      await live.getByRole('button', { name: 'Trabajo', exact: true }).click()
      await expect(setup).toHaveAttribute('data-screen', 'work')
      await settled()
      await audit(page, `${theme}/setup work`)
      await live.locator('[data-field=days]').click()
      await live.locator('[data-preset=pick]').click()
      await audit(page, `${theme}/setup work days`)
      await page.keyboard.press('Escape')
      await live.locator('[data-field=start]').click()
      await live.getByTestId('other-time').click()
      await audit(page, `${theme}/setup time editor`)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await live.getByRole('button', { name: 'Enviar respuesta', exact: true }).click()
      await expect(setup).toHaveAttribute('data-screen', 'commute')
      await settled()
      await audit(page, `${theme}/setup commute`)
      // The conversation: an earlier answer reopened while later ones exist, then back to where it was.
      await live.locator('[data-answer=work]').click()
      await expect(setup).toHaveAttribute('data-screen', 'work')
      await audit(page, `${theme}/setup work reopened from the conversation`)
      await live.getByRole('button', { name: 'Enviar respuesta', exact: true }).click()
      await expect(setup).toHaveAttribute('data-screen', 'commute')
      await live.getByRole('button', { name: 'No', exact: true }).click()
      await live.getByRole('button', { name: 'No', exact: true }).click()
      await expect(setup).toHaveAttribute('data-screen', 'more')
      await audit(page, `${theme}/setup more, the first round`)
      await live.getByTestId('more-other').click()
      await live.getByTestId('more-other-name').fill('Clases de natación')
      await audit(page, `${theme}/setup more, a name of their own being typed`)
      for (let guard = 0; guard < 6 && (await setup.getAttribute('data-screen')) !== 'summary'; guard++) {
        const screen = await setup.getAttribute('data-screen')
        await live.getByTestId('setup-secondary').click()
        await expect(setup).not.toHaveAttribute('data-screen', screen!)
        await settled()
      }
      await expect(setup).toHaveAttribute('data-screen', 'summary')
      await settled()
      await audit(page, `${theme}/setup summary`)
      await live.getByTestId('card-work').click()
      await audit(page, `${theme}/setup summary with a card open`)
    })

    test('tasks quick add with its details, the task sheet, and the assistant page', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'tasks')
      await audit(page, `${theme}/tasks list`)
      await page.getByPlaceholder('Add a task… (or paste or dictate several)').fill('Reply to the long email thread')
      await expect(page.getByTestId('task-details')).toBeVisible()
      await audit(page, `${theme}/tasks quick add with details`)
      await page.getByTestId('task-more').click()
      await expect(page.getByTestId('task-when')).toBeVisible()
      await audit(page, `${theme}/tasks quick add with more options`)
      await page.getByPlaceholder('Add a task… (or paste or dictate several)').fill('')
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
        // The card padding token: 16 px on a phone, 20 px from 1024 px.
        const cardPadding = width >= 1024 ? 20 : 16
        expect(insets.leading).toBeCloseTo(cardPadding, 0)
        expect(insets.trailing).toBeCloseTo(cardPadding, 0)
        await reopen.click()
        await expect(page.getByTestId('done-task')).toHaveCount(0)
        await expect(page.getByTestId('placed-task')).toContainText(title)
      })
    }

    test('week routine editor and the day sheets', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'week')
      await openClassicRoutine(page)
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

    test('the share sheet: story and square, names on', async ({ page }) => {
      await start(page, theme, plannedDocument)
      await open(page, 'insights')
      await page.getByRole('button', { name: 'Share my typical week' }).click()
      await expect(page.getByTestId('share-primary')).toBeEnabled()
      await auditSheet(page, `${theme}/share sheet, story`)
      await page.getByRole('radio', { name: 'Square' }).click()
      await page.getByRole('switch', { name: 'Show routine names' }).check()
      await expect(page.getByTestId('share-primary')).toBeEnabled()
      await audit(page, `${theme}/share sheet, square with names`)
    })

    test('settings sheets, import preview and calendar details', async ({ page }, testInfo) => {
      await start(page, theme, plannedDocument)
      await open(page, 'settings')
      await page.getByRole('button', { name: 'Edit Learning and side projects' }).click()
      await auditSheet(page, `${theme}/edit category`)
      await page.keyboard.press('Escape')
      // "Add category" opens the guided add, a full-screen frame rather than a sheet.
      await page.getByRole('button', { name: 'Add category' }).click()
      await expect(page.locator('[data-testid=setup][data-mode=add]')).toBeVisible()
      // It may open while the edit sheet is still springing away: audit it once it has arrived.
      await expect.poll(() => page.locator('.setup-frame').evaluate((element) => element.getBoundingClientRect().top)).toBe(0)
      await auditSheet(page, `${theme}/add a category, first question`)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('setup')).toHaveCount(0)

      await open(page, 'settings/data')
      await page.getByRole('button', { name: 'Delete all data…' }).click()
      await auditSheet(page, `${theme}/delete everything`)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      const v1Path = testInfo.outputPath('v1.json')
      await import('node:fs').then(({ writeFileSync }) => writeFileSync(v1Path, JSON.stringify(legacyData)))
      await page.getByLabel('Choose a Weeklid export file').setInputFiles(v1Path)
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
      // The previous toast leaves first (out-in); the newest one is the one that appears.
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

// Week at 768, 1024 and 1440 px with events beside routines and tasks inside them (#3, R1): every title drawn is whole
// (docs/design/visual-design.md › Week items) and every item names its whole title, a task chunk with room for its title
// shows it, the routine's own area opens the routine, and the week's range, arrows and free hours are on screen.
test.describe('Week readability', () => {
  const crowded = {
    ...plannedDocument,
    events: [
      { id: 'e-vendor', title: 'Vendor call', start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T10:30:00.000Z', allDay: false, attendees: [] },
      { id: 'e-sync', title: 'Team sync', start: '2026-10-23T09:30:00.000Z', end: '2026-10-23T10:30:00.000Z', allDay: false, attendees: [] },
    ],
  }
  // Three 20-minute tasks back to back at the top of Monday's routine (#3 review): each below the title lines, none on
  // another, at the phone, tablet and desktop layouts.
  for (const width of [375, 768, 1440]) {
    test(`back-to-back short tasks at the top of a routine never cover each other at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'explicit widths run once')
      await page.setViewportSize({ width, height: 900 })
      const tasks = ['First call', 'Second call', 'Third call'].map((title, index) => ({ id: `t-${index}`, title, categoryId: 'c-work', durationMin: 20, priority: index + 1, createdAt: '2026-10-18T08:00:00.000Z' }))
      await start(page, 'light', { ...plannedDocument, tasks }, 'en', new Date('2026-10-19T07:00:00.000Z'))
      await open(page, 'week')
      const chunks = page.locator('[data-date="2026-10-19"] [data-testid="week-task"]')
      await expect(chunks).toHaveCount(3)
      await expect.poll(() => chunks.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-start-minute')))).toEqual(['540', '560', '580'])
      const boxes = await chunks.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      }).sort((a, b) => a.top - b.top))
      for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.top, `task ${index} starts below task ${index - 1}`).toBeGreaterThanOrEqual(boxes[index - 1]!.bottom - 0.5)
      await audit(page, `light/${width}/back-to-back tasks at the top of a routine`)
    })
  }

  for (const width of [768, 1024, 1440]) {
    test(`titles, task labels, taps and the header at ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'explicit widths run once')
      await page.setViewportSize({ width, height: 900 })
      await start(page, 'light', crowded)
      await open(page, 'week')
      for (const id of ['week-range', 'week-previous', 'week-next', 'week-free-hours-slot']) {
        await expect.soft(page.getByTestId(id), `${id} on arrival`).toBeInViewport({ ratio: 1 })
      }
      await expect(page.getByTestId('now-line')).toBeInViewport()
      // Every title drawn is whole (the whole-text rule of the guard), and a hidden one stays in the accessible name.
      await audit(page, `light/${width}/week with events beside routines`)
      // Each item's accessible name holds its full title as seeded (by id), drawn whole, cut or not at all.
      const names = await itemsMissingTitles(page, seededTitles(crowded))
      expect(names.checked, 'routines, events and tasks checked').toBeGreaterThan(20)
      expect.soft(names.missing).toEqual([])
      // A task chunk whose box holds its whole title on one caption line shows it (verify5 N2: no empty box that had room).
      const unlabeled = await page.getByTestId('week-task').evaluateAll((chunks) => chunks.flatMap((chunk) => {
        if (!chunk.getAttribute('title')) return [`${chunk.getAttribute('aria-label')} has no tooltip`]
        const box = chunk.querySelector<HTMLElement>('.task-box')!
        if (chunk.classList.contains('is-outline') || chunk.querySelector('.task-title')) return []
        const style = getComputedStyle(box)
        const probe = document.createElement('span')
        probe.style.cssText = `position: absolute; visibility: hidden; white-space: pre; font: ${style.font}; letter-spacing: ${style.letterSpacing}`
        probe.textContent = chunk.getAttribute('title')
        document.body.append(probe)
        const width = probe.getBoundingClientRect().width
        probe.remove()
        const room = box.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
        const height = box.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)
        return width <= room - 2 && height >= Number.parseFloat(style.lineHeight) + 0.5 ? [`${chunk.getAttribute('aria-label')} has room for its title but shows none`] : []
      }))
      expect.soft(unlabeled).toEqual([])
      // Thursday's routine holds a 20-minute task at its start: the routine's own area (outside its task) opens it.
      const routine = page.locator('[data-date="2026-10-22"] [data-block-id="b-work"]').first()
      await routine.scrollIntoViewIfNeeded()
      const own = await routine.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        for (let y = rect.top + 2; y < rect.bottom - 2; y += 2) {
          const x = rect.left + rect.width / 2
          if (document.elementFromPoint(x, y)?.closest('[data-block-id]') === element) return { x: x - rect.left, y: y - rect.top }
        }
        return null
      })
      expect(own, 'the routine has an area of its own').not.toBeNull()
      await routine.click({ position: own! })
      await expect(page.getByRole('dialog').getByRole('heading', { name: 'Edit routine' })).toBeVisible()
    })
  }
})

// Week items (docs/design/visual-design.md › Week items): inside a [data-whole-text] container text is whole or not
// drawn. Each case below is a defect verify3 to verify5 found in Week ("Vendo…", "Reunió…", a second line cut, a task
// over a routine's time, a title under the next routine).
test.describe('visual integrity guard: whole text in Week', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  const column = (items: string, extraStyle = '') => `
    <style>
      body { margin: 0; font: 13px/16px sans-serif; }
      .column { position: relative; width: 150px; height: 400px; margin: 0 16px; }
      .item { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; margin: 0; padding: 2px 4px; border: 0; overflow: hidden; font: inherit; text-align: start; background: #dde; }
      .item span { display: block; }
      ${extraStyle}
    </style>
    <div class="column" data-whole-text>${items}</div>`
  const pressTargets = (page: Page) => visualIntegrityViolations(page, { focusRings: false })
  // The fixtures below are about text; their few boxes stand alone, so the 44 px press rule is checked on its own.
  const audit = async (page: Page) => (await pressTargets(page)).filter((violation) => !violation.includes(' px press: '))

  test('whole titles, a mark with no text, a hidden word and a task inside its routine are accepted', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" style="top: 0; left: 0; width: 150px; height: 60px"><span>Deep work</span><span>9:00 – 10:00</span></button>
      <button class="item" data-layered style="top: 38px; left: 0; width: 150px; height: 20px"><span>Report</span></button>
      <button class="item" style="top: 60px; left: 0; width: 150px; height: 8px" aria-label="Stand-up"></button>
      <button class="item" style="top: 72px; left: 0; width: 150px; height: 20px"><span style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Conflict</span><span>Vendor call</span></button>
      <div style="position: absolute; top: 30px; left: 0; right: 0; height: 2px; background: red; pointer-events: none"></div>
    `))
    expect(await audit(page)).toEqual([])
  })

  test('a title truncated with an ellipsis is reported ("Vendo…")', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 60px; height: 20px"><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Vendor call</span></button>'))
    expect(await audit(page)).toContain('text "Vendor call" in <span> "Vendor call" is truncated by <span> "Vendor call" (an ellipsis or a line clamp hides part of it)')
  })

  test('a title clamped to fewer lines than it needs is reported', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 60px; height: 60px"><span style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden">Revisión de diseño de producto</span></button>'))
    expect((await audit(page)).some((violation) => violation.includes('is truncated by'))).toBe(true)
  })

  test('a second line cut off by a short box is reported ("Revisión de diseño de")', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 70px; height: 36px"><span>Revisión de diseño de producto</span></button>'))
    expect(await audit(page)).toContain('text "Revisión de diseño de producto" in <span> "Revisión de diseño de producto" is cut by <button.item> "Revisión de diseño de producto"')
  })

  test('a title whose one line is taller than its box is reported ("Reunión diaria" in 12 px)', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 150px; height: 12px"><span>Reunión diaria</span></button>'))
    expect((await audit(page)).some((violation) => violation.startsWith('text "Reunión diaria"') && violation.includes('is cut by'))).toBe(true)
  })

  test('text that runs out of an unclipped item is reported', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 150px; height: 10px; overflow: visible"><span>Reunión diaria</span></button>'))
    expect(await audit(page)).toContain('text "Reunión diaria" in <span> "Reunión diaria" runs outside its item <button.item> "Reunión diaria"')
  })

  test('a task box over its routine\'s time line is reported ("Revisa…" on "9:15 a. m.")', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" style="top: 0; left: 0; width: 150px; height: 120px"><span>Trabajo profundo</span><span>9:15 – 13:00</span></button>
      <button class="item" data-layered style="top: 18px; left: 8px; width: 140px; height: 20px; background: transparent"><span>Revisar</span></button>
    `))
    const violations = await audit(page)
    expect(violations).toContain('text "9:15 – 13:00" in <span> "9:15 – 13:00" is covered by <button.item> "Revisar"')
    expect(violations.some((violation) => violation.startsWith('text "9:15 – 13:00" and text "Revisar" overlap in <div.column>'))).toBe(true)
  })

  test('a routine title under the next item is reported (the 15-minute "Reunión diaria" under "Trabajo profundo")', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" style="top: 0; left: 0; width: 150px; height: 12px; overflow: visible"><span>Reunión diaria</span></button>
      <button class="item" style="top: 12px; left: 0; width: 150px; height: 120px"><span>Trabajo profundo</span></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.startsWith('text "Reunión diaria"') && violation.includes('covered by <button.item> "Trabajo profundo"'))).toBe(true)
  })

  test('an event drawn over a routine\'s title is reported', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" style="top: 0; left: 0; width: 150px; height: 96px"><span>Deep work</span></button>
      <button class="item" style="top: 0; left: 40px; width: 110px; height: 24px; z-index: 2"><span>Vendor call</span></button>
    `))
    expect(await audit(page)).toContain('text "Deep work" in <span> "Deep work" is covered by <button.item> "Vendor call"')
  })

  test('a title cut after whole words with the generated "…" is accepted ("Revisión de…", "Vendor…")', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" title="Revisión de diseño de producto" style="top: 0; left: 0; width: 80px; height: 40px"><span>Revisión de<span style="display: inline" data-cut aria-hidden="true">…</span></span></button>
      <button class="item" aria-label="Vendor call 9:30 – 10:00" style="top: 40px; left: 0; width: 80px; height: 20px"><span>Vendor<span style="display: inline" data-cut>…</span></span></button>
    `))
    expect(await audit(page)).toEqual([])
  })

  test('a word cut before the generated "…", or a cut drawn as plain text, is reported ("Vendo…", "Reunió…")', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" title="Reunión diaria" style="top: 0; left: 0; width: 80px; height: 20px"><span>Reunió…</span></button>
      <button class="item" aria-label="Vendor call 9:30 – 10:00" style="top: 20px; left: 0; width: 80px; height: 20px"><span>Vendo<span style="display: inline" data-cut aria-hidden="true">…</span></span></button>
    `))
    const violations = await audit(page)
    expect(violations).toContain('text "Reunió…" in <span> "Reunió…" draws "Reunió…", a "…" that is not part of the title "Reunión diaria"')
    expect(violations.some((violation) => violation.includes('ends "Vendo…", which is not whole words of "Vendor call 9:30 – 10:00"'))).toBe(true)
  })

  test('the generated "…" after the whole title is reported: nothing was left out', async ({ page }) => {
    await page.setContent(column('<button class="item" title="Gym" style="top: 0; left: 0; width: 80px; height: 20px"><span>Gym<span style="display: inline" data-cut>…</span></span></button>'))
    expect((await audit(page)).some((violation) => violation.includes('ends "Gym…"'))).toBe(true)
  })

  // Codex review: "…" or "..." that belongs to a fully drawn title is punctuation, not a cut.
  test('a whole title that contains "…" or "..." is accepted ("Pausa…", "Wait...")', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" title="Pausa…" style="top: 0; left: 0; width: 120px; height: 20px"><span>Pausa…</span></button>
      <button class="item" aria-label="Wait... 9:00 – 9:15" style="top: 20px; left: 0; width: 120px; height: 20px"><span>Wait...</span></button>
      <button class="item" aria-label="Pausa… larga 9:15 – 9:45" style="top: 40px; left: 0; width: 120px; height: 20px"><span>Pausa… larga</span></button>
    `))
    expect(await audit(page)).toEqual([])
  })

  // Codex delta review: the title's own "…" or "..." followed by the generated "…" is a title cut between words.
  test('a title with its own "…" or "...", cut after whole words with the generated "…", is accepted', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" title="Pausa… larga reunión" style="top: 0; left: 0; width: 120px; height: 20px"><span>Pausa…<span style="display: inline" data-cut aria-hidden="true">…</span></span></button>
      <button class="item" aria-label="Wait... for the bus 9:00 – 9:15" style="top: 20px; left: 0; width: 120px; height: 20px"><span>Wait...<span style="display: inline" data-cut>…</span></span></button>
      <button class="item" title="Pausa… larga reunión" style="top: 40px; left: 0; width: 120px; height: 20px"><span>Pausa… larga<span style="display: inline" data-cut>…</span></span></button>
    `))
    expect(await audit(page)).toEqual([])
  })

  test('a word cut after the title\'s own "…" is reported ("Pausa… lar…")', async ({ page }) => {
    await page.setContent(column('<button class="item" title="Pausa… larga reunión" style="top: 0; left: 0; width: 120px; height: 20px"><span>Pausa… lar<span style="display: inline" data-cut>…</span></span></button>'))
    expect((await audit(page)).some((violation) => violation.includes('ends "Pausa… lar…", which is not whole words of "Pausa… larga reunión"'))).toBe(true)
  })

  // verify6 D1/D2/D3: boxes left blank although a word would fit. The smallest size here is 11 px on a 1.1 line.
  const smallest = '<span data-min-text style="position: absolute; visibility: hidden; font: 500 11px/1.1 sans-serif">M</span>'
  test('a box with no words but room for its first word in the smallest size is reported', async ({ page }) => {
    await page.setContent(column(`${smallest}
      <button class="item" aria-label="Correos y seguimiento 3:10 – 5:30" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 74px; height: 112px"></button>
      <button class="item" title="Desayuno con los niños" data-text-inset="0 4 0 7" style="top: 120px; left: 0; width: 150px; height: 16px"></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.includes('"Correos y seguimiento 3:10 – 5:30" draws no text though "Correos…" fits'))).toBe(true)
    expect(violations.some((violation) => violation.includes('draws no text though "Desayuno…" fits its 138.8×16.0 px room'))).toBe(true)
  })

  test('a container without its own smallest size is held to the documented one, and a shapes-only container is not', async ({ page }) => {
    await page.setContent(column('<button class="item" title="Desayuno con los niños" style="top: 0; left: 0; width: 150px; height: 16px"></button>'))
    expect((await audit(page)).some((violation) => violation.includes('draws no text though "Desayuno…" fits'))).toBe(true)
    await page.locator('[data-whole-text]').evaluate((container) => container.setAttribute('data-whole-text', 'shapes'))
    expect(await audit(page)).toEqual([])
  })

  test('a box with no words is accepted when even its first word does not fit, and outlines are left alone', async ({ page }) => {
    await page.setContent(column(`${smallest}
      <button class="item" title="Meditación" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 150px; height: 8px"></button>
      <button class="item" title="Abstimmungsgespräch" data-text-inset="0 4 0 7" style="top: 20px; left: 0; width: 30px; height: 40px"><span data-glyph style="position: absolute; inset: 0 4px 0 7px"></span></button>
      <button class="item" title="Write the report" data-layered data-text-inset="1.5 5.5 1.5 7.5" style="top: 80px; left: 0; width: 150px; height: 96px; pointer-events: none; background: transparent"></button>
    `))
    expect(await audit(page)).toEqual([])
  })

  // verify7: a box too small for one whole word still says something: its category glyph, when the box holds it. The
  // glyph here is 12 px square; at 50d5dbd "Correos y seguimiento" (44.9×112 px at 768) and "Almuerzo" (44.9×36 px)
  // were drawn blank.
  const glyphProbe = '<span data-glyph-probe style="position: absolute; visibility: hidden; display: block; width: 12px; height: 12px"></span>'
  test('a box with no word but room for its glyph that shows nothing is reported', async ({ page }) => {
    await page.setContent(column(`${smallest}${glyphProbe}
      <button class="item" aria-label="Correos y seguimiento" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 30px; height: 112px"></button>
      <button class="item" aria-label="Pausa activa" data-text-inset="1 3 1 3" style="top: 120px; left: 0; width: 150px; height: 12px"></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.includes('"Correos y seguimiento" draws neither a word nor its glyph though the 12.0×12.0 px glyph fits its 18.8×112.0 px room'))).toBe(true)
    // 10 px of room is below the 11 px line and the 12 px glyph: a nameless strip there is allowed.
    expect(violations.filter((violation) => violation.includes('Pausa activa'))).toEqual([])
  })

  test('a glyph counts only when it is drawn inside its box', async ({ page }) => {
    await page.setContent(column(`${smallest}${glyphProbe}
      <button class="item" aria-label="Almuerzo" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 30px; height: 36px"><span data-glyph style="position: absolute; inset: 0 4px 0 7px"></span></button>
      <button class="item" aria-label="Correos y seguimiento" data-text-inset="0 4 0 7" style="top: 40px; left: 0; width: 30px; height: 36px"><span data-glyph style="position: absolute; top: 0; left: 40px; width: 12px; height: 12px"></span></button>
      <button class="item" aria-label="Reunión de equipo" data-text-inset="0 4 0 7" style="top: 80px; left: 0; width: 30px; height: 36px"><span data-glyph style="position: absolute; inset: 0; display: none"></span></button>
    `))
    const violations = await audit(page)
    expect(violations.filter((violation) => violation.includes('Almuerzo'))).toEqual([])
    expect(violations.some((violation) => violation.includes('"Correos y seguimiento" draws neither a word nor its glyph'))).toBe(true)
    expect(violations.some((violation) => violation.includes('"Reunión de equipo" draws neither a word nor its glyph'))).toBe(true)
  })

  test('a routine its tasks fill needs no glyph of its own; one they leave room in does', async ({ page }) => {
    await page.setContent(column(`${smallest}${glyphProbe}
      <button class="item" aria-label="Deep work" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 30px; height: 96px"></button>
      <button class="item" aria-label="Task: Report" data-layered style="top: 0; left: 0; width: 30px; height: 90px"><span data-glyph style="position: absolute; inset: 2px 5px 2px 7px"></span></button>
      <button class="item" aria-label="Correos y seguimiento" data-text-inset="0 4 0 7" style="top: 100px; left: 0; width: 30px; height: 96px"></button>
      <button class="item" aria-label="Task: Write" data-layered style="top: 100px; left: 0; width: 30px; height: 40px"><span data-glyph style="position: absolute; inset: 2px 5px 2px 7px"></span></button>
    `))
    const violations = await audit(page)
    expect(violations.filter((violation) => violation.includes('Deep work'))).toEqual([])
    expect(violations.some((violation) => violation.includes('"Correos y seguimiento" draws neither a word nor its glyph though the 12.0×12.0 px glyph fits its 18.8×56.0 px room'))).toBe(true)
  })

  // Codex review of verify7: a short conflict in a narrow lane drew the plain grey initial, hiding the conflict. A box
  // that needs the warning glyph (`data-glyph-kind="warning"`) is not satisfied by the category glyph.
  test('a conflict without its ⚠ where the ⚠ fits is reported, even when it shows the category glyph', async ({ page }) => {
    const warningProbe = '<span data-glyph-probe="warning" style="position: absolute; visibility: hidden; display: block; width: 12px; height: 12px"></span>'
    await page.setContent(column(`${smallest}${glyphProbe}${warningProbe}
      <button class="item" aria-label="Vendor call" data-glyph-kind="warning" data-text-inset="1 3 1 3" style="top: 0; left: 0; width: 26px; height: 15px"><span data-glyph style="position: absolute; inset: 1px 3px"></span></button>
      <button class="item" aria-label="Dentist" data-glyph-kind="warning" data-text-inset="1 3 1 3" style="top: 40px; left: 0; width: 26px; height: 15px"><span data-glyph="warning" style="position: absolute; inset: 1px 3px"></span></button>
      <button class="item" aria-label="Stand-up" data-glyph-kind="warning" data-text-inset="1 3 1 3" style="top: 80px; left: 0; width: 26px; height: 13px"></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.includes('"Vendor call" draws neither a word nor its warning glyph though the 12.0×12.0 px glyph fits its 19.8×13.0 px room'))).toBe(true)
    expect(violations.filter((violation) => violation.includes('Dentist') || violation.includes('Stand-up'))).toEqual([])
  })

  // P0 regression: a Week column drawn from a plan measured for another width or text size is reported (after the audit
  // has given it frames to re-plan).
  test('a column drawn from a plan for another size is reported', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 150px; height: 20px"><span>Deep work</span></button>'))
    await page.locator('[data-whole-text]').evaluate((container) => container.setAttribute('data-planned-for', '120px 16px'))
    expect(await audit(page)).toContain('<div.column> "Deep work" is drawn from a plan for 120px 16px, not its current 150px 16px')
    await page.locator('[data-whole-text]').evaluate((container) => container.setAttribute('data-planned-for', '150px 16px'))
    expect(await audit(page)).toEqual([])
  })

  // verify8: "Demo con el cliente" (74×48 at 1440) and "Sincronización semanal" (145×16 at 375) drew their titles
  // with no ⚠. A conflict needs its ⚠ wherever it fits, words or not.
  test('a conflict that draws its title but not its ⚠ where the ⚠ fits is reported', async ({ page }) => {
    const warningProbe = '<span data-glyph-probe="warning" style="position: absolute; visibility: hidden; display: block; width: 12px; height: 12px"></span>'
    await page.setContent(column(`${smallest}${glyphProbe}${warningProbe}
      <button class="item" aria-label="Demo con el cliente" data-glyph-kind="warning" data-text-inset="1 3 1 3" style="top: 0; left: 0; width: 74px; height: 48px"><span>Demo con el cliente</span></button>
      <button class="item" aria-label="Vendor call" data-glyph-kind="warning" data-text-inset="1 3 1 3" style="top: 60px; left: 0; width: 120px; height: 34px"><span data-glyph="warning" style="flex: none; width: 12px; height: 12px"></span><span>Vendor call</span></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.includes('"Demo con el cliente" draws words but not its warning glyph though the 12.0×12.0 px glyph fits its 68.0×46.0 px room'))).toBe(true)
    expect(violations.filter((violation) => violation.includes('Vendor call'))).toEqual([])
  })

  // verify8 D3: a 15-minute item (12 px at a 48 px hour) has less room than the glyph's full size but more than its
  // smallest, so it draws the glyph scaled down; a bare strip there is reported.
  test('a box with room for the smallest glyph but not the full one that draws nothing is reported', async ({ page }) => {
    const smallestGlyph = '<span data-glyph-probe="category-min" style="position: absolute; visibility: hidden; display: block; width: 10px; height: 10px"></span>'
    await page.setContent(column(`${smallest}${glyphProbe}${smallestGlyph}
      <button class="item" aria-label="Pausa activa" data-text-inset="1 3 1 3" style="top: 0; left: 0; width: 150px; height: 12px"></button>
      <button class="item" aria-label="Meditación" data-text-inset="1 3 1 3" style="top: 20px; left: 0; width: 150px; height: 12px"><span data-glyph style="position: absolute; inset: 1px 3px"></span></button>
      <button class="item" aria-label="Stand-up" data-text-inset="1 3 1 3" style="top: 40px; left: 0; width: 150px; height: 8px"></button>
    `))
    const violations = await audit(page)
    expect(violations.some((violation) => violation.includes('"Pausa activa" draws neither a word nor its glyph though the 10.0×10.0 px glyph fits its 143.8×10.0 px room'))).toBe(true)
    expect(violations.filter((violation) => violation.includes('Meditación') || violation.includes('Stand-up'))).toEqual([])
  })

  // verify10 C1: a tap 10.9 px below an 18 px task inside a routine opened the routine. Every pressable Week item can
  // be pressed in a 44 × 44 px square that is all its own.
  test('a task inside a routine with no 44 px square of its own is reported, and one with a press area over the routine is not', async ({ page }) => {
    const routine = '<button class="item" aria-label="Deep work" data-hit-key="b" style="top: 0; left: 0; width: 150px; height: 120px"><span>Deep work</span></button>'
    const task = '<button class="item" aria-label="Task: Report" data-layered data-hit-key="t" style="top: 40px; left: 4px; width: 142px; height: 18px; background: #fff"></button>'
    await page.setContent(column(`${routine}${task}`))
    expect(await pressTargets(page)).toContain('<button.item> "Task: Report" has no 44×44 px press: no such square around it is all its own, and no shared target lists it')
    await page.setContent(column(`${routine}${task}<span data-hit-for="t" style="position: absolute; top: 27px; left: 4px; width: 142px; height: 44px; z-index: 3"></span>`))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toEqual([])
  })

  test('a short item with empty time around it and no press area is reported', async ({ page }) => {
    await page.setContent(column(`
      <button class="item" aria-label="Coffee" data-hit-key="c" style="top: 100px; left: 0; width: 150px; height: 12px"></button>
      <button class="item" aria-label="Focus" data-hit-key="f" style="top: 112px; left: 0; width: 150px; height: 168px"><span>Focus</span></button>
    `))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toEqual(['<button.item> "Coffee" has no 44×44 px press: no such square around it is all its own, and no shared target lists it'])
  })

  // verify11 C1: a task with exactly the time of its routine ("Finish course module 4" in "Reading") is an outline that
  // takes no presses; where items crowd each other, a shared 44 px target that lists them all stands in.
  test('crowded items need a shared target of at least 44 × 44 px that lists each of them', async ({ page }) => {
    // Reading's own press areas above and below its 24 px box.
    const reading = '<button class="item" aria-label="Reading" data-hit-key="r" style="top: 100px; left: 0; width: 150px; height: 24px"><span>Reading</span></button>'
      + '<span data-hit-for="r" style="position: absolute; top: 90px; left: 0; width: 150px; height: 10px; z-index: 3"></span><span data-hit-for="r" style="position: absolute; top: 124px; left: 0; width: 150px; height: 10px; z-index: 3"></span>'
    const course = '<button class="item" aria-label="Task: Finish course module 4" data-layered data-hit-key="c" style="top: 100px; left: 0; width: 150px; height: 24px; pointer-events: none; background: transparent"></button>'
    const target = (items: string, height = 44) => `<span data-shared-target data-shared-items="${items}" style="position: absolute; top: 90px; left: 50px; width: 44px; height: ${height}px; z-index: 4"></span>`
    await page.setContent(column(`${reading}${course}`))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toEqual(['<button.item> "Task: Finish course module 4" has no 44×44 px press: no such square around it is all its own, and no shared target lists it'])
    await page.setContent(column(`${reading}${course}${target('r c')}`))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toEqual([])
    await page.setContent(column(`${reading}${course}${target('r')}`))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toHaveLength(1)
    await page.setContent(column(`${reading}${course}${target('r c', 30)}`))
    expect((await pressTargets(page)).filter((violation) => violation.includes(' px press'))).toHaveLength(1)
  })

  test('a container without its own glyph is held to the documented glyph size', async ({ page }) => {
    await page.setContent(column('<button class="item" title="Abstimmungsgespräch" data-text-inset="0 4 0 7" style="top: 0; left: 0; width: 30px; height: 40px"></button>'))
    expect((await audit(page)).some((violation) => violation.includes('glyph fits its 18.8×40.0 px room'))).toBe(true)
  })

  test('outside a whole-text container an ellipsis is still a deliberate truncation', async ({ page }) => {
    await page.setContent(column('<button class="item" style="top: 0; left: 0; width: 60px; height: 20px"><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">Vendor call</span></button>').replace(' data-whole-text', ''))
    expect(await audit(page)).toEqual([])
  })
})

// Codex review: the name check once compared a hidden routine's aria-label with itself. It now takes the title from the
// seeded week by id, so a routine whose name lost its title is reported even when nothing of it is drawn.
test('a Week item whose accessible name lacks its seeded title is reported, drawn or not', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the checker self-test runs once')
  await page.setContent(`<div class="day-column">
    <button data-block-id="b-work" aria-label="9:00 AM – 11:00 AM Work"></button>
    <button data-block-id="b-gym" aria-label="Gym 6:00 PM – 7:00 PM"><span>Gym</span></button>
    <button data-event-id="e-vendor" title="Vendor call"><span aria-hidden="true">Vendor…</span><span>Vendor</span></button>
    <button data-task-id="t-report" aria-label="Task: Write the quarterly report, 9:00 AM – 9:20 AM"></button>
  </div>`)
  const titles = { blocks: { 'b-work': 'Deep work', 'b-gym': 'Gym' }, events: { 'e-vendor': 'Vendor call' }, tasks: { 't-report': 'Write the quarterly report' } }
  expect(await itemsMissingTitles(page, titles)).toEqual({ checked: 4, missing: [
    'block b-work: "9:00 AM – 11:00 AM Work" does not name "Deep work"',
    'event e-vendor: "Vendor" does not name "Vendor call"',
  ] })
})

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
    // The field is drawn over the button's centre too, which the covered-control rule reports as well.
    expect((await visualIntegrityViolations(page, { focusRings: false })).sort()).toEqual([
      '<button.close> "Close" is covered at its centre by <input> "Name"',
      '<button.close> "Close" overlaps <input> "Name"',
    ])
  })

  test('a field only partly scrolled out still collides through the part that shows', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(stage(30, fiveFields))
    await page.locator('.body').evaluate((element) => { element.scrollTop = 20 })
    // The second field then sits 6 px under the button, which the spacing rule reports too; only overlaps matter here.
    const overlaps = (await visualIntegrityViolations(page, { focusRings: false })).filter((violation) => violation.includes(' overlaps '))
    expect(overlaps).toEqual([
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

  test('a popover menu over a control below its trigger is a layer, not an overlap', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; font: 16px sans-serif; } .row { position: relative; height: 44px; } button { height: 44px; }</style>
      <div class="row"><button>More</button><div role="menu" style="position: absolute; top: 44px; left: 0; width: 160px; background: #fff"><button role="menuitem" style="width: 160px">Partly</button></div></div>
      <div class="row"><button>Done</button></div>`)
    expect((await visualIntegrityViolations(page, { focusRings: false })).filter((violation) => violation.includes(' overlaps '))).toEqual([])
  })

  test('a back link that runs under a toolbar button is reported', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; font: 16px sans-serif; } .bar { position: relative; width: 320px; height: 44px; } a { position: absolute; top: 0; height: 44px; }</style>
      <div class="bar"><a href="#back" style="left: 16px; width: 200px">Back to Summary</a><a href="#ai" aria-label="Assistant" style="left: 180px; width: 44px">*</a></div>`)
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual(['<a> "Back to Summary" overlaps <a> "Assistant"'])
  })

  test('a control covered at its centre by something of its own layer is reported, not one scrolled under a fixed bar', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; font: 16px sans-serif; } .card { position: relative; margin: 16px; padding: 16px; width: 240px; } .cover { position: absolute; inset: 0; } .bar { position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: #eee; }</style>
      <div class="card"><a href="#go" style="display: inline-block; padding: 12px">Tagesabschluss machen</a><div class="cover"></div></div>
      <div style="height: 2000px"></div><div class="bar"></div>`)
    expect((await visualIntegrityViolations(page, { focusRings: false })).some((violation) => violation.startsWith('<a> "Tagesabschluss machen" is covered at its centre by <div.cover>'))).toBe(true)
    await page.locator('.cover').evaluate((cover) => cover.remove())
    await page.locator('.card').evaluate((card) => { card.style.marginTop = '600px' })
    await page.evaluate(() => window.scrollTo(0, 60))
    expect((await visualIntegrityViolations(page, { focusRings: false })).filter((violation) => violation.includes('covered at its centre'))).toEqual([])
  })

  test('two layered controls on each other are reported even inside their host', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; } .host { position: absolute; left: 10px; top: 10px; width: 200px; height: 100px; } .task { position: absolute; left: 20px; top: 30px; width: 100px; height: 30px; padding: 0; }</style>
      <button class="host">Deep work</button><button class="task" data-layered>Report</button><button class="task" data-layered>Form</button>`)
    const violations = await visualIntegrityViolations(page, { focusRings: false })
    // Their words are drawn on each other too, which the run-together rule reports as well.
    expect(violations.filter((violation) => !violation.startsWith('text "Report" and text "Form" run together')).sort()).toEqual([
      '<button.task> "Report" is covered at its centre by <button.task> "Form"',
      '<button.task> "Report" overlaps <button.task> "Form"',
    ])
  })

  test('a control that is not marked as layered is reported even when it lies inside another', async ({ page }, testInfo) => {
    phoneOnly(testInfo)
    await page.setContent(`
      <style>body { margin: 0; } .host { position: absolute; left: 10px; top: 10px; width: 200px; height: 100px; } .task { position: absolute; left: 20px; top: 30px; width: 100px; height: 44px; }</style>
      <button class="host">Deep work</button><button class="task">Report</button>`)
    expect((await visualIntegrityViolations(page, { focusRings: false })).sort()).toEqual([
      '<button.host> "Deep work" is covered at its centre by <button.task> "Report"',
      '<button.host> "Deep work" overlaps <button.task> "Report"',
    ])
  })
})


// The spacing rules of docs/design/visual-design.md › Spacing. Each "is reported" case fails when its rule is removed.
test.describe('visual integrity guard: spacing', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  const spacingStage = (body: string, style = '') => `
    <style>
      body { margin: 0; padding: 40px; font: 16px/24px sans-serif; background: #f2f2f7; }
      button { box-sizing: border-box; height: 44px; margin: 0; border: 0; padding: 0 12px; font: inherit; background: #ddd; }
      .card { box-sizing: border-box; width: 300px; border-radius: 14px; background: #fff; }
      ${style}
    </style>${body}`
  const audit = (page: Page) => visualIntegrityViolations(page, { focusRings: false })

  for (const [gap, reported] of [[4, true], [8, false], [2, false]] as const) {
    test(`two buttons ${gap} px apart are ${reported ? 'reported' : 'accepted'}`, async ({ page }) => {
      await page.setContent(spacingStage(`<div style="display: flex; gap: ${gap}px"><button>One</button><button>Two</button></div>`))
      const message = `<button> "One" and <button> "Two" are ${gap.toFixed(1)}px apart (joined is at most 2px, apart at least 8.0px)`
      if (reported) expect(await audit(page)).toEqual([message])
      else expect(await audit(page)).toEqual([])
    })
  }

  test('stacked buttons 4 px apart are reported', async ({ page }) => {
    await page.setContent(spacingStage('<button style="display: block">One</button><button style="display: block; margin-top: 4px">Two</button>'))
    expect(await audit(page)).toEqual(['<button> "One" and <button> "Two" are 4.0px apart (joined is at most 2px, apart at least 8.0px)'])
  })

  test('chips drawn by the labels of transparent checkboxes are measured by their labels', async ({ page }) => {
    await page.setContent(spacingStage(`
      <div style="display: flex; gap: 4px">
        <label class="chip"><input type="checkbox" aria-label="Mon">Mon</label>
        <label class="chip"><input type="checkbox" aria-label="Tue">Tue</label>
      </div>`, `
      .chip { position: relative; display: inline-flex; align-items: center; height: 44px; padding: 0 12px; background: #ddd; }
      .chip input { position: absolute; inset: 0; margin: 0; opacity: 0; }`))
    expect(await audit(page)).toEqual(['<label.chip> "Mon" and <label.chip> "Tue" are 4.0px apart (joined is at most 2px, apart at least 8.0px)'])
  })

  test('blocks placed on a time axis are not spaced by layout', async ({ page }) => {
    await page.setContent(spacingStage(`
      <div style="position: relative; height: 200px">
        <button style="position: absolute; top: 0; width: 200px">Work</button>
        <button style="position: absolute; top: 48px; width: 200px">Meeting</button>
      </div>`))
    expect(await audit(page)).toEqual([])
  })

  test('a control scrolled up to a bar outside its scroller is not spaced by layout', async ({ page }) => {
    await page.setContent(spacingStage(`
      <div style="display: flex; flex-direction: column; height: 300px">
        <div style="flex: none; height: 46px"><button>Close</button></div>
        <div class="scroller" style="flex: 1; overflow-y: auto"><div style="height: 52px"></div><button style="display: block">Card</button><div style="height: 400px"></div></div>
      </div>`))
    await page.locator('.scroller').evaluate((element) => { element.scrollTop = 48 })
    expect(await audit(page)).toEqual([])
  })

  test('the control gap follows the --control-gap token', async ({ page }) => {
    await page.setContent(spacingStage('<div style="display: flex; gap: 8px"><button>One</button><button>Two</button></div>', ':root { --control-gap: 12px; }'))
    expect(await audit(page)).toEqual(['<button> "One" and <button> "Two" are 8.0px apart (joined is at most 2px, apart at least 12.0px)'])
  })

  test('text of a full-width row closer to its card edge than the card padding is reported', async ({ page }) => {
    await page.setContent(spacingStage('<ul class="card" style="padding: 0; list-style: none"><li><button class="row">Row title</button></li></ul>', `
      .row { display: block; width: 100%; height: auto; min-height: 48px; padding: 12px 8px; background: transparent; text-align: start; }`))
    expect(await audit(page)).toContain('text "Row title" in <button.row> "Row title" is 8.0px from the left edge of the card <ul.card> "Row title" (card padding 16.0px)')
  })

  test('a row with the card padding is accepted', async ({ page }) => {
    await page.setContent(spacingStage('<ul class="card" style="padding: 0; list-style: none"><li><button class="row">Row title</button></li></ul>', `
      .row { display: block; width: 100%; height: auto; min-height: 48px; padding: 12px 16px; background: transparent; text-align: start; }`))
    expect(await audit(page)).toEqual([])
  })

  test('a card padded less than the token is reported even though its content respects that padding', async ({ page }) => {
    await page.setContent(spacingStage('<section class="card" style="padding: 8px"><p>Now</p><button>Done</button></section>'))
    const found = await audit(page)
    expect(found).toContain('text "Now" in <p> "Now" is 8.0px from the left edge of the card <section.card> "NowDone" (card padding 16.0px)')
    expect(found).toContain('<button> "Done" is 8.0px from the left edge of the card <section.card> "NowDone" (card padding 16.0px)')
  })

  test('the card padding follows the --card-padding token (20 px on wide windows)', async ({ page }) => {
    await page.setContent(spacingStage('<section class="card" style="padding: 16px"><p>Now</p></section>', ':root { --card-padding: 20px; }'))
    expect(await audit(page)).toContain('text "Now" in <p> "Now" is 16.0px from the left edge of the card <section.card> "Now" (card padding 20.0px)')
  })

  test('a popover that opens above its row belongs to no card', async ({ page }) => {
    await page.setContent(spacingStage(`
      <ul class="card" style="margin-top: 120px; padding: 0 16px; list-style: none"><li style="position: relative; padding: 12px 0">Deep work
        <div role="group" aria-label="Minutes" style="position: absolute; bottom: 100%; right: 0; padding: 12px; border-radius: 14px; background: #fff; box-shadow: 0 4px 16px rgba(0, 0, 0, .2)"><button>Save</button></div>
      </li></ul>`))
    expect(await audit(page)).toEqual([])
  })

  test('pills and plain wrappers are not cards', async ({ page }) => {
    await page.setContent(spacingStage('<div style="padding: 0"><p style="display: inline-block; padding: 4px 8px; border-radius: 999px; background: #fff">Badge</p></div>'))
    expect(await audit(page)).toEqual([])
  })

  const squeezed = (extra: string) => spacingStage(`<div class="row"><span class="icon"></span><span class="name">Exercise</span></div>`, `
    .row { display: flex; width: 120px; gap: 8px; font-size: 24px; line-height: 30px; }
    .icon { flex: none; width: 70px; height: 20px; background: #ccc; }
    .name { min-width: 0; overflow-wrap: anywhere; ${extra} }`)

  // The Week grid header at 1024 px and 200 % text drew "MONTUEWED": each label fit nothing but its own cell.
  test('labels of neighbouring cells drawn edge to edge are reported as running together', async ({ page }) => {
    await page.setContent(`<style>body { margin: 0; font: 24px/1.2 sans-serif; } .row { display: grid; grid-template-columns: repeat(3, 40px); margin: 16px; } .row span { text-align: center; }</style>
      <div class="row"><span>MON</span><span>TUE</span><span>WED</span></div>`)
    expect((await visualIntegrityViolations(page, { focusRings: false })).some((violation) => /text "MON" and text "TUE" run together/.test(violation))).toBe(true)
  })

  test('labels of neighbouring cells with space between them are accepted', async ({ page }) => {
    await page.setContent(`<style>body { margin: 0; font: 12px/1.2 sans-serif; } .row { display: grid; grid-template-columns: repeat(3, 40px); margin: 16px; } .row span { text-align: center; }</style>
      <div class="row"><span>MON</span><span>TUE</span><span>WED</span></div>`)
    expect(await visualIntegrityViolations(page, { focusRings: false })).toEqual([])
  })

  test('a word cut mid-word in a squeezed flex item, though its row could hold it, is reported', async ({ page }) => {
    await page.setContent(squeezed(''))
    const found = await audit(page)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^the word "Exercise" in <span\.name> "Exercise" breaks mid-word though a line has room for it \([\d.]+px of 120\.0px\)$/)
  })

  test('a word hyphenated in the page language is accepted', async ({ page }) => {
    await page.setContent(squeezed('hyphens: auto;'))
    await page.evaluate(() => { document.documentElement.lang = 'en' })
    expect(await audit(page)).toEqual([])
  })

  test('a word that only a button\'s own padding keeps from fitting may break', async ({ page }) => {
    await page.setContent(spacingStage('<div style="display: flex; width: 200px"><button style="height: auto; padding: 4px 70px; font-size: 24px; line-height: 1.5; overflow-wrap: anywhere">Wochenende</button></div>'))
    expect(await audit(page)).toEqual([])
  })

  test('a word wider than any line may break', async ({ page }) => {
    await page.setContent(spacingStage('<p style="width: 60px; font-size: 24px; overflow-wrap: anywhere">Tagesabschluss</p>'))
    expect(await audit(page)).toEqual([])
  })

  for (const [gap, reported] of [[24, true], [32, false]] as const) {
    test(`page sections ${gap} px apart are ${reported ? 'reported' : 'accepted'}`, async ({ page }) => {
      await page.setContent(spacingStage(`<section class="card" style="padding: 16px">First</section><section class="card" style="padding: 16px; margin-top: ${gap}px">Second</section>`))
      const message = `<section.card> "First" and the section below it <section.card> "Second" are ${gap.toFixed(1)}px apart (sections at least 32.0px)`
      if (reported) expect(await audit(page)).toEqual([message])
      else expect(await audit(page)).toEqual([])
    })
  }

  test('sections wrapped in other elements are still measured to the nearest one below', async ({ page }) => {
    await page.setContent(spacingStage('<div><section class="card" style="padding: 16px">First</section></div><div style="margin-top: 16px"><div><section class="card" style="padding: 16px">Second</section></div></div>'))
    expect(await audit(page)).toEqual(['<section.card> "First" and the section below it <section.card> "Second" are 16.0px apart (sections at least 32.0px)'])
  })

  test('sections side by side and sections inside a sheet are not page sections in a column', async ({ page }) => {
    await page.setContent(spacingStage(`
      <div style="display: flex; gap: 8px"><section class="card" style="width: 140px; padding: 16px">Left</section><section class="card" style="width: 140px; padding: 16px">Right</section></div>
      <div role="dialog"><section style="padding: 16px">One</section><section style="padding: 16px">Two</section></div>`))
    expect(await audit(page)).toEqual([])
  })
})

// The setup's Send (and its summary's button) is the conversation's call to action: the owner asked for air around it
// (2026-10-25). Its clear space is the group gap from any other control, and its bar keeps 16 px under it.
test.describe('visual integrity guard: the docked primary action', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  const dockStage = ({ gap = 24, bottom = 16, top = 24, answers = '', style = '', marked = true }: { gap?: number; bottom?: number; top?: number; answers?: string; style?: string; marked?: boolean }) => `
    <style>
      body { margin: 0; font: 16px/24px sans-serif; background: #fff; }
      button { box-sizing: border-box; height: 48px; margin: 0; border: 0; padding: 0 16px; font: inherit; background: #ddd; }
      .frame { position: fixed; inset: 0; display: flex; flex-direction: column; }
      .talk { flex: 1; }
      .answers { flex: 0 1 auto; max-height: 120px; overflow-y: auto; padding: 0 16px; }
      .actions { display: flex; justify-content: space-between; gap: ${gap}px; padding: ${top}px 16px ${bottom}px; }
      ${style}
    </style>
    <div class="frame"><div class="talk"></div>${answers}<div class="actions"><button>Later</button><button ${marked ? 'data-dock-primary' : ''}>Send</button></div></div>`
  const audit = (page: Page) => visualIntegrityViolations(page, { focusRings: false })

  for (const [gap, reported] of [[12, true], [24, false]] as const) {
    test(`a control ${gap} px beside the docked primary is ${reported ? 'reported' : 'accepted'}`, async ({ page }) => {
      await page.setContent(dockStage({ gap, style: '.actions { justify-content: flex-end }' }))
      const message = `<button> "Later" is ${gap.toFixed(1)}px from the docked primary <button> "Send" (clear space at least 24.0px)`
      if (reported) expect(await audit(page)).toEqual([message])
      else expect(await audit(page)).toEqual([])
    })
  }

  for (const [bottom, reported] of [[8, true], [16, false]] as const) {
    test(`a docked primary ${bottom} px above the bottom edge is ${reported ? 'reported' : 'accepted'}`, async ({ page }) => {
      await page.setContent(dockStage({ bottom }))
      const message = `the docked primary <button> "Send" is ${bottom.toFixed(1)}px from the bottom edge (at least 16.0px)`
      if (reported) expect(await audit(page)).toEqual([message])
      else expect(await audit(page)).toEqual([])
    })
  }

  test('an answer in the scroller above, cut by its edge 12 px over the primary, is reported', async ({ page }) => {
    const answers = '<div class="answers"><button style="display: block; width: 100%">Yes</button><div style="height: 8px"></div><button style="display: block; width: 100%">No</button><div style="height: 8px"></div><button style="display: block; width: 100%">Maybe</button></div>'
    await page.setContent(dockStage({ top: 12, answers, style: '.actions { justify-content: flex-end } .actions button:first-child { display: none }' }))
    const violations = await audit(page)
    expect(violations).toEqual(['<button> "Maybe" is 12.0px from the docked primary <button> "Send" (clear space at least 24.0px)'])
    await page.setContent(dockStage({ top: 24, answers, style: '.actions { justify-content: flex-end } .actions button:first-child { display: none }' }))
    expect(await audit(page)).toEqual([])
  })

  test('the clear space follows the --group-gap token', async ({ page }) => {
    await page.setContent(dockStage({ gap: 24, style: ':root { --group-gap: 32px; } .actions { justify-content: flex-end }' }))
    expect(await audit(page)).toEqual(['<button> "Later" is 24.0px from the docked primary <button> "Send" (clear space at least 32.0px)'])
  })

  test('a button that is not marked as the docked primary keeps only the control gap', async ({ page }) => {
    await page.setContent(dockStage({ gap: 12, bottom: 8, marked: false }))
    expect(await audit(page)).toEqual([])
  })
})

// The owner (2026-10-25): "Para textos así, es mejor por diseño, que se vea en una sola línea". A label and its value
// share one line at 100 % text from 360 px; at larger text the row may wrap.
test.describe('visual integrity guard: label and value rows on one line', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  const rowStage = (width: number, value = '7:00 (al día siguiente)', style = '') => `
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { margin: 0; padding: 16px; font: 17px/22px sans-serif; background: #fff; }
      .row { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 12px; width: ${width}px; min-height: 48px; border: 0; padding: 0; background: none; font: inherit; text-align: start; }
      .hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      ${style}
    </style>
    <button class="row" data-one-line><span>Me levanto</span><span class="value">${value}</span></button>`
  const audit = (page: Page) => visualIntegrityViolations(page, { focusRings: false })
  const wraps = expect.stringMatching(/^the row <button\.row> ".*" breaks onto more than one line \(a label and its value share one line at 100 % text from 360 px\)$/)

  test('a value pushed under its label is reported', async ({ page }) => {
    await page.setContent(rowStage(180))
    expect(await audit(page)).toEqual([wraps])
  })

  test('a value that breaks inside itself beside its label is reported', async ({ page }) => {
    await page.setContent(rowStage(230, '7:00 (al día siguiente)', '.row { flex-wrap: nowrap } .value { min-width: 0; text-align: end }'))
    expect(await audit(page)).toEqual([wraps])
  })

  test('label and value on one line are accepted, and a visually hidden "(next day)" is not drawn text', async ({ page }) => {
    await page.setContent(rowStage(200, '7:00<span class="hidden"> (al día siguiente)</span>'))
    expect(await audit(page)).toEqual([])
  })

  test('at 200 % text the row may wrap', async ({ page }) => {
    await page.setContent(rowStage(180, '7:00 (al día siguiente)', ':root { font-size: 200% }'))
    expect(await audit(page)).toEqual([])
  })

  test('below 360 px the row may wrap', async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 700 })
    await page.setContent(rowStage(180))
    expect(await audit(page)).toEqual([])
  })
})

// The owner's report (2026-10-25, moto g75): Week's "+" floated about 76 px over the tab bar, mid-screen over the grid.
// Material 3 places a FAB 16 px above the bar under it and 16 px from the trailing edge (24 px from 600 px).
test.describe('visual integrity guard: floating action button', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the guard self-tests run once')
  })

  type Stage = { fab?: string; tabbar?: string | null; toast?: string; menu?: string }
  const fabStage = ({ fab = 'right: 16px; bottom: 72px', tabbar = 'height: 56px', toast, menu }: Stage = {}) => `
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <style>
      body { margin: 0; font: 16px sans-serif; }
      .tabbar { position: fixed; inset: auto 0 0; box-sizing: border-box; background: #eee; }
      .fab { position: fixed; box-sizing: border-box; width: 56px; height: 56px; border: 0; border-radius: 50%; padding: 0; background: #147745; }
      .toast { position: fixed; inset-inline: 16px; bottom: 68px; height: 52px; background: #fff; }
      .menu { position: fixed; right: 16px; width: 200px; height: 150px; background: #fff; }
    </style>
    ${tabbar === null ? '' : `<nav class="tabbar" style="${tabbar}"></nav>`}
    ${toast === undefined ? '' : `<div class="toast" data-testid="undo-toast" style="${toast}">Deleted</div>`}
    <button class="fab" data-fab aria-label="Add" ${menu === undefined ? 'aria-expanded="false"' : 'aria-expanded="true" aria-controls="fab-menu"'} style="${fab}"></button>
    ${menu === undefined ? '' : `<div id="fab-menu" class="menu" role="menu" style="${menu}"></div>`}`
  const audit = (page: Page) => visualIntegrityViolations(page, { focusRings: false })
  const insets = async (page: Page, bottom: number, right = 0) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 0, left: 0, bottom, right } } as never)
  }

  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }) })

  test('a 56 px button 16 px above the tab bar and 16 px from the edge is accepted', async ({ page }) => {
    await page.setContent(fabStage())
    expect(await audit(page)).toEqual([])
  })

  test('a button floating 76 px above the tab bar is reported', async ({ page }) => {
    await page.setContent(fabStage({ fab: 'right: 16px; bottom: 132px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is 76.0px above the tab bar, not 16px'])
  })

  test('a button 32 px from the trailing edge is reported', async ({ page }) => {
    await page.setContent(fabStage({ fab: 'right: 32px; bottom: 72px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is 32.0px from the screen\'s trailing edge, not 16.0px (16px + 0.0px safe area)'])
  })

  test('a button that grew with the text (112 px at 200 %) is reported', async ({ page }) => {
    await page.setContent(fabStage({ fab: 'right: 16px; bottom: 72px; width: 112px; height: 112px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is 112.0x112.0px, not 56x56px'])
  })

  test('with a bottom safe area the tab bar already includes it: 16 px above the bar is accepted, adding it again is reported', async ({ page }) => {
    await insets(page, 24)
    await page.setContent(fabStage({ tabbar: 'height: 80px; padding-bottom: 24px', fab: 'right: 16px; bottom: 96px' }))
    expect(await audit(page)).toEqual([])
    await page.setContent(fabStage({ tabbar: 'height: 80px; padding-bottom: 24px', fab: 'right: 16px; bottom: 120px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is 40.0px above the tab bar, not 16px'])
  })

  test('a trailing safe area is added to the edge margin', async ({ page }) => {
    await insets(page, 0, 20)
    await page.setContent(fabStage({ fab: 'right: 16px; bottom: 72px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is 16.0px from the screen\'s trailing edge, not 36.0px (16px + 20.0px safe area)'])
    await page.setContent(fabStage({ fab: 'right: 36px; bottom: 72px' }))
    expect(await audit(page)).toEqual([])
  })

  test('with no tab bar the button keeps the margin from the bottom safe area', async ({ page }) => {
    await insets(page, 24)
    await page.setContent(fabStage({ tabbar: null, fab: 'right: 16px; bottom: 40px' }))
    expect(await audit(page)).toEqual([])
    await page.setContent(fabStage({ tabbar: null, fab: 'right: 16px; bottom: 16px' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is -8.0px above the bottom safe area, not 16px'])
  })

  test('the button stacks above the undo toast instead of covering it', async ({ page }) => {
    await page.setContent(fabStage({ toast: '' }))
    expect(await audit(page)).toEqual(['the floating button "Add" is -48.0px above the undo toast, not 16px'])
    await page.setContent(fabStage({ toast: '', fab: 'right: 16px; bottom: 136px' }))
    expect(await audit(page)).toEqual([])
  })

  test('from 600 px the margins are 24 px', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 900 })
    await page.setContent(fabStage())
    expect(await audit(page)).toEqual([
      'the floating button "Add" is 16.0px from the screen\'s trailing edge, not 24.0px (24px + 0.0px safe area)',
      'the floating button "Add" is 16.0px above the tab bar, not 24px',
    ])
  })

  test('a button set back under an open modal sheet is not audited', async ({ page }) => {
    await page.setContent(`${fabStage({ fab: 'right: 32px; bottom: 132px' })}<div role="dialog" aria-modal="true" aria-label="Sheet" tabindex="-1" style="position: fixed; inset: 40px 0 0; background: #fff"></div>`)
    // Focus is in the open sheet, as the app keeps it (checkModalFocus).
    await page.locator('[role="dialog"]').focus()
    expect(await audit(page)).toEqual([])
  })

  test('an open menu 8 px above the button and on screen is accepted; closer, or off the top, is reported', async ({ page }) => {
    // The button's top is at 844 - 72 - 56 = 716.
    await page.setContent(fabStage({ menu: 'top: 558px' }))
    expect(await audit(page)).toEqual([])
    await page.setContent(fabStage({ menu: 'top: 562px' }))
    expect(await audit(page)).toEqual(['the menu of "Add" is 4.0px above it, less than 8px'])
    await page.setContent(fabStage({ menu: 'top: -20px' }))
    expect(await audit(page)).toEqual(['the menu of "Add" leaves the screen (174.0, -20.0, 374.0, 130.0 in 390x844)'])
  })
})

// Week's "+" on the phones the owner and testers use, closed and open: the placement rule alone, so a failure names it.
test.describe('Week\'s floating "+" on phones', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone widths only')
  })

  const PHONES = [
    { name: '390x844', width: 390, height: 844, safeBottom: 0, text: '100%' },
    { name: '360x800', width: 360, height: 800, safeBottom: 0, text: '100%' },
    { name: '412x915 with a 24 px home indicator', width: 412, height: 915, safeBottom: 24, text: '100%' },
    { name: '320x640 at 200 % text', width: 320, height: 640, safeBottom: 0, text: '200%' },
  ] as const

  for (const phone of PHONES) {
    test(`${phone.name}: 16 px above the tab bar and the edge, its menu on screen`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height })
      if (phone.safeBottom) {
        const session = await page.context().newCDPSession(page)
        await session.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 0, left: 0, right: 0, bottom: phone.safeBottom } } as never)
      }
      if (phone.text !== '100%') await page.addInitScript((size) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = size }) }, phone.text)
      await start(page, 'light', { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }, 'es')
      await open(page, 'week')
      const add = page.getByTestId('week-add')
      await expect(add).toHaveAttribute('data-fab', 'true')
      const tabbar = (await page.locator('.tabbar').boundingBox())!
      expect(tabbar.height, 'the tab bar includes the home indicator').toBeCloseTo(56 * (phone.text === '200%' ? 2 : 1) + phone.safeBottom, 0)
      expect(await page.evaluate(auditFloatingActionButtonInPage), `${phone.name}, closed`).toEqual([])
      await add.click()
      await expect(page.getByRole('menu')).toBeVisible()
      await settle(page)
      expect(await page.evaluate(auditFloatingActionButtonInPage), `${phone.name}, open`).toEqual([])
      const last = page.getByRole('menuitem').last()
      // At 100 % text every entry shows at once; at 200 % text on 320 px the menu scrolls rather than leave the screen.
      if (phone.text === '100%') expect(await page.getByRole('menu').evaluate((menu) => menu.scrollHeight <= menu.clientHeight)).toBe(true)
      else await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport({ ratio: 1 })
    })
  }

  // Review of 170d7c7: at enlarged text the banners sat --space-3 (24 px at 200 %) above the bar while their published
  // height added a fixed 12 px, so "+" came within 4 px of an "update available" notice.
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 640 }] as const) {
    for (const text of ['100%', '200%', '300%'] as const) {
      test(`${size.width}x${size.height} at ${text} text: 16 px above a status banner`, async ({ page }) => {
        await page.setViewportSize(size)
        if (text !== '100%') await page.addInitScript((value) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = value }) }, text)
        await start(page, 'light', { ...plannedDocument, settings: { ...plannedDocument.settings, locale: 'es' } }, 'es')
        await open(page, 'week')
        await page.evaluate(() => { const channel = new BroadcastChannel('next168'); channel.postMessage({ type: 'update-available' }); channel.close() })
        await expect(page.getByTestId('update-banner')).toBeVisible()
        await settle(page)
        // The button is the whole anchor: no text line around it whose baseline (font-dependent) could lift it.
        expect((await page.locator('.fab-anchor').boundingBox())!.height, 'the anchor is the button').toBeCloseTo(56, 0)
        // The banner's text can reflow a frame after it appears; "+" then glides 0.2 s to its new place.
        await expect.poll(() => page.evaluate(() => document.querySelector('.banners')!.getBoundingClientRect().top - document.querySelector('[data-fab]')!.getBoundingClientRect().bottom), { message: 'measured from the banner itself' }).toBeCloseTo(16, 0)
        await settle(page)
        expect(await page.evaluate(auditFloatingActionButtonInPage), `${text}, banner`).toEqual([])
      })
    }
  }
})
