import { describe, expect, it } from 'vitest'
import { addLocalDays, datedOccurrences, localDateOf, occurrences, overlaps, zonedInstant } from '../time'
import { block, document } from './fixtures'

describe('nominal week ring', () => {
  it('splits Saturday overnight at the week boundary without duplicating duration', () => {
    expect(occurrences(block)).toEqual([{ start: 9960, end: 10080, day: 6 }, { start: 0, end: 360, day: 0 }])
    const intervals = occurrences({ ...block, days: [0, 1, 2, 3, 4, 5, 6] })
    expect(intervals.reduce((sum, x) => sum + x.end - x.start, 0)).toBe(7 * 480)
    expect(occurrences({ ...block, start: 600, end: 660, days: [1] })).toEqual([{ start: 2040, end: 2100, day: 1 }])
  })
  it('detects overlap across midnight, keeping touching boundaries exclusive', () => {
    expect(overlaps(block, { ...block, days: [0], start: 300, end: 420 })).toBe(true)
    expect(overlaps(block, { ...block, days: [0], start: 360, end: 420 })).toBe(false)
  })
})
describe('zoned dates', () => {
  it.each([
    ['2026-03-29', 150, 'Europe/Berlin', '2026-03-29T01:30:00.000Z'],
    ['2026-10-25', 150, 'Europe/Berlin', '2026-10-25T00:30:00.000Z'],
    ['2026-10-24', 420, 'America/Bogota', '2026-10-24T12:00:00.000Z'],
    ['2026-04-05', 105, 'Australia/Lord_Howe', '2026-04-04T14:45:00.000Z'],
  ])('resolves %s minute %i in %s compatibly', (date, minute, zone, expected) => {
    expect(zonedInstant(date, minute, zone).toISOString()).toBe(expected)
  })
  it('derives local dates and crosses month/year boundaries', () => {
    expect(localDateOf(new Date('2026-10-25T02:00:00Z'), 'America/Bogota')).toBe('2026-10-24')
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(() => zonedInstant('2026-02-30', 0, 'UTC')).toThrow()
    expect(() => zonedInstant('2026-01-01', 1440, 'UTC')).toThrow()
  })
  it('returns full dated occurrences intersecting the range, including the previous night', () => {
    const doc = document(); doc.blocks = [block]
    expect(datedOccurrences(doc, '2026-10-25', 1, 'America/Bogota')).toMatchObject([{ blockId: 'block', date: '2026-10-24', start: '2026-10-25T03:00:00.000Z', end: '2026-10-25T11:00:00.000Z', plannedMinutes: 480 }])
    expect(datedOccurrences(doc, '2026-10-26', 1, 'America/Bogota')).toEqual([])
  })
  it('uses elapsed time across spring and autumn transitions', () => {
    const doc = document(); doc.blocks = [{ ...block, days: [0], start: 60, end: 240 }]
    expect(datedOccurrences(doc, '2026-03-29', 1, 'Europe/Berlin')[0]?.plannedMinutes).toBe(120)
    expect(datedOccurrences(doc, '2026-10-25', 1, 'Europe/Berlin')[0]?.plannedMinutes).toBe(240)
  })
})
