import { describe, expect, it } from 'vitest'
import { buildCapacity, WEEK_MINUTES } from './capacity'

const categories = [{ id: 'sleep' }, { id: 'work' }, { id: 'idle' }]

describe('buildCapacity', () => {
  it.each([
    { name: '100 categories', minutes: Array.from({ length: 100 }, () => 60) },
    { name: 'one category', minutes: [40 * 60] },
    { name: 'tiny and large categories', minutes: [1, 99, 6000] },
    { name: 'one available minute', minutes: [WEEK_MINUTES - 1] },
    { name: 'zero planned minutes', minutes: [0] },
  ])('fits $name into a phone bar without losing time or Available', ({ minutes }) => {
    const input = minutes.map((value, index) => ({ id: `category-${index}`, minutes: value }))
    const capacity = buildCapacity(input, Object.fromEntries(input.map(({ id, minutes }) => [id, minutes])))
    const shares = [...capacity.segments.map((segment) => segment.percent), capacity.availablePercent].filter((percent) => percent > 0)

    // A 375 px phone leaves less room for the bar after the page/card padding.
    const barWidth = 280
    const gapWidth = Math.min(2, barWidth * capacity.gapPercent / 100)
    const totalGaps = gapWidth * (shares.length - 1)
    expect(totalGaps).toBeGreaterThanOrEqual(0)
    expect(totalGaps).toBeLessThan(barWidth / 10)
    const widths = shares.map((percent) => (barWidth - totalGaps) * percent / 100)
    expect(widths.every((width) => width > 0)).toBe(true)
    expect(widths.reduce((sum, width) => sum + width, totalGaps)).toBeCloseTo(barWidth)
    if (shares.length > 1) expect(gapWidth).toBeLessThan(Math.min(...widths))
    else expect(gapWidth).toBe(0)

    expect(capacity.segments.map(({ categoryId, minutes }) => ({ id: categoryId, minutes }))).toEqual(input.filter(({ minutes }) => minutes > 0))
    expect(capacity.plannedMinutes + capacity.availableMinutes).toBe(WEEK_MINUTES)
    expect(capacity.availableMinutes).toBe(WEEK_MINUTES - minutes.reduce((sum, value) => sum + value, 0))
  })

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
