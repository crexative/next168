import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import {
  displayLocale, formatClock, formatDuration, formatHourOfDay, formatMinuteOfDay, hourCycle, resolveDisplayLocale, setHourCycle,
  wholeHourParts,
} from './format'

afterEach(() => {
  setHourCycle('auto')
  i18n.global.locale.value = 'en'
})

describe('display locale', () => {
  it('keeps the app language and takes the region from the browser when it names that language', () => {
    expect(resolveDisplayLocale('es', ['es-CO', 'en-US'], 'auto')).toBe('es-CO')
    expect(resolveDisplayLocale('es', ['en-US'], 'auto')).toBe('es')
    expect(resolveDisplayLocale('pt', ['en-GB', 'pt-BR'], 'auto')).toBe('pt-BR')
  })

  it('carries the 12/24 h choice in the locale', () => {
    expect(resolveDisplayLocale('en', ['en-US'], 'h23')).toBe('en-US-u-hc-h23')
    expect(resolveDisplayLocale('es', ['es-ES'], 'h12')).toBe('es-ES-u-hc-h12')
  })

  it('falls back to the bare language for a malformed browser tag', () => {
    expect(resolveDisplayLocale('en', ['en_US!'], 'auto')).toBe('en')
  })

  it('follows the app language and the stored choice', () => {
    i18n.global.locale.value = 'de'
    expect(displayLocale.value.startsWith('de')).toBe(true)
    setHourCycle('h12')
    expect(hourCycle.value).toBe('h12')
    expect(localStorage.getItem('next168-hour-cycle')).toBe('h12')
    expect(displayLocale.value).toMatch(/^de.*-u-hc-h12$/)
    setHourCycle('auto')
    expect(localStorage.getItem('next168-hour-cycle')).toBeNull()
  })
})

describe('clock', () => {
  it('defaults to the locale\'s clock and obeys an explicit 12/24 h choice', () => {
    const afternoon = Date.UTC(2026, 9, 21, 13, 5)
    expect(formatClock(afternoon, 'en-US', 'UTC')).toMatch(/^1:05\sPM$/)
    expect(formatClock(afternoon, 'es', 'UTC')).toBe('13:05')
    expect(formatClock(afternoon, 'en-US-u-hc-h23', 'UTC')).toBe('13:05')
    expect(formatClock(afternoon, 'es-u-hc-h12', 'UTC')).toMatch(/^1:05\sp\.\s?m\.$/)
  })

  it('writes both ends of the day as midnight, never 24:00 or a wrapped hour', () => {
    expect(formatMinuteOfDay(0, 'es')).toBe('0:00')
    expect(formatMinuteOfDay(1440, 'es')).toBe('0:00')
    expect(formatMinuteOfDay(1439, 'es')).toBe('23:59')
    expect(formatMinuteOfDay(-30, 'es')).toBe('23:30')
    expect(formatMinuteOfDay(1440, 'en-US')).toMatch(/^12:00\sAM$/)
    expect(formatHourOfDay(24, 'es')).toBe('0')
  })

  it('reads the wall clock of the given zone across a DST change', () => {
    // Europe/Madrid jumps from 02:00 to 03:00 on 2026-03-29 (01:00 UTC).
    expect(formatClock('2026-03-29T00:30:00Z', 'es', 'Europe/Madrid')).toBe('1:30')
    expect(formatClock('2026-03-29T01:30:00Z', 'es', 'Europe/Madrid')).toBe('3:30')
    // And back from 03:00 to 02:00 on 2026-10-25 (01:00 UTC): the repeated hour reads 2:30 twice.
    expect(formatClock('2026-10-25T00:30:00Z', 'es', 'Europe/Madrid')).toBe('2:30')
    expect(formatClock('2026-10-25T01:30:00Z', 'es', 'Europe/Madrid')).toBe('2:30')
  })
})

describe('duration', () => {
  it('writes hours and minutes the same way everywhere', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(60)).toBe('1 h')
    expect(formatDuration(61)).toBe('1 h 1 min')
    expect(formatDuration(150)).toBe('2 h 30 min')
    expect(formatDuration(240)).toBe('4 h')
    expect(formatDuration(10080)).toBe('168 h')
  })

  it('rounds to whole minutes at the hour boundary and leaves the sign to the sentence', () => {
    expect(formatDuration(59.6)).toBe('1 h')
    expect(formatDuration(119.4)).toBe('1 h 59 min')
    expect(formatDuration(-90)).toBe('1 h 30 min')
  })

  it('uses the same units in every language', () => {
    for (const language of ['en', 'es', 'fr', 'pt', 'de'] as const) {
      i18n.global.locale.value = language
      expect(formatDuration(150), language).toBe('2 h 30 min')
    }
  })
})

describe('wholeHourParts', () => {
  it('shows free time as whole hours: 36 h 18 min reads 36 h', () => {
    expect(wholeHourParts([131 * 60 + 42, 0, 36 * 60 + 18])).toEqual([132, 0, 36])
  })

  it('keeps the parts adding up to the rounded whole, never below zero', () => {
    const parts = wholeHourParts([58 * 60 + 15, 55 * 60 + 45, 54 * 60])
    expect(parts).toEqual([58, 56, 54])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(168)
    // Three half hours: plain rounding would say 1 + 1 + 1 = 3 for a 1 h 30 min whole.
    const halves = wholeHourParts([30, 30, 30])
    expect(halves.reduce((sum, part) => sum + part, 0)).toBe(2)
    expect(halves.every((part) => part >= 0)).toBe(true)
  })
})
