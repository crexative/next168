import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
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
    fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {},
    fillText(text: string) { drawn.push(text) },
    measureText(text: string) { return { width: text.length * Number.parseFloat(context.font.split(' ')[1]!) * 0.6 } as TextMetrics },
  }
  return context as unknown as CardContext & { drawn: string[] }
}

function paintCard(includeNames: boolean): string[] {
  const summary = buildShareSummary(sentinelDocument(), { includeNames, brand: { name: 'Next168', slug: 'next168' } })
  const context = recordingContext()
  for (const format of ['story', 'square'] as const) {
    paint(context, layoutCard(summary, { format, copy: cardCopy(summary, i18n.global.t, 'en'), palette: paletteFor('light') }, canvasMeasure(context)))
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
      const summary = buildShareSummary(sentinelDocument(), { includeNames, brand: { name: 'Next168', slug: 'next168' } })
      expect(summaryText(summary, i18n.global.t, 'en')).not.toMatch(/SENTINEL/)
    }
  })
})
