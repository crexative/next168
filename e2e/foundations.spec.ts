import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { addFromMenu } from './support/week'

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

    await openView(page, 'settings/advanced')
    await page.mouse.wheel(0, 400)
    await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
    expect(await page.locator('.toolbar').evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none')
  })
})

test.describe('rows', () => {
  test('label and value never overlap: a long value wraps below its label', async ({ page }) => {
    await startWith(page)
    // The data rows (mode, origin, workspace id) live under Integrations and advanced.
    await openView(page, 'settings/advanced')
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

test.describe('buttons', () => {
  async function buttonGeometry(page: Page) {
    return page.locator('.ui-button').evaluateAll((elements) => elements.filter((element) => element.getClientRects().length > 0).map((element) => {
      const button = element as HTMLElement
      const width = button.getBoundingClientRect().width
      const previous = button.style.width
      button.style.width = 'max-content'
      const natural = button.getBoundingClientRect().width
      button.style.width = previous
      const parent = button.parentElement!.getBoundingClientRect().width
      const style = getComputedStyle(button)
      return { text: button.textContent?.trim() ?? '', width, natural, parent, plain: button.classList.contains('is-plain'), paddingLeft: style.paddingLeft, decoration: style.textDecorationLine }
    }))
  }

  test('primary and secondary buttons hug their label above 480 px; plain ones sit flush', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'the wide-screen rule')
    await startWith(page)
    await openView(page, 'settings')
    const buttons = await buttonGeometry(page)
    await openView(page, 'settings/advanced')
    buttons.push(...await buttonGeometry(page))
    expect(buttons.length).toBeGreaterThan(4)
    for (const button of buttons) {
      expect.soft(button.width, `"${button.text}" is ${button.width} px wide for a ${button.natural} px label`).toBeLessThanOrEqual(Math.max(button.natural, 44) + 1)
      if (button.plain) expect.soft(button.paddingLeft, `"${button.text}" is plain and flush`).toBe('0px')
    }
    await openView(page, 'week')
    await page.locator('[data-block-id="b-gym"]').first().click()
    const save = page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeVisible()
    const [saveBox, bodyBox] = await Promise.all([save.boundingBox(), page.locator('.sheet-body').boundingBox()])
    expect(saveBox!.width).toBeLessThan(bodyBox!.width / 2)
  })

  test('on a phone the sheet\'s primary action spans the width for the thumb', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await startWith(page)
    await openView(page, 'week')
    await addFromMenu(page, 'Block')
    const save = page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeVisible()
    const [saveBox, bodyBox] = await Promise.all([save.boundingBox(), page.locator('.sheet-body').boundingBox()])
    expect(saveBox!.width).toBeGreaterThan(bodyBox!.width - 2 * 16 - 2)
  })

  test('empty states offer a tinted call to action and no link is underlined', async ({ page }) => {
    await startWith(page, { ...richDocument, blocks: [], tasks: [] })
    await openView(page, 'today')
    // Today's empty state leads with "Set up my week"; Week's "Add a block" is the tinted secondary call to action.
    await expect(page.getByRole('button', { name: 'Set up my week · 1 min' })).toBeVisible()
    await openView(page, 'week')
    const action = page.getByRole('button', { name: 'Add a block' })
    await expect(action).toBeVisible()
    await expect(action).toHaveClass(/ui-button/)
    await expect(action).toHaveClass(/is-tinted/)
    expect(await action.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    for (const view of ['today', 'settings', 'tasks', 'insights']) {
      await openView(page, view)
      const underlined = await page.locator('#main a').evaluateAll((links) => links
        .filter((link) => link.getClientRects().length > 0 && getComputedStyle(link).textDecorationLine.includes('underline'))
        .map((link) => link.textContent?.trim()))
      expect(underlined, `${view}: underlined links`).toEqual([])
    }
  })
})

test.describe('headings', () => {
  // Settings has two pages: Categories and Data on top, everything else under Integrations and advanced.
  test('every Settings group opens with the same eyebrow, inset like the others, and groups are spaced apart', async ({ page }) => {
    await startWith(page)
    const pages = [['settings', '#main .home'], ['settings/advanced', '[data-testid="settings-advanced"]']] as const
    const all: { text: string; size: string; weight: string; transform: string; color: string }[] = []
    for (const [view, container] of pages) {
      await openView(page, view)
      const headers = await page.locator(`${container} h2:not(.advanced-title)`).evaluateAll((elements) => elements
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const style = getComputedStyle(element)
          const range = document.createRange()
          range.selectNodeContents(element)
          return { text: element.textContent?.trim() ?? '', size: style.fontSize, weight: style.fontWeight, transform: style.textTransform, color: style.color, textLeft: range.getBoundingClientRect().left }
        }))
      expect(headers.length, view).toBeGreaterThanOrEqual(view === 'settings' ? 3 : 5)
      for (const header of headers) {
        expect.soft(Math.abs(header.textLeft - headers[0]!.textLeft), `${view}: "${header.text}" is inset like "${headers[0]!.text}"`).toBeLessThanOrEqual(1)
      }
      all.push(...headers)
      // Consecutive groups: the space between one group's end and the next one's eyebrow.
      const gaps = await page.locator(container).evaluate((root) => {
        const groups = Array.from(root.children).filter((child) => child.getClientRects().length > 0 && child.querySelector('h2:not(.advanced-title)'))
        return groups.slice(1).map((group, index) => group.getBoundingClientRect().top - groups[index]!.getBoundingClientRect().bottom)
      })
      expect(gaps.length, `${view}: groups measured`).toBeGreaterThanOrEqual(1)
      for (const gap of gaps) expect.soft(gap, `${view}: space between groups`).toBeGreaterThanOrEqual(24)
    }
    const [first] = all
    for (const header of all) {
      expect.soft(header, `"${header.text}" matches "${first!.text}"`).toMatchObject({ size: first!.size, weight: first!.weight, transform: 'uppercase', color: first!.color })
    }
  })
})

