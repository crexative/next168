import { describe, expect, it } from 'vitest'
import { allocateCells, BAR_CELLS } from './segments'

describe('allocateCells', () => {
  it('always yields 168 cells and fills the remainder with the unassigned key', () => {
    const cells = allocateCells([{ key: 'sleep', minutes: 56 * 60 }, { key: 'work', minutes: 40 * 60 }], 'free')
    expect(cells).toHaveLength(BAR_CELLS)
    expect(cells.filter((key) => key === 'sleep')).toHaveLength(56)
    expect(cells.filter((key) => key === 'work')).toHaveLength(40)
    expect(cells.filter((key) => key === 'free')).toHaveLength(72)
  })

  it('is all unassigned for an empty week', () => {
    expect(new Set(allocateCells([], 'free'))).toEqual(new Set(['free']))
  })

  it('scales down when planned time exceeds the week', () => {
    const cells = allocateCells([{ key: 'a', minutes: 100 * 60 }, { key: 'b', minutes: 100 * 60 }], 'free')
    expect(cells).toHaveLength(BAR_CELLS)
    expect(cells.includes('free')).toBe(false)
    expect(cells.filter((key) => key === 'a')).toHaveLength(84)
  })

  it('rounds fractional shares so the total stays exact', () => {
    const cells = allocateCells([{ key: 'a', minutes: 100 }, { key: 'b', minutes: 100 }, { key: 'c', minutes: 100 }], 'free')
    expect(cells).toHaveLength(BAR_CELLS)
  })
})
