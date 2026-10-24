import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { onboardedDocument } from './support/seed'
import { visualIntegrityViolations } from './support/visualIntegrity'

// The pieces each UX slice left for the integration, wired across screens, in Spanish (es-CO) at a phone and a
// desktop width, light and dark: "Configurar mi semana" in the empty Today and Week, the assistant as one
// toolbar icon on Today and Insights, the check-in's back control, the free-hours badge in the Week header,
// and Insights' week split, whose free figure is the badge's.
test.use({ locale: 'es-CO' })
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test; one project is enough')
})

// Wednesday 2026-10-21 10:15 UTC: 58 h 15 min of the week are behind, 109 h 45 min ahead.
const NOW = new Date('2026-10-21T10:15:00.000Z')
const SIZES = { phone: { width: 375, height: 812 }, desktop: { width: 1440, height: 900 } } as const
const THEMES = ['light', 'dark'] as const

const work = { id: 'c-work', name: 'Trabajo', colorKey: 'blue', icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } }
const sleep = { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } }
const planned = onboardedDocument({
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [sleep, work],
  blocks: [
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
    { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  ],
})
const emptyWeek = onboardedDocument({ settings: planned.settings, categories: [sleep, work] })

async function start(page: Page, size: keyof typeof SIZES, theme: (typeof THEMES)[number], document: unknown): Promise<void> {
  await page.setViewportSize(SIZES[size])
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedKey(page, V2_KEY, JSON.stringify(document))
}

async function open(page: Page, view: string, title: string): Promise<void> {
  await page.goto(`./#/${view}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

async function audit(page: Page, state: string): Promise<void> {
  expect.soft(await visualIntegrityViolations(page), state).toEqual([])
}

const hoursIn = (text: string) => /(\d+(?:,\d)?) h/.exec(text)?.[1]

for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  for (const theme of THEMES) {
    test.describe(`${size} ${theme}`, () => {
      test('empty Today and Week offer "Configurar mi semana", which reopens the wizard', async ({ page }) => {
        await start(page, size, theme, emptyWeek)
        await open(page, 'today', 'Hoy')
        const prompt = page.getByRole('button', { name: 'Configurar mi semana · 1 min' })
        await expect(prompt).toBeVisible()
        await expect(page.getByRole('link', { name: 'Planifica tu semana' })).toHaveCount(0)
        await audit(page, `${size}/${theme}/empty Today`)

        await open(page, 'week', 'Semana')
        await expect(prompt).toBeVisible()
        await expect(page.getByRole('button', { name: 'Añadir un bloque' })).toBeVisible()
        await audit(page, `${size}/${theme}/empty Week`)

        await prompt.click()
        await expect(page.getByTestId('onboarding')).toBeVisible()
      })

      test('the assistant is one toolbar icon on Today and Insights', async ({ page }) => {
        await start(page, size, theme, planned)
        for (const [view, title] of [['today', 'Hoy'], ['insights', 'Análisis']] as const) {
          await open(page, view, title)
          const entry = page.locator('#toolbar-actions').getByRole('link', { name: 'Preguntar al asistente' })
          await expect(entry).toBeVisible()
          await expect(page.locator('#main').getByRole('link', { name: 'Preguntar al asistente' })).toHaveCount(1)
          const box = (await entry.boundingBox())!
          expect(box.width).toBeGreaterThanOrEqual(44)
          expect(box.height).toBeGreaterThanOrEqual(44)
          await audit(page, `${size}/${theme}/${view} toolbar`)
        }
        await page.locator('#toolbar-actions').getByRole('link', { name: 'Preguntar al asistente' }).click()
        await expect(page).toHaveURL(/#\/assistant$/)
      })

      test('the check-in has a back control that returns to where it was opened from', async ({ page }) => {
        await start(page, size, theme, planned)
        await open(page, 'today', 'Hoy')
        await page.goto('./#/checkin')
        await expect(page.getByRole('heading', { level: 1, name: 'Cierre del día' })).toBeVisible()
        const back = page.getByRole('link', { name: 'Volver a Hoy' })
        await expect(back).toBeVisible()
        await audit(page, `${size}/${theme}/check-in with back`)
        await back.click()
        await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
      })

      test('Week and Insights say the free hours of Today\'s badge, from one source', async ({ page }) => {
        await start(page, size, theme, planned)
        await open(page, 'today', 'Hoy')
        const todayBadge = (await page.getByTestId('free-hours').textContent())!
        // Mon 00:00 → Wed 10:15 is past (58 h 15 min). Of the 109 h 45 min ahead, blocks cover 55 h 45 min: today's work
        // to 17:00 (6 h 45 min), Thu and Fri work (16 h), four nights of sleep (32 h) and Sunday night up to Monday 00:00 (1 h).
        expect(hoursIn(todayBadge)).toBe('54')
        expect(todayBadge).toBe('54 h libres esta semana')

        await open(page, 'week', 'Semana')
        const slot = page.getByTestId('week-free-hours-slot')
        await expect(slot.getByTestId('free-hours')).toHaveText(todayBadge)
        await audit(page, `${size}/${theme}/week header badge`)
        await page.getByRole('button', { name: 'Semana siguiente' }).click()
        await expect(slot.getByTestId('free-hours')).toHaveCount(0)
        await page.getByRole('button', { name: 'Hoy', exact: true }).click()
        await expect(slot.getByTestId('free-hours')).toHaveText(todayBadge)

        await open(page, 'insights', 'Análisis')
        // The "this week, from now" card is gone; one live line says the same figure the badge does.
        await expect(page.getByTestId('week-split')).toHaveCount(0)
        await expect(page.getByTestId('free-hours-live')).toHaveText(`Esta semana te quedan ${hoursIn(todayBadge)} h libres.`)
        await audit(page, `${size}/${theme}/insights live line`)
      })
    })
  }
}
