import { describe, expect, it } from 'vitest'
import { COLOR_KEYS } from '@/core/model'
import { base, explicitDark, systemDark } from '@/ui/contrastSupport'
import { PALETTE_TOKENS, paletteFor } from './palette'

// T-1B-05: a canvas cannot read custom properties, so the card's palette repeats tokens.css; this keeps them equal.
describe('share palette', () => {
  const themes = [
    ['light', base],
    ['dark (system)', { ...base, ...systemDark }],
    ['dark (chosen)', { ...base, ...explicitDark }],
  ] as const

  it.each(themes)('mirrors the %s tokens', (name, tokens) => {
    const palette = paletteFor(name === 'light' ? 'light' : 'dark')
    for (const [entry, token] of Object.entries(PALETTE_TOKENS)) {
      expect(palette[entry as keyof typeof PALETTE_TOKENS], `${entry} = ${token}`).toBe(tokens[token])
    }
    for (const key of COLOR_KEYS) expect(palette.category[key], key).toBe(tokens[`--cat-${key}-stroke`])
  })
})
