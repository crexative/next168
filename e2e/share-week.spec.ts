import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { devices, expect, test, type Page } from '@playwright/test'
import { onlyProject, openTab, seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'
import { CARD_FONT, paletteFor } from '../src/features/share/palette'

// "Mi semana tipo": the share card from Summary (spec slice 1, part 1B, E-1B-01 to E-1B-04).

const NOW = new Date('2026-10-21T10:15:00.000Z')
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const english = JSON.parse(readFileSync('src/i18n/en/share.json', 'utf8')) as { footerNoUrl: string }

// A realistic template week: 113 planned hours in six categories, one with an emoji icon.
const categories = [
  { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
  { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
  { id: 'c-gym', name: 'Exercise', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
  { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
  { id: 'c-cook', name: 'Cooking', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } },
  { id: 'c-family', name: 'Family', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } },
]
const blocks = [
  { id: 'b-sleep', categoryId: 'c-sleep', title: 'Night sleep', days: everyDay, start: 1380, end: 420 },
  { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  { id: 'b-gym', categoryId: 'c-gym', title: 'Morning run', days: [1, 3, 5], start: 420, end: 480 },
  { id: 'b-study', categoryId: 'c-study', title: 'Evening course', days: [2, 4], start: 1140, end: 1260 },
  { id: 'b-cook', categoryId: 'c-cook', title: 'Batch cooking', days: [0], start: 600, end: 780 },
  { id: 'b-family', categoryId: 'c-family', title: 'Dinner together', days: everyDay, start: 1080, end: 1140 },
]
const ROUTINE_TITLES = /Night sleep|Deep work|Morning run|Evening course|Batch cooking|Dinner together/
const SUMMARY_TEXT = 'My typical week in Weeklid: 113 h of 168 h planned. Sleep 56 h, Work 40 h, Family 7 h, Study 4 h, Cooking 3 h, Exercise 3 h.'
const FILE_NAME = 'weeklid-my-typical-week.png'
// Cells per colour token: one cell per planned hour, the rest free.
const EXPECTED_CELLS = { purple: 56, blue: 40, teal: 7, orange: 4, pink: 3, green: 3, free: 55 }

async function start(page: Page, overrides: Record<string, unknown> = {}, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: NOW })
  await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ categories, blocks, ...overrides })))
}

// navigator.share that keeps every File it is handed, as a real share target would receive it.
async function captureShares(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: File[] = []
    Object.assign(window, { __shared: shared })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { shared.push(...(data.files ?? [])); Object.assign(window, { __shareText: data.text, __shareTitle: data.title }) } })
  })
}

// Files cannot be shared here (desktop browsers, older phones): the sheet offers the download only.
async function withoutFileSharing(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })
}

async function openSheet(page: Page, tap = false): Promise<void> {
  await openTab(page, 'insights')
  const entry = page.getByRole('button', { name: 'Share my typical week' })
  if (tap) await entry.tap()
  else await entry.click()
  await expect(page.getByRole('dialog', { name: 'Share my typical week' })).toBeVisible()
  await waitReady(page)
}

async function waitReady(page: Page): Promise<void> {
  await expect(page.getByTestId('share-primary')).toBeEnabled()
}

async function previewSize(page: Page): Promise<[number, number]> {
  return page.getByTestId('share-preview').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
}

type CardSource = { preview: true } | { shared: number }
interface CardReading { width: number; height: number; background: string; cells: string[] }

