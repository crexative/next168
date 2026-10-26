import { describe, expect, it } from 'vitest'
import { COLOR_KEYS } from '@/core/model'
import { SURFACES, contrast, rgb, themes, type Rgb } from './contrastSupport'

// OKLab distance: about 0.1 is where two swatches stop reading as "the same colour" at a glance.
const MIN_DISTANCE = 0.12

function oklab([red, green, blue]: Rgb): Rgb {
  const linear = (channel: number) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  const [r, g, b] = [linear(red), linear(green), linear(blue)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function distance(first: string, second: string): number {
  const [a, b] = [oklab(rgb(first)), oklab(rgb(second))]
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('category palette', () => {
  for (const { name, tokens } of themes) {
    it(`${name}: every pair of categories, and each against the tint, is distinct`, () => {
      const swatches = [...COLOR_KEYS.map((key) => [key, tokens[`--cat-${key}`]!] as const), ['tint', tokens['--tint']!] as const]
      for (const [index, [first, firstColor]] of swatches.entries()) {
        for (const [second, secondColor] of swatches.slice(index + 1)) {
          const gap = distance(firstColor, secondColor)
          expect(gap, `${name}: ${first} vs ${second} = ${gap.toFixed(3)}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
        }
      }
    })

    it(`${name}: the tint stays apart from the success, warning and destructive colours`, () => {
      for (const status of ['--success', '--warning', '--danger']) {
        const gap = distance(tokens['--tint']!, tokens[status]!)
        expect(gap, `${name}: tint vs ${status} = ${gap.toFixed(3)}`).toBeGreaterThanOrEqual(MIN_DISTANCE)
      }
    })

    for (const surface of SURFACES) {
      it(`${name}: every category stroke reaches 3:1 on ${surface}`, () => {
        for (const key of COLOR_KEYS) {
          const ratio = contrast(rgb(tokens[`--cat-${key}-stroke`]!), rgb(tokens[surface]!))
          expect(ratio, `${name}: --cat-${key}-stroke on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        }
      })

      it(`${name}: field borders reach 3:1 on ${surface}`, () => {
        const ratio = contrast(rgb(tokens['--field-border']!), rgb(tokens[surface]!))
        expect(ratio, `${name}: --field-border on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      })
    }
  }
})
