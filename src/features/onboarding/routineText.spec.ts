import { describe, expect, it } from 'vitest'
import { daysText, routineLineText, timeRangeText } from './routineText'

const at = (hours: number, minutes = 0) => hours * 60 + minutes

describe('timeRangeText', () => {
  it('names am/pm once when both ends share it (X1)', () => {
    expect(timeRangeText(at(7, 30), at(8), 'es-CO').replace(/\s/g, ' ')).toBe('7:30–8:00 a. m.')
    expect(timeRangeText(at(7, 30), at(8), 'en-US').replace(/\s/g, ' ')).toBe('7:30–8:00 AM')
  })

  it('keeps both suffixes when the range crosses noon or midnight', () => {
    expect(timeRangeText(at(9), at(17), 'es-CO').replace(/\s/g, ' ')).toBe('9:00 a. m.–5:00 p. m.')
    expect(timeRangeText(at(23), at(7), 'en-US').replace(/\s/g, ' ')).toBe('11:00 PM–7:00 AM')
  })

  it('writes a 24-hour clock without suffixes and follows the person\'s hour cycle', () => {
    expect(timeRangeText(at(9), at(17), 'de-DE')).toBe('9:00–17:00')
    expect(timeRangeText(at(17), at(17, 30), 'es-CO-u-hc-h23')).toBe('17:00–17:30')
  })
})

describe('timeRangeText wrapping', () => {
  it('keeps each clock time in one piece, so a narrow line can only break at the dash', () => {
    const range = timeRangeText(at(23), at(7), 'es-CO')
    expect(range).toMatch(/^11:00\u00a0p\.\u00a0m\.–7:00\u00a0a\.\u00a0m\.$/)
    expect(range).not.toMatch(/ /)
  })
})

describe('daysText', () => {
  it('collapses three or more consecutive days and lists the rest', () => {
    expect(daysText([1, 2, 3, 4, 5], 'es-CO', 1, 'Todos los días')).toBe('lun–vie')
    expect(daysText([1, 3, 5], 'es-CO', 1, 'Todos los días')).toBe('lun, mié, vie')
    expect(daysText([6], 'es-CO', 1, 'Todos los días')).toBe('sáb')
    expect(daysText([0, 1, 2, 3, 4, 5, 6], 'es-CO', 1, 'Todos los días')).toBe('Todos los días')
  })

  it('follows the week start, so a weekend is one run only when it is consecutive in that order', () => {
    expect(daysText([5, 6, 0], 'en-US', 1, 'Every day')).toBe('Fri–Sun')
    expect(daysText([5, 6, 0], 'en-US', 0, 'Every day')).toBe('Sun, Fri, Sat')
  })
})

describe('routineLineText', () => {
  it('reads like the report: days, then one clock range', () => {
    expect(routineLineText({ start: at(9), end: at(17), days: [1, 2, 3, 4, 5] }, 'es-CO', 1, 'Todos los días').replace(/\s/g, ' ')).toBe('lun–vie · 9:00 a. m.–5:00 p. m.')
  })
})