// Decodes the PNG (the preview's bytes, or a File handed to navigator.share) and reads the colour of each of its 168
// mosaic cells. The geometry is the layout's (24 pt margin, 2.5 pt gaps, 21 or 28 columns, drawn at 3x); the mosaic's
// top is the first pixel row where every column's cell is drawn and every gap between them is background.
async function readCard(page: Page, source: CardSource): Promise<CardReading> {
  return page.evaluate(async (from) => {
    // The page's policy has no blob: in connect-src, so the preview is read from its <img>, not fetched.
    const image = 'preview' in from
      ? document.querySelector<HTMLImageElement>('[data-testid="share-preview"]')!
      : (window as unknown as { __shared: File[] }).__shared[from.shared]!
    const bitmap = await createImageBitmap(image)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const hex = (x: number, y: number) => {
      const index = (Math.round(y) * bitmap.width + Math.round(x)) * 4
      return `#${[data[index]!, data[index + 1]!, data[index + 2]!].map((value) => value.toString(16).padStart(2, '0')).join('')}`
    }
    const columns = bitmap.width === bitmap.height ? 28 : 21
    const scale = 3, margin = 24, gap = 2.5
    const cell = (312 - gap * (columns - 1)) / columns
    const cellX = (column: number) => (margin + column * (cell + gap) + cell * 0.2) * scale
    const gapX = (column: number) => (margin + column * (cell + gap) + cell + gap / 2) * scale
    const background = hex(4, 4)
    let top = -1
    for (let y = 0; y < bitmap.height && top < 0; y += 1) {
      const cellsDrawn = Array.from({ length: columns }, (_, column) => hex(cellX(column), y) !== background).every(Boolean)
      const gapsEmpty = Array.from({ length: columns - 1 }, (_, column) => hex(gapX(column), y) === background).every(Boolean)
      if (cellsDrawn && gapsEmpty) top = y
    }
    // Four points 15 % inside each corner, the most frequent colour: a group's first cell carries its glyph in the
    // middle, which covers at most two of them.
    const cells = Array.from({ length: 168 }, (_, index) => {
      const left = margin + (index % columns) * (cell + gap)
      const rowTop = top / scale + Math.floor(index / columns) * (cell + gap)
      const samples = [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].map(([dx, dy]) => hex((left + dx! * cell) * scale, (rowTop + dy! * cell) * scale))
      return samples.sort((a, b) => samples.filter((value) => value === b).length - samples.filter((value) => value === a).length)[0]!
    })
    return { width: bitmap.width, height: bitmap.height, background, cells }
  }, source)
}