test.describe('colour is never alone', () => {
  const glyphOf = (element: Element) => getComputedStyle(element.querySelector('.category-glyph')!, '::before').content.replace(/^"|"$/g, '')

  test('Today rows show the category glyph and, when it differs from the title, its name', async ({ page }) => {
    await startWith(page)
    await openView(page, 'today')
    const rows = await page.getByTestId('timeline-item').evaluateAll((items, glyphSource) => {
      const glyph = new Function('element', `return (${glyphSource})(element)`) as (element: Element) => string
      return items.filter((item) => item.querySelector('[data-testid="category-mark"]')).map((item) => ({
        title: item.querySelector('.row-title-text')?.textContent?.trim(),
        glyph: glyph(item),
        name: item.querySelector('[data-testid="timeline-category"]')?.textContent?.trim() ?? null,
      }))
    }, glyphOf.toString())
    expect(rows).toEqual(expect.arrayContaining([
      { title: 'Deep work', glyph: 'W', name: 'Work' },
      { title: 'Gym', glyph: 'E', name: 'Exercise' },
      { title: 'Sleep', glyph: '😴', name: null },
    ]))
  })

  test('Week blocks show the glyph and say the category', async ({ page }) => {
    await startWith(page)
    await openView(page, 'week')
    const gym = page.locator('[data-date="2026-10-21"] [data-block-id="b-gym"]').first()
    await expect(gym).toBeVisible()
    await expect(gym).toHaveAccessibleName(/^Gym .*Exercise$/)
    expect(await gym.evaluate((element, glyphSource) => (new Function('element', `return (${glyphSource})(element)`) as (element: Element) => string)(element), glyphOf.toString())).toBe('E')
    const ring = await gym.locator('.category-glyph').evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: parseFloat(style.borderTopWidth), color: style.borderTopColor }
    })
    expect(ring.width).toBeGreaterThanOrEqual(1)
    expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('readable measure', () => {
  test('content keeps a readable width on wide screens and the tab bar gathers in the middle', async ({ page }, testInfo) => {
    await startWith(page)
    const viewport = page.viewportSize()!
    const rem = 16
    for (const [view, limit] of [['today', 44], ['tasks', 44], ['settings', 44], ['week', 64], ['insights', 64]] as const) {
      await openView(page, view)
      const box = (await page.locator('.view').boundingBox())!
      const main = (await page.locator('#main').boundingBox())!
      expect.soft(box.width, `${view} width`).toBeLessThanOrEqual(limit * rem + 1)
      // Centered in the space beside the sidebar.
      expect.soft(Math.abs((box.x - main.x) - (main.x + main.width - box.x - box.width)), `${view} centered`).toBeLessThanOrEqual(1)
    }
    if (testInfo.project.name === 'tablet') {
      const items = await page.locator('.tabbar-item').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect))
      const left = items[0]!.left
      const right = viewport.width - items[items.length - 1]!.right
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
      expect(left).toBeGreaterThan(viewport.width / 6)
    }
  })
})

