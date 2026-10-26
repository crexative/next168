import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { openTab, seedKey, V2_KEY } from './fixtures'
import { onboardedDocument } from './support/seed'
import { CARD_FONT, paletteFor } from '../src/features/share/palette'

// "Mi semana tipo": the share card from Summary (spec slice 1, part 1B, E-1B-01 to E-1B-04).

const NOW = new Date('2026-10-21T10:15:00.000Z')
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const english = JSON.parse(readFileSync('src/i18n/en/share.json', 'utf8')) as { footerNoUrl: string }

const categories = [
  { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
  { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
  { id: 'c-gym', name: 'Exercise', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
]
const blocks = [
  { id: 'b-sleep', categoryId: 'c-sleep', title: 'Night sleep', days: everyDay, start: 1380, end: 420 },
  { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  { id: 'b-gym', categoryId: 'c-gym', title: 'Morning run', days: [1, 3, 5], start: 420, end: 480 },
]

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
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { shared.push(...(data.files ?? [])); Object.assign(window, { __shareText: data.text }) } })
  })
}

async function openSheet(page: Page): Promise<void> {
  await openTab(page, 'insights')
  await page.getByRole('button', { name: 'Share my typical week' }).click()
  await expect(page.getByRole('dialog', { name: 'Share my typical week' })).toBeVisible()
  await waitReady(page)
}

async function waitReady(page: Page): Promise<void> {
  await expect(page.getByTestId('share-primary')).toBeEnabled()
}

async function previewSize(page: Page): Promise<[number, number]> {
  return page.getByTestId('share-preview').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
}

// The colour of the first mosaic cell: down the column 4 px inside the mosaic's left edge (24 pt × 3), the first
// saturated pixel, then 3 px further in. Text above it is black, white or grey; the cell glyph sits in its centre.
async function firstCellColor(page: Page): Promise<string> {
  return page.getByTestId('share-preview').evaluate(async (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const x = 72 + 4
    for (let y = 0; y < canvas.height - 4; y += 1) {
      const [r, g, b] = context.getImageData(x, y, 1, 1).data
      if (Math.max(r!, g!, b!) - Math.min(r!, g!, b!) > 60) {
        const [cr, cg, cb] = context.getImageData(x, y + 3, 1, 1).data
        return `#${[cr!, cg!, cb!].map((value) => value.toString(16).padStart(2, '0')).join('')}`
      }
    }
    return 'none'
  })
}

test.describe('share my typical week', () => {
  test('a story and a square of the template week, with its text as alt @smoke', async ({ page }) => {
    await start(page)
    await openSheet(page)
    expect(await previewSize(page)).toEqual([1080, 1920])
    expect(await firstCellColor(page)).toBe(paletteFor('light').category.purple)
    const text = await page.getByTestId('share-summary-text').textContent()
    expect(text).toBe('My typical week in Weeklid: 99 h of 168 h planned. Sleep 56 h, Work 40 h, Exercise 3 h.')
    await expect(page.getByTestId('share-preview')).toHaveAttribute('alt', text!)

    await page.getByRole('radio', { name: 'Square' }).click()
    await waitReady(page)
    expect(await previewSize(page)).toEqual([1080, 1080])
    expect(await firstCellColor(page)).toBe(paletteFor('light').category.purple)
  })

  test('the dark appearance draws the dark tokens', async ({ page }) => {
    await start(page, {}, 'dark')
    await openSheet(page)
    expect(await firstCellColor(page)).toBe(paletteFor('dark').category.purple)
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
      const pixels = async (source: Blob) => {
        const bitmap = await createImageBitmap(source)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((value, index) => value === b[index])
      const shared = (window as unknown as { __shared: File[] }).__shared
      const preview = document.querySelector<HTMLImageElement>('[data-testid="share-preview"]')!
      const fresh = await pixels(await (await fetch(preview.src)).blob())
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
    expect(await page.evaluate(() => (window as unknown as { __shareText: string }).__shareText)).not.toMatch(/Night sleep|Deep work|Morning run/)
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
})