function tally(cells: string[], theme: 'light' | 'dark'): Record<string, number> {
  const palette = paletteFor(theme)
  const names = new Map<string, string>([[palette.free, 'free'], ...Object.entries(palette.category).map(([key, value]) => [value, key] as [string, string])])
  const counts: Record<string, number> = {}
  for (const cell of cells) {
    const name = names.get(cell) ?? `unknown ${cell}`
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

test.describe('share my typical week', () => {
  test('a story and a square of the template week, with its text as alt @smoke', async ({ page }) => {
    await start(page)
    await openSheet(page)
    expect(await previewSize(page)).toEqual([1080, 1920])
    const story = await readCard(page, { preview: true })
    expect(story).toMatchObject({ width: 1080, height: 1920, background: paletteFor('light').background })
    expect(story.cells[0]).toBe(paletteFor('light').category.purple)
    expect(tally(story.cells, 'light')).toEqual(EXPECTED_CELLS)
    const text = await page.getByTestId('share-summary-text').textContent()
    expect(text).toBe(SUMMARY_TEXT)
    await expect(page.getByTestId('share-preview')).toHaveAttribute('alt', text!)

    await page.getByRole('radio', { name: 'Square' }).click()
    await waitReady(page)
    expect(await previewSize(page)).toEqual([1080, 1080])
    expect(tally((await readCard(page, { preview: true })).cells, 'light')).toEqual(EXPECTED_CELLS)
  })

  test('the dark appearance draws the dark tokens', async ({ page }) => {
    await start(page, {}, 'dark')
    await openSheet(page)
    const card = await readCard(page, { preview: true })
    expect(card.background).toBe(paletteFor('dark').background)
    expect(tally(card.cells, 'dark')).toEqual(EXPECTED_CELLS)
  })

  // E-1B-02: switching names off and tapping at once never sends the names-on image.
  test('a tap right after turning names off never sends the image with names', async ({ page }) => {
    await captureShares(page)
    await start(page)
    await openSheet(page)
    const names = page.getByRole('switch', { name: 'Show routine names' })
    await names.check()
    await waitReady(page)
    await page.getByTestId('share-primary').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: File[] }).__shared.length)).toBe(1)

    // Both clicks in one task: the switch, then Share before any re-render.
    const sentAtOnce = await page.evaluate(() => {
      document.querySelector<HTMLInputElement>('[data-testid="share-names"]')!.click()
      document.querySelector<HTMLButtonElement>('[data-testid="share-primary"]')!.click()
      return (window as unknown as { __shared: File[] }).__shared.length
    })
    await expect(names).not.toBeChecked()
    await waitReady(page)
    await page.getByTestId('share-primary').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: File[] }).__shared.length)).toBeGreaterThanOrEqual(2)

    // Every image sent after the switch went off equals a fresh names-off render, pixel for pixel; none is the
    // names-on image.
    const verdict = await page.evaluate(async () => {
      const pixels = async (source: Blob | HTMLImageElement) => {
        const bitmap = await createImageBitmap(source)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((value, index) => value === b[index])
      const shared = (window as unknown as { __shared: File[] }).__shared
      const preview = document.querySelector<HTMLImageElement>('[data-testid="share-preview"]')!
      const fresh = await pixels(preview)
      const withNames = await pixels(shared[0]!)
      const afterOff = await Promise.all(shared.slice(1).map(pixels))
      return { equalsFresh: afterOff.map((image) => same(image, fresh)), equalsNamesOn: afterOff.map((image) => same(image, withNames)), namesOnDiffers: !same(withNames, fresh) }
    })
    // The immediate tap was refused (nothing prepared for names off yet); had it sent anything, it would be checked
    // against the names-off render below like every later image.
    expect(sentAtOnce).toBe(1)
    expect(verdict.namesOnDiffers).toBe(true)
    expect(verdict.equalsFresh.every(Boolean)).toBe(true)
    expect(verdict.equalsNamesOn.some(Boolean)).toBe(false)
    expect(await page.evaluate(() => (window as unknown as { __shareText: string }).__shareText)).not.toMatch(ROUTINE_TITLES)
  })

  // E-1B-03
  test('no routines, no entry', async ({ page }) => {
    await start(page, { blocks: [] })
    await openTab(page, 'insights')
    await expect(page.getByTestId('capacity-available')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share my typical week' })).toHaveCount(0)
  })

  test('without a configured public address the card and the text carry no address', async ({ page }) => {
    await start(page)
    await openSheet(page)
    await expect(page.getByTestId('share-summary-text')).not.toContainText('http')
    // The footer band of the card equals the footerNoUrl line drawn alone with the card's font, colour and position.
    const differing = await page.getByTestId('share-preview').evaluate(async (image: HTMLImageElement, { font, footer, colors }) => {
      const band = { top: (640 - 90 - 13) * 3, height: 18 * 3 }
      const read = (draw: (context: CanvasRenderingContext2D) => void) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1080
        canvas.height = 1920
        const context = canvas.getContext('2d')!
        draw(context)
        return context.getImageData(0, band.top, 1080, band.height).data
      }
      const card = read((context) => context.drawImage(image, 0, 0))
      const reference = read((context) => {
        context.fillStyle = colors.background
        context.fillRect(0, 0, 1080, 1920)
        context.font = `600 39px ${font}`
        context.fillStyle = colors.tintLabel
        context.textBaseline = 'alphabetic'
        context.fillText(footer, 72, (640 - 90) * 3)
      })
      let count = 0
      for (let index = 0; index < card.length; index += 1) if (card[index] !== reference[index]) count += 1
      return count
    }, { font: CARD_FONT, footer: english.footerNoUrl.replace('{app}', 'Weeklid'), colors: paletteFor('light') })
    expect(differing).toBe(0)
  })

  // E-1B-04
  test('the sheet is accessible, fits 320 px at 200 % text and works from the keyboard', async ({ page }) => {
    await start(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' }) })
    await openSheet(page)
    const dialog = page.getByRole('dialog', { name: 'Share my typical week' })
    const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[role="dialog"]').analyze()
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(', ')}`)).toEqual([])

    const names = dialog.getByRole('switch', { name: 'Show routine names' })
    await expect(names).toHaveAttribute('aria-checked', 'false')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const overflowing = await dialog.evaluate((panel) => Array.from(panel.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.getClientRects().length > 0 && element.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((element) => `${element.tagName}.${element.className}`))
    expect(overflowing).toEqual([])

    // Tab reaches every control of the sheet; Escape closes it.
    const label = () => page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      return active?.dataset.testid ?? active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? ''
    })
    const controls = await dialog.evaluate((panel) => Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]'))
      .filter((element) => element.tabIndex >= 0)
      .map((element) => element.dataset.testid ?? element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''))
    expect(controls).toEqual(expect.arrayContaining(['share-copy', 'share-names', 'share-primary', 'Story']))
    const reached = new Set<string>()
    for (let step = 0; step < controls.length + 2; step += 1) {
      await page.keyboard.press('Tab')
      reached.add(await label())
    }
    expect([...reached].sort()).toEqual(expect.arrayContaining([...controls].sort()))
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  // Every width the app supports, both appearances, reduced motion: the sheet opens in place, keeps focus inside,
  // clips nothing and keeps every control at 44 px or more. Where files can be shared there are two actions: one
  // full-width row each on a phone, side by side on a wider sheet.
  for (const sharing of [false, true]) {
    test(`the sheet at 320, 375, 768 and 1440 px, light and dark, with reduced motion (${sharing ? 'share and download' : 'download only'})`, async ({ page, browserName }, testInfo) => {
      onlyProject('desktop')({ browserName }, testInfo)
      if (sharing) await captureShares(page)
      else await withoutFileSharing(page)
      await start(page)
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        for (const width of [320, 375, 768, 1440]) {
          await page.setViewportSize({ width, height: width < 768 ? 740 : 900 })
          await openTab(page, 'insights')
          await page.getByRole('button', { name: 'Share my typical week' }).click()
          const dialog = page.getByRole('dialog', { name: 'Share my typical week' })
          await expect(dialog).toBeVisible()
          const state = `${theme} ${width}px`
          // With reduced motion the panel is in place at once: no slide, no scale.
          expect(await page.locator('.sheet-panel').evaluate((panel) => getComputedStyle(panel).transform), state).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
          await waitReady(page)
          expect(await dialog.evaluate((panel) => panel.contains(document.activeElement)), `${state}: focus inside`).toBe(true)
          const problems = await dialog.evaluate((panel) => {
            const found: string[] = []
            const limit = document.documentElement.clientWidth
            if (document.documentElement.scrollWidth > limit + 1) found.push('page scrolls horizontally')
            for (const element of [panel as HTMLElement, ...Array.from(panel.querySelectorAll<HTMLElement>('*'))]) {
              if (element.getClientRects().length === 0) continue
              const box = element.getBoundingClientRect()
              const name = `${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? '').trim().slice(0, 20)}"`
              if (box.left < -0.5 || box.right > limit + 0.5) found.push(`${name} leaves the screen`)
              if (getComputedStyle(element).overflowX !== 'visible' && element.scrollWidth > element.clientWidth + 1) found.push(`${name} clips its content`)
            }
            const targets = [...Array.from(panel.querySelectorAll<HTMLElement>('button')), ...Array.from(panel.querySelectorAll<HTMLElement>('label'))]
            for (const target of targets) {
              const box = target.getBoundingClientRect()
              if (box.height < 43.5 || box.width < 43.5) found.push(`"${(target.textContent ?? target.getAttribute('aria-label') ?? '').trim()}" is ${box.width.toFixed(0)}×${box.height.toFixed(0)} px`)
            }
            return found
          })
          expect(problems, state).toEqual([])
          const actions = await dialog.evaluate((panel) => {
            const box = (testId: string) => {
              const element = panel.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
              if (!element) return null
              const { left, right, top, bottom, width } = element.getBoundingClientRect()
              return { left, right, top, bottom, width }
            }
            const row = panel.querySelector<HTMLElement>('.actions')!.getBoundingClientRect()
            return { row: { left: row.left, width: row.width }, share: box('share-primary'), download: box('share-download') }
          })
          if (!sharing) {
            expect(actions.download, `${state}: one action`).toBeNull()
            expect(actions.share!.width, `${state}: the download spans the row`).toBeCloseTo(actions.row.width, 0)
          } else if (width < 768) {
            const [share, download] = [actions.share!, actions.download!]
            expect(download.top, `${state}: download on its own row`).toBeGreaterThanOrEqual(share.bottom)
            for (const action of [share, download]) {
              expect(action.left, state).toBeCloseTo(actions.row.left, 0)
              expect(action.width, `${state}: full width`).toBeCloseTo(actions.row.width, 0)
            }
          } else {
            const [share, download] = [actions.share!, actions.download!]
            expect(download.top, `${state}: side by side`).toBeCloseTo(share.top, 0)
            expect(download.left, `${state}: download after share`).toBeGreaterThanOrEqual(share.right)
          }
          await page.keyboard.press('Escape')
          await expect(dialog).toHaveCount(0)
        }
      }
    })
  }
})

