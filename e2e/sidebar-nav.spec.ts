import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedOnboarded } from './support/seed'

// O1, O4 and NV1 (UX review 2026-10-24): a sidebar people can hide on desktop and tablet, one 720 px measure,
// and the assistant and Settings in the same place, in the same order, on every tab.
test.use({ locale: 'es-CO' })

const THEMES = ['light', 'dark'] as const
const TAB_NAMES = ['Hoy', 'Semana', 'Tareas', 'Análisis'] as const
const TAB_ROUTES = ['today', 'week', 'tasks', 'insights'] as const
const MEASURE = 720

async function start(page: Page, theme: (typeof THEMES)[number], route = 'today'): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript(() => window.localStorage.setItem('next168-language', 'es'))
  await seedOnboarded(page, { settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' } })
  await page.goto(`./#/${route}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await settle(page)
}

async function settle(page: Page): Promise<void> {
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

const sidebar = (page: Page) => page.locator('#app-sidebar')
const toggle = (page: Page) => page.getByTestId('sidebar-toggle')
const box = async (locator: Locator) => (await locator.boundingBox())!

async function viewMeasure(page: Page): Promise<{ width: number; offCentre: number }> {
  return page.evaluate(() => {
    const view = document.querySelector('.view')!.getBoundingClientRect()
    const main = document.querySelector('#main')!.getBoundingClientRect()
    return { width: view.width, offCentre: Math.abs((view.left - main.left) - (main.right - view.right)) }
  })
}

async function toolbarEntries(page: Page): Promise<string[]> {
  return page.locator('#toolbar-actions a:visible').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label') ?? ''))
}

for (const theme of THEMES) {
  test.describe(`desktop sidebar (${theme})`, () => {
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'desktop', 'desktop width'))
    test.use({ viewport: { width: 1440, height: 900 } })

    test('the toggle hides and shows the sidebar, stays in place, and the choice survives a reload', async ({ page }) => {
      await start(page, theme)
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
      await expect(toggle(page)).toHaveAttribute('aria-controls', 'app-sidebar')
      await expect(toggle(page)).toHaveAccessibleName('Ocultar barra lateral')
      await expect(toggle(page)).toHaveAttribute('title', /^Ocultar barra lateral \((⌘|Ctrl\+)\\\)$/)
      await expect(sidebar(page)).toBeVisible()
      const before = await box(toggle(page))

      await toggle(page).click()
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle(page)).toHaveAccessibleName('Mostrar barra lateral')
      await expect(sidebar(page)).toHaveAttribute('inert', '')
      await expect(sidebar(page)).toBeHidden()
      expect(await box(toggle(page))).toEqual(before)
      // Hidden means fully hidden, not a rail: nothing of the sidebar stays on screen.
      expect(await sidebar(page).evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0)

      await page.reload()
      await settle(page)
      await expect(sidebar(page)).toBeHidden()
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
      expect(await page.evaluate(() => window.localStorage.getItem('next168-sidebar'))).toBe('hidden')

      await toggle(page).click()
      await expect(sidebar(page)).toBeVisible()
      expect(await page.evaluate(() => window.localStorage.getItem('next168-sidebar'))).toBeNull()
    })

    test('text screens keep one 720 px measure, centred with the sidebar shown or hidden; only Week grows', async ({ page }) => {
      await start(page, theme)
      for (const hidden of [false, true]) {
        if (hidden) { await toggle(page).click(); await expect(sidebar(page)).toBeHidden() }
        for (const route of ['today', 'tasks', 'insights', 'settings']) {
          await page.goto(`./#/${route}`)
          await settle(page)
          const { width, offCentre } = await viewMeasure(page)
          expect(width, `${route} width, sidebar ${hidden ? 'hidden' : 'shown'}`).toBeLessThanOrEqual(MEASURE + 0.5)
          expect(width, `${route} uses the measure`).toBeGreaterThan(MEASURE - 0.5)
          expect(offCentre, `${route} centred`).toBeLessThanOrEqual(1)
        }
      }
      await page.goto('./#/week')
      await settle(page)
      const hiddenWeek = (await viewMeasure(page)).width
      await toggle(page).click()
      await expect(sidebar(page)).toBeVisible()
      const shownWeek = (await viewMeasure(page)).width
      expect(shownWeek).toBeGreaterThan(MEASURE)
      expect(hiddenWeek).toBeGreaterThan(shownWeek + 200)
    })

    test('the assistant and Settings are rows of the sidebar footer, with no floating icon; hiding the sidebar puts them in the toolbar', async ({ page }) => {
      await start(page, theme)
      const footer = page.getByTestId('sidebar-footer')
      await expect(footer.getByRole('link')).toHaveText(['Asistente', 'Ajustes'])
      for (const route of TAB_ROUTES) {
        await page.goto(`./#/${route}`)
        await settle(page)
        expect(await toolbarEntries(page), `${route} with the sidebar shown`).not.toContain('Preguntar al asistente')
        expect(await toolbarEntries(page), `${route} with the sidebar shown`).not.toContain('Ajustes')
      }
      await toggle(page).click()
      for (const route of TAB_ROUTES) {
        await page.goto(`./#/${route}`)
        await settle(page)
        const entries = (await toolbarEntries(page)).filter((name) => name === 'Preguntar al asistente' || name === 'Ajustes')
        expect(entries, `${route} with the sidebar hidden`).toEqual(['Preguntar al asistente', 'Ajustes'])
      }
    })

    test('⌘\\ or Ctrl+\\ toggles; focus leaves a hidden sidebar for the toggle, Tab skips it, and reopening focuses the current destination', async ({ page }) => {
      await start(page, theme, 'week')
      await sidebar(page).getByRole('link', { name: 'Semana' }).focus()
      await page.keyboard.press('ControlOrMeta+Backslash')
      await expect(sidebar(page)).toHaveAttribute('inert', '')
      await expect(toggle(page)).toBeFocused()
      for (let step = 0; step < 6; step++) {
        await page.keyboard.press('Tab')
        expect(await page.evaluate(() => !!document.activeElement?.closest('#app-sidebar'))).toBe(false)
      }
      await page.keyboard.press('ControlOrMeta+Backslash')
      await expect(sidebar(page)).toBeVisible()
      await expect(sidebar(page).getByRole('link', { name: 'Semana' })).toBeFocused()
      // From the keyboard on the toggle itself.
      await toggle(page).focus()
      await page.keyboard.press('Enter')
      await expect(sidebar(page)).toBeHidden()
      await page.keyboard.press('Enter')
      await expect(sidebar(page).getByRole('link', { name: 'Semana' })).toBeFocused()
    })

    test('a second press mid-slide reverses it from where it is and leaves a consistent state', async ({ page }) => {
      await start(page, theme)
      await toggle(page).click()
      // Mid-slide: the sidebar is somewhere between shown and hidden.
      await toggle(page).click()
      await settle(page)
      await expect(sidebar(page)).toBeVisible()
      await expect(sidebar(page)).not.toHaveAttribute('inert')
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
      expect(await sidebar(page).evaluate((element) => element.getBoundingClientRect().left)).toBe(0)
      expect(await page.evaluate(() => window.localStorage.getItem('next168-sidebar'))).toBeNull()
    })

    test('the sidebar slides on transform only, and switches without sliding under reduced motion', async ({ page }) => {
      for (const motion of ['no-preference', 'reduce'] as const) {
        await page.emulateMedia({ reducedMotion: motion })
        if (motion === 'no-preference') await start(page, theme)
        else { await page.reload(); await settle(page) }
        const startOpen = await sidebar(page).isVisible()
        await toggle(page).click()
        const running = await sidebar(page).evaluate((element) => element.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty))
        if (motion === 'reduce') expect(running, 'reduced motion').not.toContain('transform')
        else expect(running).toContain('transform')
        expect(running).not.toContain('width')
        await settle(page)
        await expect(sidebar(page)).toBeVisible({ visible: !startOpen })
      }
    })
  })

  test.describe(`tablet sidebar (${theme})`, () => {
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'tablet', 'tablet width'))

    test('starts collapsed with no tab bar, opens over the content with a scrim, and closes on Escape, the scrim or a destination', async ({ page }) => {
      await start(page, theme)
      await expect(page.locator('.tabbar')).toBeHidden()
      await expect(sidebar(page)).toBeHidden()
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
      expect(await toolbarEntries(page)).toEqual(['Preguntar al asistente', 'Ajustes'])

      await toggle(page).click()
      await expect(sidebar(page)).toBeVisible()
      await expect(page.locator('.sidebar-scrim')).toHaveAttribute('data-open', 'true')
      await expect(page.locator('.content')).toHaveAttribute('inert', '')
      // The overlay covers the content; the page does not move.
      expect((await box(page.locator('.view'))).x).toBeGreaterThanOrEqual(0)
      await page.keyboard.press('Escape')
      await expect(sidebar(page)).toBeHidden()
      await expect(page.locator('.content')).not.toHaveAttribute('inert')

      await toggle(page).click()
      await page.mouse.click(700, 500)
      await expect(sidebar(page)).toBeHidden()

      await toggle(page).click()
      await sidebar(page).getByRole('link', { name: 'Tareas' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
      await expect(sidebar(page)).toBeHidden()

      // The overlay is never remembered open.
      await toggle(page).click()
      await page.reload()
      await settle(page)
      await expect(sidebar(page)).toBeHidden()
    })
  })

  test.describe(`phone toolbar (${theme})`, () => {
    test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== 'phone', 'phone width'))
    test.use({ viewport: { width: 390, height: 844 } })

    test('every tab shows ✦ then ⚙ at the same place, and no sidebar toggle', async ({ page }) => {
      await start(page, theme)
      await expect(toggle(page)).toHaveCount(0)
      const positions: { x: number; y: number }[][] = []
      for (const [index, route] of TAB_ROUTES.entries()) {
        await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: TAB_NAMES[index] }).click()
        await expect(page).toHaveURL(new RegExp(`#/${route}$`))
        await settle(page)
        const entries = page.locator('[data-testid=toolbar-entries] a')
        await expect(entries).toHaveCount(2)
        expect(await entries.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))).toEqual(['Preguntar al asistente', 'Ajustes'])
        positions.push(await entries.evaluateAll((links) => links.map((link) => { const rect = link.getBoundingClientRect(); return { x: rect.x, y: rect.y } })))
      }
      // Week adds its own "+" only from 768 px, so on a phone the pair sits at the same spot on all four tabs.
      for (const position of positions) expect(position).toEqual(positions[0])
    })
  })
}