test.describe('time format', () => {
  test('Today\'s times sit in a right-aligned tabular column', async ({ page }) => {
    await startWith(page)
    await openView(page, 'today')
    const cells = await page.getByTestId('timeline-start').evaluateAll((elements) => elements.map((element) => ({
      // The text itself, not the cell box (which spans the column either way).
      right: (() => { const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().right })(),
      numeric: getComputedStyle(element).fontVariantNumeric,
    })))
    expect(cells.length).toBeGreaterThan(2)
    for (const cell of cells) {
      expect(Math.abs(cell.right - cells[0]!.right)).toBeLessThanOrEqual(0.5)
      expect(cell.numeric).toContain('tabular-nums')
    }
  })

  for (const [choice, expected] of [[null, /^9:00\sAM$/], ['h23', /^09:00$/], ['h12', /^9:00\sAM$/]] as const) {
    test(`the 12/24 h choice (${choice ?? 'automatic'}) applies to Today and Week`, async ({ page }) => {
      if (choice) await page.addInitScript((value) => window.localStorage.setItem('next168-hour-cycle', value), choice)
      await startWith(page)
      await openView(page, 'today')
      const work = page.getByTestId('timeline-item').filter({ hasText: 'Deep work' })
      await expect(work.getByTestId('timeline-start')).toHaveText(expected)
      await openView(page, 'week')
      const label = await page.locator('[data-date="2026-10-21"] [data-block-id="b-work"]').first().getAttribute('aria-label')
      expect(label?.split(' ').slice(2).join(' ')).toMatch(new RegExp(expected.source.replace(/^\^|\$$/g, '')))
    })
  }

  test('a Spanish week reads in 24 h with durations as "2 h 30 min"', async ({ page }) => {
    await startWith(page, { ...richDocument, settings: { ...richDocument.settings, locale: 'es' } }, 'es')
    await openView(page, 'today')
    await expect(page.getByTestId('timeline-item').filter({ hasText: 'Deep work' }).getByTestId('timeline-start')).toHaveText('9:00')
    await expect(page.getByTestId('now-left')).toHaveText('Quedan 4 h 15 min')
    await openView(page, 'tasks')
    await expect(page.locator('#main')).toContainText('2 h 30 min')
    await expect(page.locator('#main')).not.toContainText(/\d{4}-\d{2}-\d{2}/)
  })
})

