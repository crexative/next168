import { describe, expect, it } from 'vitest'
import { categoryFill, categoryGlyph, categoryStroke } from './categoryVisual'

describe('category visual', () => {
  it('uses the icon, else the capitalised first letter, as the glyph', () => {
    expect(categoryGlyph({ name: 'sueño', icon: '😴' })).toBe('😴')
    expect(categoryGlyph({ name: 'ñandú' })).toBe('Ñ')
    expect(categoryGlyph({ name: '  work ' })).toBe('W')
    expect(categoryGlyph({ name: 'family', icon: '👨‍👩‍👧 home' })).toBe('👨‍👩‍👧')
    expect(categoryGlyph(undefined)).toBe('?')
  })

  it('draws rings with the 3:1 stroke token and keeps legacy colours', () => {
    expect(categoryStroke({ colorKey: 'yellow' })).toBe('var(--cat-yellow-stroke)')
    expect(categoryFill({ colorKey: 'yellow' })).toBe('var(--cat-yellow)')
    expect(categoryStroke({ colorKey: 'blue', customColor: '#123456' })).toBe('#123456')
    expect(categoryStroke(undefined)).toBe('var(--cat-gray-stroke)')
  })
})
