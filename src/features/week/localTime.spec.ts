import { describe, expect, it } from 'vitest'
import { dayIndexOf, localMinuteOf, minuteToTimeValue, orderedDays, timeValueToMinute, weekDates } from './localTime'

describe('local time helpers', () => {
  it('builds the week around today from the configured first day', () => {
    expect(weekDates('2026-10-21', 1)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(weekDates('2026-10-21', 0)[0]).toBe('2026-10-18')
    expect(weekDates('2026-10-25', 1)[0]).toBe('2026-10-19')
    expect(orderedDays(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(dayIndexOf('2026-10-25')).toBe(0)
  })

  it('reads the wall-clock minute in the document zone', () => {
    expect(localMinuteOf('2026-10-21T10:15:00Z', 'UTC')).toBe(615)
    expect(localMinuteOf('2026-10-21T10:15:00Z', 'America/Bogota')).toBe(315)
    expect(localMinuteOf('2026-10-21T23:30:00Z', 'Europe/Berlin')).toBe(90)
  })

  it('converts between time inputs and minutes', () => {
    expect(minuteToTimeValue(0)).toBe('00:00')
    expect(minuteToTimeValue(1439)).toBe('23:59')
    expect(minuteToTimeValue(1500)).toBe('01:00')
    expect(timeValueToMinute('09:30')).toBe(570)
    expect(timeValueToMinute('')).toBeNull()
    expect(timeValueToMinute('24:00')).toBeNull()
  })
})