test.describe('accessibility plumbing', () => {
  async function goTo(page: Page, name: string) {
    const nav = page.locator('.tabbar:visible, .sidebar:visible').first()
    await nav.getByRole('link', { name, exact: true }).click()
  }

  test('each route has its own title; navigating focuses the new heading and announces it', async ({ page }) => {
    await startWith(page)
    await openView(page, 'today')
    await expect(page).toHaveTitle('Today · Next168')
    // The first load leaves focus alone.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY')

    await goTo(page, 'Week')
    await expect(page).toHaveTitle('Week · Next168')
    await expect(page.getByRole('heading', { level: 1, name: 'Week' })).toBeFocused()
    await expect(page.getByTestId('live-announcer')).toHaveText('Week')

    // A quick second navigation wins: focus and the one announcement are for the last page only.
    await goTo(page, 'Tasks')
    await goTo(page, 'Insights')
    await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeFocused()
    await expect(page.getByTestId('live-announcer')).toHaveText('Insights')
    await expect(page).toHaveTitle('Insights · Next168')
  })

  async function deleteGym(page: Page) {
    await openView(page, 'week')
    await page.locator('[data-date="2026-10-21"] [data-block-id="b-gym"]').first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete block' }).click()
    await expect(page.locator('.toast')).toBeVisible()
    // The closing sheet keeps focus trapped until it is gone.
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }

  test('the undo toast stays 15 s, holds while pointed at, and Cmd/Ctrl+Z undoes', async ({ page }) => {
    await startWith(page)
    await deleteGym(page)
    const toast = page.locator('.toast')
    await page.clock.runFor(10_000)
    await expect(toast).toBeVisible()
    await toast.hover()
    await page.clock.runFor(30_000)
    await expect(toast).toBeVisible()
    await page.mouse.move(1, 1)
    await page.clock.runFor(4_000)
    await expect(toast).toBeVisible()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(toast).toHaveCount(0)
    await expect(page.locator('[data-date="2026-10-21"] [data-block-id="b-gym"]')).not.toHaveCount(0)

    await deleteGym(page)
    // The toast may appear under the resting pointer, which holds it; move away first.
    await page.mouse.move(1, 1)
    await page.clock.runFor(15_100)
    await expect(toast).toHaveCount(0)
  })

  test('the toast\'s Undo is among the first stops of the tab order', async ({ page }) => {
    await startWith(page)
    await deleteGym(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.locator('body').focus()
    let reached = false
    for (let press = 0; press < 8 && !reached; press += 1) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(() => document.activeElement?.closest('.toast') !== null)
    }
    expect(reached).toBe(true)
  })

  test('an undo offered before the workspace was replaced is withdrawn', async ({ page }) => {
    await startWith(page, { ...richDocument, events: [{ id: 'e-review', title: 'Design review', start: '2026-10-22T14:00:00.000Z', end: '2026-10-22T15:00:00.000Z', allDay: false, attendees: [] }] })
    await openView(page, 'settings/advanced')
    await page.getByTestId('planner-event').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.locator('.toast')).toBeVisible()
    await openView(page, 'settings')
    await expect(page.locator('.toast')).toBeVisible()
    await page.getByRole('button', { name: 'Delete all data…' }).click()
    await page.getByRole('dialog').getByRole('textbox').fill('DELETE')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.locator('.toast')).toHaveCount(0)
  })

  test('status chips are 8–12 px apart', async ({ page }) => {
    await startWith(page)
    await openView(page, 'today')
    const gaps = await page.getByTestId('now-card').locator('.choices').evaluate((group) => {
      const boxes = Array.from(group.children).map((child) => child.getBoundingClientRect())
      return boxes.slice(1).filter((box, index) => Math.abs(box.top - boxes[index]!.top) < 1).map((box, index) => box.left - boxes[index]!.right)
    })
    expect(gaps).toHaveLength(2)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(8)
      expect(gap).toBeLessThanOrEqual(12)
    }
  })

  test('forced colours keep pressed, selected and current states and shapes visible', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await startWith(page)
    await openView(page, 'today')
    // Deep work is the block in progress, so its status chips sit in the Now card.
    const deepWork = page.getByTestId('now-card')
    await deepWork.getByRole('button', { name: 'Done' }).click()
    await expect(deepWork.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    const [pressed, unpressed] = await Promise.all([
      deepWork.getByRole('button', { name: 'Done' }).evaluate((element) => getComputedStyle(element).backgroundColor),
      deepWork.getByRole('button', { name: 'Skipped' }).evaluate((element) => getComputedStyle(element).backgroundColor),
    ])
    expect(pressed).not.toBe(unpressed)
    const current = await page.locator('[aria-current="page"]:visible').first().evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(current).not.toBe('rgba(0, 0, 0, 0)')
    await openView(page, 'week')
    const outline = await page.locator('[data-block-id="b-work"]').first().evaluate((element) => getComputedStyle(element).outlineStyle)
    expect(outline).toBe('solid')
  })

  test('increased contrast makes bars solid and field borders full strength', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' })
    await startWith(page)
    await openView(page, 'settings/advanced')
    await page.mouse.wheel(0, 300)
    await expect(page.locator('.toolbar[data-collapsed]')).toHaveCount(1)
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
    const look = await page.evaluate(() => {
      const probe = document.createElement('input')
      probe.className = 'input'
      document.body.append(probe)
      const result = {
        bar: getComputedStyle(document.querySelector('.toolbar')!).backgroundColor,
        filter: getComputedStyle(document.querySelector('.toolbar')!).backdropFilter,
        field: getComputedStyle(probe).borderTopColor,
        secondary: (() => { const note = document.createElement('p'); note.className = 't-secondary'; document.body.append(note); const color = getComputedStyle(note).color; note.remove(); return color })(),
        label: getComputedStyle(document.body).color,
      }
      probe.remove()
      return result
    })
    expect(look.bar).toMatch(/^rgb\(/)
    expect(look.filter).toBe('none')
    expect(look.field).toBe(look.label)
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(look.secondary)?.[1] ?? 1)
    expect(alpha, `secondary text ${look.secondary}`).toBeGreaterThanOrEqual(0.85)
  })
})

