import { describe, expect, it } from 'vitest'
import { remember } from './columnMeasure'

// The text caches are bounded (the hyphenation cache grew by about 3000 entries for 400 window widths).
describe('remember', () => {
  it('keeps at most `limit` entries, dropping the oldest first', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 10; index++) remember(cache, `width ${index}`, index, 3)
    expect([...cache.keys()]).toEqual(['width 7', 'width 8', 'width 9'])
  })

  it('treats a key it is told again as the newest', () => {
    const cache = new Map<string, number>()
    for (const key of ['a', 'b', 'c']) remember(cache, key, 1, 3)
    remember(cache, 'a', 2, 3)
    remember(cache, 'd', 3, 3)
    expect([...cache.entries()]).toEqual([['c', 1], ['a', 2], ['d', 3]])
  })
})
