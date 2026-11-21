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

// The redesign's solid fills and text tokens (DIRECTION §5): the tinted button, selected chips and the current tab
// are --tint-label on --tint-soft; secondary text may sit on any surface or on --tint-soft; attention text is amber.
describe('redesign text tokens', () => {
  for (const { name, tokens } of themes) {
    for (const [label, background] of [
      ['--tint-label', '--tint-soft'], ['--label-2', '--tint-soft'], ['--label', '--tint-soft'], ['--label', '--segment-selected'],
      ...SURFACES.flatMap((surface) => [['--label-2', surface], ['--warning-label', surface], ['--danger-label', surface], ['--tint-label', surface]]),
    ] as const) {
      it(`${name}: ${label} reaches AA on ${background}`, () => {
        const ratio = contrast(rgb(tokens[label]!), rgb(tokens[background]!))
        expect(ratio, `${name}, ${label} on ${background}: ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5)
      })
    }
    it(`${name}: white labels reach AA on --tint`, () => {
      expect(contrast(rgb('#ffffff'), rgb(tokens['--tint']!))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
