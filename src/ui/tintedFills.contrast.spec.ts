import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SURFACES, contrast, mixOver, rgb, themes } from './contrastSupport'

// Every rule in the app that pairs a tinted fill (`color-mix(... var(--tint|--danger) N%, transparent)`)
// with the matching `--tint-label` / `--danger-label` text. They are found in the sources, so a new
// tinted fill is covered without touching this file.
interface TintedFill { where: string; fill: '--tint' | '--danger'; label: string; percent: number }

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(vue|css)$/.test(entry.name) ? [path] : []
  })
}

function tintedFills(): TintedFill[] {
  const found: TintedFill[] = []
  for (const file of sourceFiles('src')) {
    for (const rule of readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const fill = /background(?:-color)?:\s*color-mix\(in srgb,\s*var\((--tint|--danger)\)\s+(\d+(?:\.\d+)?)%,\s*transparent\)/.exec(rule[2]!)
      const label = /(?:^|[;\s])color:\s*var\((--tint-label|--danger-label)\)/.exec(rule[2]!)
      if (!fill || !label) continue
      found.push({ where: `${file}: ${rule[1]!.trim().replace(/\s+/g, ' ')}`, fill: fill[1] as TintedFill['fill'], label: label[1]!, percent: Number(fill[2]) })
    }
  }
  return found
}

const fills = tintedFills()

describe('tinted fills used with --tint-label / --danger-label', () => {
  it('finds the known 12% buttons and 14% fills in the sources', () => {
    const places = fills.map(({ where, percent }) => `${percent}% ${where.split(':')[0]}`)
    for (const expected of [
      '12% src/ui/Button.vue', '14% src/app/AppShell.vue', '14% src/features/week/BlockEditorSheet.vue',
    ]) expect(places).toContain(expected)
    expect(fills.filter((fill) => fill.where.startsWith('src/ui/Button.vue'))).toHaveLength(2)
  })

  it('pairs every tinted fill with its own label color', () => {
    for (const fill of fills) expect(fill.label, fill.where).toBe(`${fill.fill}-label`)
  })

  for (const { name, tokens } of themes) {
    for (const surface of SURFACES) {
      it(`${name}: every tinted fill keeps its label at 4.5:1 on ${surface}`, () => {
        for (const fill of fills) {
          const background = mixOver(rgb(tokens[fill.fill]!), fill.percent, rgb(tokens[surface]!))
          const ratio = contrast(rgb(tokens[fill.label]!), background)
          expect(ratio, `${fill.where} (${fill.percent}% ${fill.fill}): ${ratio.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})
