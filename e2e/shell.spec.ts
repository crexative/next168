import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { TABS, TAB_TITLES, openTab } from './fixtures'
import { seedOnboarded } from './support/seed'

const ARTIFACT_DIR = 'e2e/artifacts/shell'
const WIDTHS = [320, 375, 768, 1440, 1920]

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await seedOnboarded(page)
  })

  test('@smoke every tab renders a placeholder with its title', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
    for (const tab of TABS) {
      await openTab(page, tab)
      await expect(page.locator('main')).not.toBeEmpty()
    }
  })

  test('navigation links switch views and a reload keeps the tab', async ({ page, isMobile }, testInfo) => {
    test.skip(testInfo.project.name === 'webkit-phone')
    await page.goto('./')
    const nav = page.getByRole('navigation', { name: isMobile || page.viewportSize()!.width < 1024 ? 'Main navigation' : 'Sidebar' })
    await nav.getByRole('link', { name: 'Tasks' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    await expect(page).toHaveURL(/#\/tasks$/)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('settings is a gear below 1024 px and a sidebar item above', async ({ page }) => {
    await page.goto('./')
    const wide = page.viewportSize()!.width >= 1024
    if (wide) {
      await expect(page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: 'Settings' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
    } else {
      await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeHidden()
    }
  })

  test('no horizontal scroll from 320 to 1920 px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const tab of TABS) {
        await openTab(page, tab)
        const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)
        expect(overflow, `${tab} at ${width}px`).toBeLessThanOrEqual(0)
      }
    }
  })

  test('touch targets are at least 44 px on the phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    for (const tab of TABS) {
      await openTab(page, tab)
      const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [role=button]'))
        .filter((element) => element.offsetParent !== null || getComputedStyle(element).position === 'fixed')
        .filter((element) => !(element.tabIndex === -1 && element.classList.contains('visually-hidden')))
        .map((element) => ({ label: element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName, ...element.getBoundingClientRect().toJSON() }))
        .filter((box) => box.width > 0 && (box.width < 44 || box.height < 44)))
      expect(small, `${tab}: ${JSON.stringify(small)}`).toEqual([])
    }
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`screenshots in ${theme} theme`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'webkit-phone')
      mkdirSync(ARTIFACT_DIR, { recursive: true })
      await page.emulateMedia({ colorScheme: theme })
      for (const tab of TABS) {
        await openTab(page, tab)
        await page.screenshot({ path: `${ARTIFACT_DIR}/${tab}-${testInfo.project.name}-${theme}.png` })
      }
    })
  }

  test('axe finds no serious or critical issues in both themes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      for (const tab of TABS) {
        await openTab(page, tab)
        const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).analyze()
        const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        expect(blocking.map((violation) => `${theme}/${tab}: ${violation.id} ${violation.nodes.map((node) => `${node.target} ${JSON.stringify(node.any[0]?.data)}`).join(" | ")}`)).toEqual([])
      }
    }
  })

  test('large title collapses into the toolbar on scroll', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openTab(page, 'today')
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = '2000px'
      document.querySelector('main')!.append(filler)
    })
    const toolbar = page.locator('header.toolbar')
    await expect(toolbar).not.toHaveAttribute('data-collapsed')
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect(toolbar).toHaveAttribute('data-collapsed', 'true')
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(toolbar).not.toHaveAttribute('data-collapsed')
  })

  test('every tab opens scrolled to the top with the large title showing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openTab(page, 'settings')
    // Every view is tall enough to keep the old offset, as populated views are.
    await page.addStyleTag({ content: '.view { min-height: 3000px; }' })
    await page.evaluate(() => window.scrollTo(0, 1500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    for (const tab of ['Tasks', 'Insights', 'Today'] as const) {
      await nav.getByRole('link', { name: tab }).click()
      await expect(page.getByRole('heading', { level: 1, name: tab })).toBeVisible()
      await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
      expect(await page.evaluate(() => window.scrollY), `${tab} scroll offset`).toBe(0)
      await expect(page.locator('header.toolbar')).not.toHaveAttribute('data-collapsed')
      await page.evaluate(() => window.scrollTo(0, 154))
    }
  })

  test('reduced motion keeps every tab usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const tab of TABS) await openTab(page, tab)
    await expect(page.getByRole('heading', { level: 1, name: TAB_TITLES.settings })).toBeVisible()
  })
})
