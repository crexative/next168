import { describe, expect, it } from 'vitest'
import { checkInStreak } from './streak'

describe('checkInStreak', () => {
  it('counts consecutive days back from today and stops at the first gap', () => {
    const days = ['2026-10-24', '2026-10-23', '2026-10-22', '2026-10-20'].map((date) => ({ date }))
    expect(checkInStreak(days, '2026-10-24')).toBe(3)
    expect(checkInStreak(days, '2026-10-25')).toBe(0)
    expect(checkInStreak([], '2026-10-24')).toBe(0)
  })

  it('counts across a month boundary', () => {
    expect(checkInStreak([{ date: '2026-11-01' }, { date: '2026-10-31' }, { date: '2026-10-30' }], '2026-11-01')).toBe(3)
  })
})
