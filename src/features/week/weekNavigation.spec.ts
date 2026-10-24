import { describe, expect, it } from 'vitest'
import { isSameWeek, pagerIndexFor, shiftWeek, weekRangeLabel } from './weekNavigation'
import { weekDates } from './localTime'

const current = weekDates('2026-10-21', 1)

describe('week navigation', () => {
  it('moves whole weeks in both directions', () => {
    expect(shiftWeek(current, 1)[0]).toBe('2026-10-26')
    expect(shiftWeek(current, -1)[6]).toBe('2026-10-18')
    expect(shiftWeek(shiftWeek(current, 3), -3)).toEqual(current)
    expect(isSameWeek(shiftWeek(current, 1), current)).toBe(false)
  })

  it('labels the range in the reader\'s language and adds the year only outside the current one', () => {
    expect(weekRangeLabel(current, 'es-CO', '2026-10-21')).toBe('19 a 25 de oct')
    expect(weekRangeLabel(current, 'en', '2026-10-21').replace(/\s/g, ' ')).toBe('Oct 19 – 25')
    expect(weekRangeLabel(shiftWeek(current, 10), 'en', '2026-10-21')).toContain('2027')
  })

  it('opens the current week on today and other weeks on the weekday the reader was on', () => {
    expect(pagerIndexFor(current, '2026-10-21', 0)).toBe(2)
    expect(pagerIndexFor(shiftWeek(current, 1), '2026-10-21', 4)).toBe(4)
    expect(pagerIndexFor(shiftWeek(current, 1), '2026-10-21', 9)).toBe(6)
  })
})