test.describe('sheets', () => {
  test('on a narrow screen a mouse click on the close button closes the sheet', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'the bottom sheet (drag handle) layout')
    await page.setViewportSize({ width: 390, height: 844 })
    await startWith(page)
    await openView(page, 'week')
    await addFromMenu(page, 'Block')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
    const close = (await dialog.getByRole('button', { name: 'Close' }).first().boundingBox())!
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2)
    await expect(dialog).toHaveCount(0)
  })

  async function openAddBlock(page: Page) {
    await startWith(page)
    await openView(page, 'week')
    await addFromMenu(page, 'Block')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
    await expect.poll(() => page.locator('.sheet-panel').evaluate((element) => (element as HTMLElement).style.transform)).toBe('translateY(0px)')
    return dialog
  }

  test('a drag never starts on a button, and a press moves the sheet only after 10 px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    const dialog = await openAddBlock(page)
    const transform = () => page.locator('.sheet-panel').evaluate((element) => (element as HTMLElement).style.transform)
    const close = (await dialog.getByRole('button', { name: 'Close' }).boundingBox())!
    await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2)
    await page.mouse.down()
    await page.mouse.move(close.x + close.width / 2, close.y + close.height / 2 + 120, { steps: 6 })
    expect(await transform()).toBe('translateY(0px)')
    await page.mouse.up()
    await expect(dialog).toBeVisible()

    const handle = (await page.locator('.sheet-handle').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 8, { steps: 3 })
    expect(await transform()).toBe('translateY(0px)')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 60, { steps: 4 })
    expect(await transform()).not.toBe('translateY(0px)')
    await page.mouse.up()
  })

  test('ignores hover after a mouse press is released outside the header', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openAddBlock(page)
    const transform = () => page.locator('.sheet-panel').evaluate((element) => (element as HTMLElement).style.transform)
    const handle = (await page.locator('.sheet-handle').boundingBox())!
    const x = handle.x + handle.width / 2
    await page.mouse.move(x, handle.y + 2)
    await page.mouse.down()
    // One step straight to the scrim: the header never sees a move or the release.
    await page.mouse.move(x, 20)
    await page.mouse.up()
    await page.mouse.move(x, handle.y + 2)
    await page.mouse.move(x, handle.y + 60, { steps: 4 })
    expect(await transform()).toBe('translateY(0px)')
  })

  test('the day pager ignores hover after a press released outside it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await startWith(page)
    await openView(page, 'week')
    const track = page.getByTestId('pager-track')
    const before = await track.evaluate((element) => (element as HTMLElement).style.transform)
    const box = (await page.locator('.pager-viewport').boundingBox())!
    // Mid-screen: below the sticky day strip, above the tab bar, wherever the grid has scrolled.
    const y = 450
    expect(box.y).toBeLessThan(y)
    await page.mouse.move(box.x + 200, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, 5)
    await page.mouse.up()
    await page.mouse.move(box.x + 200, y)
    await page.mouse.move(box.x + 60, y, { steps: 6 })
    expect(await track.evaluate((element) => (element as HTMLElement).style.transform)).toBe(before)
  })

  test('a phone sheet ends with a Cancel within thumb reach', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    const dialog = await openAddBlock(page)
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
    const [box, panel] = await Promise.all([cancel.boundingBox(), page.locator('.sheet-panel').boundingBox()])
    expect(panel!.y + panel!.height - (box!.y + box!.height)).toBeLessThanOrEqual(16)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await cancel.click()
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('language and region settings', () => {
  test('language, first day of the week and 12/24 h are chosen in Settings and kept after a reload', async ({ page }) => {
    await startWith(page)
    await openView(page, 'settings/advanced')
    await page.getByRole('radiogroup', { name: 'Week starts on' }).getByRole('radio', { name: 'Sunday' }).click()
    await page.getByRole('radiogroup', { name: 'Time format' }).getByRole('radio', { name: '24-hour' }).click()
    await expect(page.locator('#main')).toContainText('Times read like 14:30.')

    await openView(page, 'week')
    await expect(page.locator('[data-date]').first()).toHaveAttribute('data-date', '2026-10-18')
    await openView(page, 'today')
    await expect(page.getByTestId('timeline-item').filter({ hasText: 'Deep work' }).getByTestId('timeline-start')).toHaveText('09:00')

    await openView(page, 'settings/advanced')
    await page.getByTestId('preference-language').selectOption('es')
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'La semana empieza el' }).getByRole('radio', { name: 'Domingo' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('radiogroup', { name: 'Formato de hora' }).getByRole('radio', { name: '24 horas' })).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('large text and narrow screens', () => {
  const MAIN_SCREENS = ['today', 'week', 'tasks', 'insights', 'settings']

  // Text that leaves its button or link, and text in a bar (toolbar, day strip, tab bar) drawn over other text.
  async function spilledText(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const problems: string[] = []
      const textRects = (root: Element) => {
        const rects: { text: string; rect: DOMRect; owner: Element }[] = []
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const owner = node.parentElement
          if (!owner || !(node.textContent ?? '').trim() || owner.closest('[aria-hidden="true"] .visually-hidden, .visually-hidden')) continue
          const style = getComputedStyle(owner)
          if (style.visibility !== 'visible' || style.textOverflow === 'ellipsis' || Number(style.opacity) === 0) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          for (const rect of Array.from(range.getClientRects())) if (rect.width > 0 && rect.height > 0) rects.push({ text: node.textContent!.trim(), rect, owner })
        }
        return rects
      }
      for (const control of Array.from(document.querySelectorAll('#main button, #main a[href], .tabbar a'))) {
        if (control.getClientRects().length === 0) continue
        const box = control.getBoundingClientRect()
        for (const { text, rect } of textRects(control)) {
          if (rect.left < box.left - 1 || rect.right > box.right + 1) problems.push(`"${text}" spills out of its control`)
        }
      }
      for (const bar of Array.from(document.querySelectorAll('.toolbar, [data-toolbar-extension]'))) {
        const rects = textRects(bar).filter(({ owner }) => getComputedStyle(owner.closest('.toolbar-title') ?? owner).opacity !== '0')
        rects.forEach((first, index) => {
          for (const second of rects.slice(index + 1)) {
            if (first.owner === second.owner) continue
            const a = first.rect, b = second.rect
            if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) problems.push(`"${first.text}" overlaps "${second.text}"`)
          }
        })
      }
      return problems
    })
  }

  async function auditScreens(page: Page, state: string) {
    for (const view of MAIN_SCREENS) {
      await openView(page, view)
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
      const violations = await visualIntegrityViolations(page)
      expect.soft(violations, `${state}/${view}`).toEqual([])
      expect.soft(await spilledText(page), `${state}/${view}: text outside its control or over other text in a bar`).toEqual([])
      // Scrolled, the toolbar shows its collapsed title next to its actions.
      await page.mouse.wheel(0, 600)
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
      expect.soft(await spilledText(page), `${state}/${view} scrolled: text over other text in a bar`).toEqual([])
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect.soft(overflow, `${state}/${view} scrolls sideways`).toBeLessThanOrEqual(0)
    }
  }

  test('at 200 % text the main screens wrap: nothing is clipped and nothing overflows', async ({ page }) => {
    await startWith(page, { ...richDocument, settings: { ...richDocument.settings, locale: 'es' } }, 'es')
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = 'html { font-size: 200% !important; }'
        document.head.append(style)
      })
    })
    await auditScreens(page, '200%')
  })

  test('German at 320 px fits', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await page.setViewportSize({ width: 320, height: 640 })
    await startWith(page, { ...richDocument, settings: { ...richDocument.settings, locale: 'de' } }, 'de')
    await auditScreens(page, 'de-320')
  })
})

test.describe('visual-integrity guard', () => {
  test('reports controls that overlap where they are shown, not a control scrolled under a footer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'a fixture page; one project is enough')
    await page.setContent(`
      <div style="position:fixed;inset:0;display:flex;flex-direction:column;height:300px">
        <div style="flex:1;overflow-y:auto"><div style="height:230px"></div><button style="height:44px">Save</button></div>
        <button style="height:44px">Cancel</button>
      </div>`)
    expect((await visualIntegrityViolations(page)).filter((violation) => violation.includes('overlaps'))).toEqual([])
    await page.setContent(`
      <div style="position:fixed;inset:0">
        <button style="position:absolute;top:10px;left:10px;width:100px;height:44px">One</button>
        <button style="position:absolute;top:20px;left:50px;width:100px;height:44px">Two</button>
      </div>`)
    expect((await visualIntegrityViolations(page)).filter((violation) => violation.includes('overlaps'))).toHaveLength(1)
  })
})
