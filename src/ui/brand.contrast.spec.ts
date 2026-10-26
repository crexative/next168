import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SURFACES, contrast, rgb, themes } from './contrastSupport'

// The Weeklid palette in the app (docs/brand/README.md): every pairing the brand colours take part in, measured.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(vue|css|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

describe('brand colours', () => {
  for (const { name, tokens } of themes) {
    it(`${name}: a filled tint keeps its label at 4.5:1`, () => {
      const ratio = contrast(rgb(tokens['--tint-text']!), rgb(tokens['--tint']!))
      expect(ratio, `${name}: --tint-text on --tint = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })

    for (const surface of SURFACES) {
      it(`${name}: tint text reaches 4.5:1, and the tint, the mark and its tick 3:1, on ${surface}`, () => {
        const background = rgb(tokens[surface]!)
        const text = contrast(rgb(tokens['--tint-label']!), background)
        expect(text, `${name}: --tint-label on ${surface} = ${text.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        for (const graphic of ['--tint', '--mark', '--accent']) {
          const ratio = contrast(rgb(tokens[graphic]!), background)
          expect(ratio, `${name}: ${graphic} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        }
      })
    }
  }

  // Maize sits close to the warning and yellow category colours, so it may only draw the mark's tick.
  it('uses the accent only in the brand mark', () => {
    const users = sourceFiles('src').filter((file) => readFileSync(file, 'utf8').includes('var(--accent)'))
    expect(users.sort()).toEqual(['src/ui/AppMark.vue', 'src/ui/BrandLockup.vue'])
  })

  it('leaves none of the old indigo tint behind', () => {
    const files = [...sourceFiles('src'), 'index.html', 'vite.config.ts']
    const leftovers = files.filter((file) => /#(?:5856d6|5e5ce6)\b/i.test(readFileSync(file, 'utf8')))
    expect(leftovers).toEqual([])
  })
})
