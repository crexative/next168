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

  test('navigation links switch views and a reload keeps the tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'webkit-phone')
    await page.goto('./')
    const width = page.viewportSize()!.width
    // Phone: the tab bar. Tablet: the sidebar opens over the content from its toggle. Desktop: the sidebar column.
    if (width >= 768 && width < 1024) await page.getByTestId('sidebar-toggle').click()
    const nav = page.getByRole('navigation', { name: width < 768 ? 'Main navigation' : 'Sidebar' })
    await nav.getByRole('link', { name: 'Tasks' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    await expect(page).toHaveURL(/#\/tasks$/)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()
    const current = width < 768 ? page.locator('.tabbar [aria-current=page]') : page.locator('#app-sidebar [aria-current=page]')
    await expect(current).toHaveText(/Tasks/)
  })

  test('the assistant and Settings: toolbar icons on a phone and tablet, sidebar footer rows from 768 px', async ({ page }) => {
    await page.goto('./')
    const width = page.viewportSize()!.width
    const toolbarSettings = page.locator('#toolbar-actions').getByRole('link', { name: 'Settings' })
    const footer = page.getByTestId('sidebar-footer')
    if (width >= 1024) {
      await expect(footer.getByRole('link', { name: 'Settings' })).toBeVisible()
      await expect(toolbarSettings).toBeHidden()
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
    } else if (width >= 768) {
      await expect(toolbarSettings).toBeVisible()
      // The tablet keeps its tabs visible in the toolbar (redesign 2026-11); the sidebar still opens from panel-left.
      await expect(page.getByTestId('top-tabs')).toBeVisible()
      await expect(page.locator('.tabbar')).toBeHidden()
      await page.getByTestId('sidebar-toggle').click()
      await expect(footer.getByRole('link', { name: 'Settings' })).toBeVisible()
    } else {
      await expect(toolbarSettings).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeHidden()
    }
  })

  // Review of #53: the toolbar let presses through to the title row, so the tablet's tabs could not be pressed. Real
  // pointer presses (not DOM clicks) on every tab, on a tablet and on a desktop with the sidebar hidden.
  test('the toolbar tabs take real presses on a tablet and on a desktop with the sidebar hidden', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone' || testInfo.project.name === 'webkit-phone', 'no toolbar tabs on a phone')
    await page.goto('./#/today')
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
    if (page.viewportSize()!.width >= 1024) {
      await page.getByTestId('sidebar-toggle').click()
      await expect(page.locator('#app-sidebar')).toBeHidden()
    }
    const tabs = page.getByTestId('top-tabs')
    for (const [name, hash] of [['Tasks', 'tasks'], ['Week', 'week'], ['Summary', 'insights'], ['Today', 'today']] as const) {
      const tab = tabs.getByRole('link', { name })
      const box = (await tab.boundingBox())!
      expect(box.height, `${name} is a full target`).toBeGreaterThanOrEqual(44)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(page).toHaveURL(new RegExp(`#/${hash}$`))
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    }
  })

  // Review of #53: once the toolbar is collapsed (a bar of material over the page) a press on it must stay on the bar,
  // never reach the controls scrolled under it.
  test('a press on the collapsed toolbar never reaches the content under it', async ({ page }) => {
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 500 })
    // A tab: on a phone Settings is a sheet with its own bar (no large title to collapse).
    await page.goto('./#/insights')
    await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
    const bar = (await page.locator('.toolbar[data-collapsed]').boundingBox())!
    // The bar's middle, clear of its icons at the trailing end.
    const x = bar.x + Math.min(bar.width / 3, 120)
    const y = bar.y + bar.height - 12
    const hit = await page.evaluate(([px, py]) => !!document.elementFromPoint(px!, py!)?.closest('.toolbar'), [x, y])
    expect(hit).toBe(true)
    const scrolled = await page.evaluate(() => window.scrollY)
    await page.mouse.click(x, y)
    await expect(page).toHaveURL(/#\/insights$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
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
    await openTab(page, 'week')
    // Every view is tall enough to keep the old offset, as populated views are.
    await page.addStyleTag({ content: '.view { min-height: 3000px; }' })
    await page.evaluate(() => window.scrollTo(0, 1500))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    for (const tab of ['Tasks', 'Summary', 'Today'] as const) {
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
