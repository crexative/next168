import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const tokensCss = readFileSync('src/assets/tokens.css', 'utf8')

type Rgb = [number, number, number]

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = tokensCss.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`))
  if (!block) throw new Error(`Missing token block: ${selector}`)
  return Object.fromEntries([...block[1]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value!.trim()]))
}

function rgb(value: string): Rgb {
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as Rgb
  }
  const hsl = value.match(/^hsl\(([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)$/)
  if (!hsl) throw new Error(`Unsupported token color: ${value}`)
  const hue = Number(hsl[1]) / 30
  const saturation = Number(hsl[2]) / 100
  const lightness = Number(hsl[3]) / 100
  const amplitude = saturation * Math.min(lightness, 1 - lightness)
  return [0, 8, 4].map((offset) => {
    const channel = (offset + hue) % 12
    return lightness - amplitude * Math.max(-1, Math.min(channel - 3, 9 - channel, 1))
  }) as Rgb
}

function luminance(color: Rgb): number {
  const linear = color.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4)
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

function contrast(foreground: Rgb, background: Rgb): number {
  const values = [luminance(foreground), luminance(background)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

const base = declarations(':root')
const systemDark = declarations(":root:not([data-theme='light'])")
const explicitLight = declarations(":root[data-theme='light']")
const explicitDark = declarations(":root[data-theme='dark']")
const themes = [
  { name: 'system light', tokens: base },
  { name: 'system dark', tokens: { ...base, ...systemDark } },
  { name: 'explicit light / system light', tokens: { ...base, ...explicitLight } },
  { name: 'explicit light / system dark', tokens: { ...base, ...explicitLight } },
  { name: 'explicit dark / system light', tokens: { ...base, ...explicitDark } },
  { name: 'explicit dark / system dark', tokens: { ...base, ...systemDark, ...explicitDark } },
]

describe('tinted button label contrast', () => {
  for (const { name, tokens } of themes) {
    // Page/grouped background, elevated/card surface, and secondary surface.
    for (const surface of ['--bg', '--surface', '--surface-2']) {
      for (const [fill, label] of [['--tint', '--tint-label'], ['--danger', '--danger-label']]) {
        it(`${name}: ${label} reaches AA over 12% ${fill} on ${surface}`, () => {
          const fillColor = rgb(tokens[fill!]!)
          const surfaceColor = rgb(tokens[surface]!)
          // color-mix with transparent retains the fill's sRGB channels at 12% alpha.
          const background = fillColor.map((channel, index) =>
            channel * 0.12 + surfaceColor[index]! * 0.88) as Rgb
          const ratio = contrast(rgb(tokens[label!]!), background)
          expect(ratio, `${name}, ${label} on ${surface}: ${ratio.toFixed(4)}:1`)
            .toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})
