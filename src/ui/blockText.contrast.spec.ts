import { describe, expect, it } from 'vitest'
import { contrast, mixOver, rgb, themes, type Rgb } from './contrastSupport'

// Week blocks draw their time and category in --label-on-fill over `color-mix(category --cat-fill-strength, --surface)`
// (DayColumn.vue). That text is 12 px, so it needs 4.5:1 on every category fill in every theme.
const CATEGORIES = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow', 'red', 'gray']

function resolve(tokens: Record<string, string>, value: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value)
  return reference ? resolve(tokens, tokens[reference[1]!]!) : value
}

function textOver(value: string, background: Rgb): Rgb {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
  if (!rgba) return rgb(value)
  const alpha = Number(rgba[4])
  return [1, 2, 3].map((index, channel) => (Number(rgba[index]) / 255) * alpha + background[channel]! * (1 - alpha)) as Rgb
}

describe('secondary text on Week block fills', () => {
  for (const { name, tokens } of themes) {
    it(`${name}: --label-on-fill reaches 4.5:1 on every category fill`, () => {
      const strength = Number.parseFloat(tokens['--cat-fill-strength']!)
      for (const category of CATEGORIES) {
        const background = mixOver(rgb(tokens[`--cat-${category}`]!), strength, rgb(tokens['--surface']!))
        const ratio = contrast(textOver(resolve(tokens, tokens['--label-on-fill']!), background), background)
        expect(ratio, `${category}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})
