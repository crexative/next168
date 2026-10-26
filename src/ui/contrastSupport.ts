import { readFileSync } from 'node:fs'
import type { Rgb } from './contrast'

const tokensCss = readFileSync('src/assets/tokens.css', 'utf8')

export { contrast, rgb, type Rgb } from './contrast'

export function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = tokensCss.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`))
  if (!block) throw new Error(`Missing token block: ${selector}`)
  return Object.fromEntries([...block[1]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value!.trim()]))
}

export const base = declarations(':root')
export const systemDark = declarations(":root:not([data-theme='light'])")
export const explicitLight = declarations(":root[data-theme='light']")
export const explicitDark = declarations(":root[data-theme='dark']")
export const themes: { name: string; tokens: Record<string, string> }[] = [
  { name: 'system light', tokens: base },
  { name: 'system dark', tokens: { ...base, ...systemDark } },
  { name: 'explicit light / system light', tokens: { ...base, ...explicitLight } },
  { name: 'explicit light / system dark', tokens: { ...base, ...explicitLight } },
  { name: 'explicit dark / system light', tokens: { ...base, ...explicitDark } },
  { name: 'explicit dark / system dark', tokens: { ...base, ...systemDark, ...explicitDark } },
]


// color-mix(in srgb, <fill> <percent>%, transparent) over a surface keeps the fill's channels at that alpha.
export function mixOver(fill: Rgb, percent: number, surface: Rgb): Rgb {
  const alpha = percent / 100
  return fill.map((channel, index) => channel * alpha + surface[index]! * (1 - alpha)) as Rgb
}

// Page/grouped background, elevated/card surface, and secondary surface.
export const SURFACES = ['--bg', '--surface', '--surface-2']
