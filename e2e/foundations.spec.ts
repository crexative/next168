import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'

// UX foundations (#3, slice A): shared materials, rows, buttons, category marks, measure, time format and the
// accessibility plumbing. Geometry and accessibility assertions only; no screenshot baselines.

test.use({ launchOptions: { args: ['--disable-features=WebGPU'] } })

// Wednesday 2026-10-21 10:15 UTC.
const NOW = new Date('2026-10-21T10:15:00.000Z')
const LANGUAGE_KEY = 'next168-language'

const richDocument = {
  schemaVersion: 2,
  workspaceId: '2dcbe476-0628-494b-aa5f-055a0e879781',
  revision: 1,
  updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
    { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } },
    { id: 'c-family', name: 'Family', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 870 },
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
    { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [1, 3, 5], start: 1080, end: 1140 },
    { id: 'b-family', categoryId: 'c-family', title: 'Dinner', days: [3], start: 1200, end: 1290 },
  ],
  tasks: [
    { id: 't-report', title: 'Write the quarterly report', categoryId: 'c-work', durationMin: 150, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' },
  ],
  checkIns: [],
  actuals: [],
  events: [],
  calendarSources: [],
  appliedProposalIds: [],
}

async function startWith(page: Page, document: unknown = richDocument, locale = 'en'): Promise<void> {
  await page.clock.install({ time: NOW })
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [LANGUAGE_KEY, locale])
  await seedKey(page, V2_KEY, JSON.stringify(document))
}

async function openView(page: Page, view: string): Promise<void> {
  await page.goto(`./#/${view}`)
  await expect(page.locator('#main h1')).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

type Rect = { left: number; top: number; right: number; bottom: number }
const overlaps = (a: Rect, b: Rect) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5

test.describe('materials', () => {
  test('bars are a thick material with a hairline edge, and Week\'s day strip spans the toolbar', async ({ page }) => {
    await startWith(page)
    await openView(page, 'week')
    await page.mouse.wheel(0, 400)
    await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
    const bars = await page.evaluate(() => {
      const alpha = (color: string) => {
        const match = /rgba?\(([^)]+)\)/.exec(color) ?? /color\(srgb ([^)]+)\)/.exec(color)
        const parts = match?.[1]?.split(/[ ,/]+/).filter(Boolean) ?? []
        return parts.length === 4 ? Number(parts[3]) : 1
      }
      const describe = (element: Element | null) => {
        if (!element) return null
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return { alpha: alpha(style.backgroundColor), filter: style.backdropFilter, shadow: style.boxShadow, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }
      return {
        toolbar: describe(document.querySelector('.toolbar')),
        strip: describe(document.querySelector('[data-toolbar-extension]')),
        tabbar: describe(getComputedStyle(document.querySelector('.tabbar')!).display === 'none' ? null : document.querySelector('.tabbar')),
      }
    })
    for (const bar of [bars.toolbar, bars.strip, bars.tabbar]) {
      if (!bar) continue
      expect(bar.alpha).toBeGreaterThanOrEqual(0.85)
      expect(bar.filter).toContain('blur(30px)')
    }
    // Toolbar and strip are one material: same left and right edges, no gap, the edge drawn once under the strip.
    expect(Math.abs(bars.strip!.left - bars.toolbar!.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(bars.strip!.right - bars.toolbar!.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(bars.strip!.top - bars.toolbar!.bottom)).toBeLessThanOrEqual(1)
    expect(bars.toolbar!.shadow).toBe('none')
    expect(bars.strip!.shadow).not.toBe('none')

    await openView(page, 'settings')
    await page.mouse.wheel(0, 400)
    await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
    expect(await page.locator('.toolbar').evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
  })
})

test.describe('rows', () => {
  test('label and value never overlap: a long value wraps below its label', async ({ page }) => {
    await startWith(page)
    await openView(page, 'settings')
    const rows = await page.locator('.list-row').evaluateAll((elements) => elements.map((row) => {
      const label = row.querySelector('.row-text')
      const value = row.querySelector('.row-trailing')
      const box = (element: Element | null) => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      }
      return {
        text: row.textContent?.trim().slice(0, 40) ?? '',
        label: box(label),
        value: box(value),
        labelOverflows: label ? label.scrollWidth > label.clientWidth + 1 : false,
        rowOverflows: row.scrollWidth > row.clientWidth + 1,
      }
    }))
    expect(rows.length).toBeGreaterThan(3)
    for (const row of rows) {
      expect.soft(row.labelOverflows, `${row.text}: label overflows`).toBe(false)
      expect.soft(row.rowOverflows, `${row.text}: row overflows`).toBe(false)
      if (row.label && row.value) expect.soft(overlaps(row.label, row.value), `${row.text}: label and value overlap`).toBe(false)
    }
    const workspace = page.getByTestId('data-workspace')
    await expect(workspace).toHaveText(richDocument.workspaceId)
  })
})
