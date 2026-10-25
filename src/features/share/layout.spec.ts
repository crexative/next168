import { afterEach, describe, expect, it } from 'vitest'
import type { PlannerDocument } from '@/core/model'
import { i18n, SUPPORTED_LOCALES } from '@/i18n'
import { CARD_FORMATS, layoutCard, type CardLayout, type DrawOp, type ShareFormat } from './layout'
import { paletteFor, type ShareTheme } from './palette'
import { buildShareSummary, shareGroups } from './shareSummary'
import { cardCopy, summaryText } from './summaryText'
import { manyCategoriesDocument, overlapDocument, plannedDocument, sentinelDocument, singleCategoryDocument, widestGlyphMeasure, EVERY_DAY } from './testFixtures'

type TextOp = Extract<DrawOp, { kind: 'text' }>
type RectOp = Extract<DrawOp, { kind: 'rect' }>
const EPSILON = 0.01
const brand = { name: 'Next168', slug: 'next168' }

function withLocale<T>(locale: string, run: () => T): T {
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  return run()
}
afterEach(() => { i18n.global.locale.value = 'en' })

function render(document: PlannerDocument, options: { format: ShareFormat; theme?: ShareTheme; includeNames?: boolean; locale?: string; publicUrl?: string }): { card: CardLayout; copy: ReturnType<typeof cardCopy> } {
  return withLocale(options.locale ?? 'en', () => {
    const summary = buildShareSummary(document, { includeNames: options.includeNames ?? false, brand: { ...brand, ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}) } })
    const copy = cardCopy(summary, i18n.global.t, options.locale ?? 'en')
    return { card: layoutCard(summary, { format: options.format, copy, palette: paletteFor(options.theme ?? 'light') }, widestGlyphMeasure), copy }
  })
}

const texts = (card: CardLayout) => card.ops.filter((op): op is TextOp => op.kind === 'text')
const rects = (card: CardLayout) => card.ops.filter((op): op is RectOp => op.kind === 'rect')

function intersects(a: TextOp['box'], b: TextOp['box']): boolean {
  return a.x < b.x + b.width - EPSILON && b.x < a.x + a.width - EPSILON && a.y < b.y + b.height - EPSILON && b.y < a.y + a.height - EPSILON
}

function layoutProblems(card: CardLayout, headline: string, caption: string): string[] {
  const problems: string[] = []
  const ops = texts(card)
  for (const op of ops) {
    if (op.box.width > op.maxWidth + EPSILON) problems.push(`"${op.text}" (${op.role}) is ${op.box.width} wide in ${op.maxWidth}`)
    if (op.box.x < 24 - EPSILON || op.box.x + op.box.width > card.width - 24 + EPSILON) problems.push(`"${op.text}" (${op.role}) leaves the margins`)
  }
  ops.forEach((a, i) => ops.slice(i + 1).forEach((b) => {
    if (intersects(a.box, b.box)) problems.push(`"${a.text}" (${a.role}) overlaps "${b.text}" (${b.role})`)
  }))
  if (card.contentBottom > card.footerTop + EPSILON) problems.push(`content ends at ${card.contentBottom}, below the footer top ${card.footerTop}`)
  const joined = (role: string) => ops.filter((op) => op.role === role).map((op) => op.text).join(' ')
  if (joined('headline').replace(/\s+/g, '') !== headline.replace(/\s+/g, '')) problems.push(`headline "${joined('headline')}" is not "${headline}"`)
  if (!/\S/.test(joined('footer')) || joined('footer').includes('…')) problems.push(`footer "${joined('footer')}" is cut`)
  if (joined('caption').replace(/\s+/g, '') !== caption.replace(/\s+/g, '')) problems.push(`caption "${joined('caption')}" is not "${caption}"`)
  return problems
}

const LONG_URL = 'https://crexative.github.io/next168/'
const longName = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze und Freunde'
const rtlName = 'שינה ועבודה ומשפחה וחברים וספורט וקריאה בערב'
const scenarios: [string, PlannerDocument][] = [
  ['normal', sentinelDocument()],
  ['30 categories', manyCategoriesDocument(30)],
  ['long and RTL names', manyCategoriesDocument(6, (index) => (index % 2 ? rtlName : longName).slice(0, 60))],
  ['custom white and black colours', plannedDocument(
    [
      { id: 'w', name: 'White', colorKey: 'blue', customColor: '#FFFFFF', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'k', name: 'Black', colorKey: 'blue', customColor: '#000000', goal: { type: 'none', hoursPerWeek: 0 } },
    ],
    [
      { id: 'w', categoryId: 'w', title: 'White routine', days: EVERY_DAY, start: 0, end: 480 },
      { id: 'k', categoryId: 'k', title: 'Black routine', days: EVERY_DAY, start: 540, end: 900 },
    ],
  )],
  ['single category', singleCategoryDocument()],
  ['overlap of 465 h', overlapDocument()],
]

