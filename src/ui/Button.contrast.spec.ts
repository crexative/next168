import { describe, expect, it } from 'vitest'
import { SURFACES, contrast, mixOver, rgb, themes } from './contrastSupport'

describe('tinted button label contrast', () => {
  for (const { name, tokens } of themes) {
    for (const surface of SURFACES) {
      for (const [fill, label] of [['--tint', '--tint-label'], ['--danger', '--danger-label']]) {
        it(`${name}: ${label} reaches AA over 12% ${fill} on ${surface}`, () => {
          const fillColor = rgb(tokens[fill!]!)
          const surfaceColor = rgb(tokens[surface]!)
          const background = mixOver(fillColor, 12, surfaceColor)
          const ratio = contrast(rgb(tokens[label!]!), background)
          expect(ratio, `${name}, ${label} on ${surface}: ${ratio.toFixed(4)}:1`)
            .toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})
