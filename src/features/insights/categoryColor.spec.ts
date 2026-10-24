import { describe, expect, it } from 'vitest'
import type { Category } from '@/core/model'
import { categorySharingColor, distinctColorKeys, firstUnusedColorKey } from './categoryColor'

const category = (id: string, colorKey: Category['colorKey'], customColor?: string): Category => ({ id, name: id, colorKey, goal: { type: 'none', hoursPerWeek: 0 }, ...(customColor ? { customColor } : {}) })

describe('firstUnusedColorKey', () => {
  it('picks the first palette colour nobody uses', () => {
    expect(firstUnusedColorKey([])).toBe('blue')
    expect(firstUnusedColorKey(['blue', 'green'])).toBe('orange')
    expect(firstUnusedColorKey(['blue', 'orange'])).toBe('green')
  })

  it('falls back to the least used colour when the palette is exhausted', () => {
    const all = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow', 'red', 'gray'] as const
    expect(firstUnusedColorKey([...all, 'blue'])).toBe('green')
  })
})

describe('distinctColorKeys', () => {
  it('keeps distinct wishes and replaces repeats with unused colours', () => {
    expect(distinctColorKeys(['blue', 'green'])).toEqual(['blue', 'green'])
    expect(distinctColorKeys(['blue', 'blue', 'blue'])).toEqual(['blue', 'green', 'orange'])
  })
})

describe('categorySharingColor', () => {
  const categories = [category('a', 'blue'), category('b', 'green'), category('c', 'pink', '#123456')]

  it('finds another category with the same colour, never the edited one', () => {
    expect(categorySharingColor(categories, 'blue', null)?.id).toBe('a')
    expect(categorySharingColor(categories, 'blue', 'a')).toBeUndefined()
  })

  it('ignores categories painted with a custom colour', () => {
    expect(categorySharingColor(categories, 'pink', null)).toBeUndefined()
  })
})
