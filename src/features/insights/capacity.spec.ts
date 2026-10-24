import { describe, expect, it } from 'vitest'
import { buildCapacity, WEEK_MINUTES } from './capacity'

const categories = [{ id: 'sleep' }, { id: 'work' }, { id: 'idle' }]

describe('buildCapacity', () => {
  it('sizes one segment per planned category and leaves the rest available', () => {
    const capacity = buildCapacity(categories, { sleep: 56 * 60, work: 40 * 60, idle: 0 })
    expect(capacity.segments.map((segment) => segment.categoryId)).toEqual(['sleep', 'work'])
    expect(capacity.segments[0]!.percent).toBeCloseTo((56 / 168) * 100)
    expect(capacity.plannedMinutes).toBe(96 * 60)
    expect(capacity.availableMinutes).toBe(72 * 60)
    expect(capacity.availablePercent).toBeCloseTo((72 / 168) * 100)
    expect(capacity.overbooked).toBe(false)
  })

  it('is all available with nothing planned', () => {
    expect(buildCapacity(categories, {})).toMatchObject({ segments: [], plannedMinutes: 0, availableMinutes: WEEK_MINUTES, availablePercent: 100, overbooked: false })
  })

  it('caps at 168 h and flags overlapping blocks instead of overbooking', () => {
    const capacity = buildCapacity(categories, { sleep: 100 * 60, work: 100 * 60 })
    expect(capacity.plannedMinutes).toBe(WEEK_MINUTES)
    expect(capacity.availableMinutes).toBe(0)
    expect(capacity.availablePercent).toBe(0)
    expect(capacity.overbooked).toBe(true)
    expect(capacity.segments.reduce((sum, segment) => sum + segment.percent, 0)).toBeCloseTo(100)
  })
})