// T-1B-03: real copy of every locale, both formats and themes, names on and off, a pessimistic measurer.
describe('layoutCard', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [name, document] of scenarios) {
      for (const format of ['story', 'square'] as const) {
        it(`fits ${name} in ${locale} (${format})`, () => {
          for (const theme of ['light', 'dark'] as const) {
            for (const [includeNames, publicUrl] of [[false, undefined], [true, undefined], [false, LONG_URL], [true, LONG_URL]] as const) {
              const { card, copy } = render(document, { format, theme, includeNames, locale, publicUrl })
              expect(layoutProblems(card, copy.headline, copy.caption), `${theme}, names ${includeNames}, ${publicUrl ?? 'no URL'}`).toEqual([])
              expect(card).toMatchObject({ width: CARD_FORMATS[format].width, height: CARD_FORMATS[format].height })
            }
          }
        })
      }
    }
  }

  it('says the cells are proportional, with the raw total, when routines overlap', () => {
    const { card } = render(overlapDocument(), { format: 'story' })
    const caption = texts(card).filter((op) => op.role === 'caption').map((op) => op.text).join(' ')
    expect(caption).toBe('Your routines add up to 465 h because some overlap; the squares show the proportion')
    expect(texts(card).some((op) => op.text.includes('Each square is 1 hour'))).toBe(false)
  })

  // T-1B-07: a fill that does not stand out from the card gets an outline, and every group a glyph.
  it.each([['light', '#FFFFFF'], ['dark', '#000000']] as const)('outlines a custom %s-mode colour %s in the mosaic and the legend', (theme, color) => {
    const document = plannedDocument(
      [
        { id: 'x', name: 'Custom', colorKey: 'blue', customColor: color, goal: { type: 'none', hoursPerWeek: 0 } },
        { id: 'y', name: 'Keyed', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
      ],
      [
        { id: 'x', categoryId: 'x', title: 'Custom routine', days: EVERY_DAY, start: 0, end: 480 },
        { id: 'y', categoryId: 'y', title: 'Keyed routine', days: EVERY_DAY, start: 540, end: 600 },
      ],
    )
    const { card } = render(document, { format: 'story', theme })
    const custom = rects(card).filter((op) => op.group === 0 && op.fill === color)
    expect(custom.filter((op) => op.role === 'cell')).toHaveLength(56)
    expect(custom.every((op) => op.outline?.color === paletteFor(theme).label2)).toBe(true)
    expect(custom.filter((op) => op.role === 'swatch')).toHaveLength(1)
    const keyed = rects(card).filter((op) => op.group === 1 && op.role === 'cell')
    expect(keyed.every((op) => op.outline === undefined)).toBe(true)
    const glyphs = texts(card).filter((op) => op.role === 'glyph').map((op) => op.text)
    // One glyph on each group's first cell and one in each legend swatch.
    expect(glyphs).toEqual(['C', 'K', 'C', 'K'])
  })

  it('marks "others" with a glyph and an outline too', () => {
    const { card } = render(manyCategoriesDocument(30), { format: 'square' })
    const groups = shareGroups(buildShareSummary(manyCategoriesDocument(30), { includeNames: false, brand }))
    expect(texts(card).filter((op) => op.role === 'glyph')).toHaveLength(groups.length * 2)
    expect(rects(card).filter((op) => op.group === 5).every((op) => op.fill === undefined && op.outline !== undefined)).toBe(true)
  })

  // T-1B-08 (no address configured): nothing on the card or in the text points anywhere.
  it('prints no address without a configured public URL', () => {
    for (const format of ['story', 'square'] as const) {
      const { card } = render(sentinelDocument(), { format, includeNames: true })
      expect(texts(card).filter((op) => /http|:\/\/|www\./i.test(op.text))).toEqual([])
      expect(texts(card).find((op) => op.role === 'footer')!.text).toBe('Plan your 168 h with Next168')
    }
    const summary = buildShareSummary(sentinelDocument(), { includeNames: true, brand })
    expect(summaryText(summary, i18n.global.t, 'en')).not.toMatch(/http/)
  })

  it('prints the validated address, without its scheme, when one is configured', () => {
    const summary = buildShareSummary(sentinelDocument(), { includeNames: false, brand: { ...brand, publicUrl: 'https://next168.app/' } })
    const copy = cardCopy(summary, i18n.global.t, 'en')
    const card = layoutCard(summary, { format: 'story', copy, palette: paletteFor('light') }, widestGlyphMeasure)
    expect(texts(card).filter((op) => op.role === 'footer').map((op) => op.text).join(' ')).toBe('Plan your 168 h · next168.app')
    expect(summaryText(summary, i18n.global.t, 'en').endsWith(' https://next168.app/')).toBe(true)
  })
})
