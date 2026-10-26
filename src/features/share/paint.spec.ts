import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { BRAND } from '@/app/brand'
import { SYMBOL_TICK, SYMBOL_W, WORDMARK_PATH } from '@/ui/brandMark'
import { layoutCard } from './layout'
import { canvasMeasure, paint, type CardContext } from './paint'
import { paletteFor } from './palette'
import { buildShareSummary } from './shareSummary'
import { cardCopy, summaryText } from './summaryText'
import { BLOCK_SENTINEL, sentinelDocument } from './testFixtures'

// A 2D context that records every string drawn, with a font-size based advance.
function recordingContext(): CardContext & { drawn: string[] } {
  const drawn: string[] = []
  const context = {
    drawn, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', direction: 'ltr',
    lineCap: 'butt', lineJoin: 'miter',
    fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, save() {}, restore() {}, translate() {}, scale() {},
    fillText(text: string) { drawn.push(text) },
    measureText(text: string) { return { width: text.length * Number.parseFloat(context.font.split(' ')[1]!) * 0.6 } as TextMetrics },
  }
  return context as unknown as CardContext & { drawn: string[] }
}

function paintCard(includeNames: boolean): string[] {
  const summary = buildShareSummary(sentinelDocument(), { includeNames, brand: { name: 'Weeklid', slug: 'weeklid' } })
  const context = recordingContext()
  for (const format of ['story', 'square'] as const) {
    paint(context, layoutCard(summary, { format, copy: cardCopy(summary, i18n.global.t, 'en'), palette: paletteFor('light') }, canvasMeasure(context)), 3, () => ({}) as Path2D)
  }
  return context.drawn
}

// T-1B-04: what reaches the bitmap, and what travels as text.
describe('paint', () => {
  it('draws no routine title with names off', () => {
    const drawn = paintCard(false)
    expect(drawn.length).toBeGreaterThan(10)
    expect(drawn.join('\n')).not.toMatch(/SENTINEL/)
  })

  it('draws routine titles, and nothing else private, with names on', () => {
    const drawn = paintCard(true).join('\n')
    expect(drawn).toContain(BLOCK_SENTINEL)
    expect(drawn.replace(new RegExp(`${BLOCK_SENTINEL}-[A-Z0-9]+`, 'g'), '')).not.toMatch(/SENTINEL/)
  })

  it('never puts a routine title in the shared text or the alt, whatever the switch says', () => {
    for (const includeNames of [false, true]) {
      const summary = buildShareSummary(sentinelDocument(), { includeNames, brand: { name: 'Weeklid', slug: 'weeklid' } })
      expect(summaryText(summary, i18n.global.t, 'en')).not.toMatch(/SENTINEL/)
    }
  })

  // Weeklid on the card: its own lockup paths in the brand colours, the planned figure in green, no old name.
  it.each(['light', 'dark'] as const)('draws the Weeklid lockup and the green figure (%s)', (theme) => {
    const palette = paletteFor(theme)
    const summary = buildShareSummary(sentinelDocument(), { includeNames: false, brand: BRAND })
    const strokes: [string, string][] = []
    const fills: [string, string][] = []
    const texts: [string, string][] = []
    const context = recordingContext()
    Object.assign(context, {
      stroke(path?: { data: string }) { if (path) strokes.push([path.data, String(context.strokeStyle)]) },
      fill(path?: { data: string }) { if (path) fills.push([path.data, String(context.fillStyle)]) },
      fillText(text: string) { texts.push([text, String(context.fillStyle)]) },
    })
    const copy = cardCopy(summary, i18n.global.t, 'en')
    paint(context, layoutCard(summary, { format: 'story', copy, palette }, canvasMeasure(context)), 3, (data) => ({ data }) as unknown as Path2D)
    expect(strokes).toEqual([[SYMBOL_W, palette.mark], [SYMBOL_TICK, palette.accent]])
    expect(fills).toEqual([[WORDMARK_PATH, palette.label]])
    expect(texts.find(([text]) => text === '102 h')).toEqual(['102 h', palette.mark])
    expect(texts.map(([text]) => text).join(' ')).not.toMatch(/next168/i)
    expect(summaryText(summary, i18n.global.t, 'en')).toMatch(/^My typical week in Weeklid: /)
    expect(texts.map(([text]) => text)).toContain('Plan your 168 h with Weeklid')
  })
})
