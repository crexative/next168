import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cssColorAlpha } from '../../e2e/support/cssColor'

describe('sticky header opacity', () => {
  it.each([
    ['rgb(255, 255, 255)', 1], ['rgba(28, 28, 30, 0.96)', 0.96],
    ['rgb(100% 100% 100% / 96%)', 0.96], ['color(srgb 1 1 1 / 0.96)', 0.96],
    ['oklab(100% 0 0 / 96%)', 0.96], ['#ffffff', 1], ['#fff', 1], ['#0000', 0], ['transparent', 0],
    ['color-mix(in srgb, rgb(255, 255, 255) 96%, transparent)', 0.96],
    ['color-mix(in srgb, transparent 4%, #fff)', 0.96],
    ['color-mix(in srgb, #fff 48%, #fff 48%)', 0.96],
    ['color-mix(in srgb, color-mix(in srgb, #fff 50%, transparent) 50%, #fff)', 0.75],
  ])('normalizes %s', (color, alpha) => {
    expect(cssColorAlpha(color)).toBeCloseTo(alpha)
  })

  it.each([
    'rgba(255, 255, 255, 0.86)', 'rgb(255 255 255 / 86%)', 'color(srgb 1 1 1 / .86)',
    'color-mix(in srgb, rgb(255, 255, 255) 86%, transparent)',
  ])('rejects the 86 percent mutant in %s', (color) => {
    expect(cssColorAlpha(color)).toBeLessThan(0.95)
  })

  it.each(['', 'unknown', 'var(--surface)', 'color(unknown 1 1 1)', 'rgba(1, 2, 3, nope)', 'rgb(1 2)', 'color-mix(in srgb, unknown 96%, transparent)', 'color-mix(in srgb, #fff 0%, transparent 0%)'])('refuses an unrecognized color: %s', (color) => {
    expect(() => cssColorAlpha(color)).toThrow(/color/i)
  })

  it('checks the shipped header material so lowering its weight to 86 percent fails', () => {
    const headerCss = readFileSync('src/features/week/stickyHeader.css', 'utf8')
    const background = /background:\s*([^;]+);/.exec(headerCss)![1]!.replace('var(--surface)', '#fff')
    expect(cssColorAlpha(background)).toBeGreaterThanOrEqual(0.95)
    expect(cssColorAlpha(background.replace('96%', '86%'))).toBeLessThan(0.95)
  })
})
