import type { Category } from '@/core/model'

export type CategoryLook = Pick<Category, 'name' | 'colorKey' | 'customColor' | 'icon'>

// Fill for large areas (blocks, bars); always mixed with a surface before use.
export function categoryFill(category: Pick<Category, 'colorKey' | 'customColor'> | undefined): string {
  if (!category) return 'var(--cat-gray)'
  return category.customColor ?? `var(--cat-${category.colorKey})`
}

// Rings, leading bars, glyph outlines and legend swatches: 3:1 or more on every surface.
export function categoryStroke(category: Pick<Category, 'colorKey' | 'customColor'> | undefined): string {
  if (!category) return 'var(--cat-gray-stroke)'
  return category.customColor ?? `var(--cat-${category.colorKey}-stroke)`
}

// What tells categories apart without colour: the user's icon, or the first letter of the name.
export function categoryGlyph(category: Pick<Category, 'name' | 'icon'> | undefined): string {
  const icon = category?.icon?.trim()
  if (icon) return firstGrapheme(icon)
  const name = category?.name.trim() ?? ''
  return firstGrapheme(name).toLocaleUpperCase()
}

type GraphemeSegmenter = new (locale: undefined, options: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> }

// Intl.Segmenter keeps emoji sequences (👨‍👩‍👧) and combined letters whole; the TS target's lib does not declare it yet.
function firstGrapheme(text: string): string {
  if (!text) return '?'
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (Segmenter) {
    for (const { segment } of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return segment
  }
  return Array.from(text)[0] ?? '?'
}
