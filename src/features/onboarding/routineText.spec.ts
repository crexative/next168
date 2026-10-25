import { describe, expect, it } from 'vitest'
import { daysPhrase, timeRangeText } from './routineText'

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

describe('daysPhrase', () => {
  const labels = { weekdays: 'Lunes a viernes', everyDay: 'Todos los días', weekend: 'Fines de semana', everyNight: 'Todas las noches' }

  it('says the presets in a sentence and lists other days with "y"', () => {
    expect(daysPhrase([1, 2, 3, 4, 5], 'es-CO', 1, labels)).toBe('lunes a viernes')
    expect(daysPhrase([0, 1, 2, 3, 4, 5, 6], 'es-CO', 1, labels)).toBe('todos los días')
    expect(daysPhrase([0, 1, 2, 3, 4, 5, 6], 'es-CO', 1, labels, true)).toBe('todas las noches')
    expect(daysPhrase([0, 6], 'es-CO', 1, labels)).toBe('fines de semana')
    expect(daysPhrase([5, 1, 3], 'es-CO', 1, labels)).toBe('lunes, miércoles y viernes')
    expect(daysPhrase([6], 'es-CO', 1, labels)).toBe('sábado')
  })

  it('follows the week start for the order', () => {
    expect(daysPhrase([0, 1], 'es-CO', 1, labels)).toBe('lunes y domingo')
    expect(daysPhrase([0, 1], 'es-CO', 0, labels)).toBe('domingo y lunes')
  })
})