// Mobile web: the same flows on an Android phone (Chromium, Pixel 7) and an iPhone (WebKit, iPhone 15), emulated.
// Each runs in the existing phone projects only, so CI adds no browser project.
for (const { label, device, project } of [
  { label: 'Android, Pixel 7', device: devices['Pixel 7'], project: 'phone' },
  { label: 'iPhone 15', device: devices['iPhone 15'], project: 'webkit-phone' },
]) {
  test.describe(`share my typical week on mobile web (${label})`, () => {
    // The device's screen, pixel ratio, touch and user agent; the browser comes from the project.
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = device
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })
    test.beforeEach(({ browserName }, testInfo) => onlyProject(project)({ browserName }, testInfo))

    test('the Web Share sheet receives the PNG of the week @smoke', async ({ page }) => {
      await captureShares(page)
      await start(page)
      await openSheet(page, true)
      const dialog = page.getByRole('dialog', { name: 'Share my typical week' })
      expect(await dialog.evaluate((panel) => panel.contains(document.activeElement))).toBe(true)
      await expect(page.getByTestId('share-primary')).toHaveText(/Share image/)
      await page.getByTestId('share-primary').tap()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: File[] }).__shared.length)).toBe(1)
      const file = await page.evaluate(() => {
        const [shared] = (window as unknown as { __shared: File[] }).__shared
        const sent = window as unknown as { __shareText: string; __shareTitle: string }
        return { name: shared!.name, type: shared!.type, size: shared!.size, text: sent.__shareText, title: sent.__shareTitle }
      })
      expect(file).toMatchObject({ name: FILE_NAME, type: 'image/png', text: SUMMARY_TEXT, title: 'Share my typical week' })
      expect(file.size).toBeGreaterThan(10_000)
      expect(file.text).not.toMatch(ROUTINE_TITLES)
      const card = await readCard(page, { shared: 0 })
      expect([card.width, card.height]).toEqual([1080, 1920])
      expect(tally(card.cells, 'light')).toEqual(EXPECTED_CELLS)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    })

    test('without file sharing the image downloads as a Weeklid PNG @smoke', async ({ page }, testInfo) => {
      await withoutFileSharing(page)
      await start(page, {}, 'dark')
      await openSheet(page, true)
      await expect(page.getByTestId('share-primary')).toHaveText(/Download image/)
      await expect(page.getByTestId('share-download')).toHaveCount(0)
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-primary').tap()])
      expect(download.suggestedFilename()).toBe(FILE_NAME)
      const path = testInfo.outputPath(FILE_NAME)
      await download.saveAs(path)
      const bytes = readFileSync(path)
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1080, 1920])
    })

    test('an empty week offers no image @smoke', async ({ page }) => {
      await start(page, { blocks: [] })
      await openTab(page, 'insights')
      await expect(page.getByTestId('capacity-available')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Share my typical week' })).toHaveCount(0)
    })
  })
}
