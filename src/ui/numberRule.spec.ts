import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages } from '@/i18n'
import { formatHours, formatWholeHours, formatWholeNumber } from './format'

// The number rule (UX review O3): hours are never shown in tenths, and nothing prints a number in a format
// that ignores the reader's language. These checks read the source, so a new `toFixed(` fails here.
const sources = import.meta.glob<string>([
  '../**/*.{ts,vue}',
  '!../**/*.spec.ts',
  '!../**/*.test.ts',
  '!../test/**',
], { eager: true, query: '?raw', import: 'default' })

const catalogs = collectMessages(import.meta.glob<{ default: Record<string, unknown> }>('../i18n/*/*.json', { eager: true }))

const FRACTIONAL_HOURS = /\d[.,]\d+\s*(h|std\.?|hrs?)\b/i

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('number rule', () => {
  it('reads the application sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
  })

  it('never formats a number with toFixed, which always prints a dot', () => {
    const offenders = Object.entries(sources).filter(([, source]) => /\.toFixed\s*\(/.test(source)).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('never asks Intl for fraction digits, so no amount of hours can show tenths', () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /(?:minimum|maximum)FractionDigits\s*:\s*[1-9]/.test(source))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('writes hours as whole numbers in every language', () => {
    for (const locale of ['en', 'es-CO', 'fr', 'pt-BR', 'de']) {
      expect(formatHours(105.5, locale), locale).toMatch(/^106$/)
      expect(formatHours(62.4, locale), locale).toBe('62')
      expect(formatHours(0.4, locale), locale).toBe('0')
      expect(formatWholeNumber(1234.6, locale), locale).not.toMatch(/[.,]\d{1,2}$/)
    }
    expect(formatWholeHours(54.5)).toBe('55 h')
  })

  it('recognises fractional hours in any language and leaves whole ones alone', () => {
    for (const text of ['105,5 h', '62.5 h libres', '34,3 Std.', '2.5 hrs']) expect(FRACTIONAL_HOURS.test(text), text).toBe(true)
    for (const text of ['54 h', '2 h 30 min', 'de 168 h']) expect(FRACTIONAL_HOURS.test(text), text).toBe(false)
  })

  it.each(SUPPORTED_LOCALES)('%s has no fractional-hour literal in its messages', (locale) => {
    const fractional = strings(catalogs[locale]).filter((message) => FRACTIONAL_HOURS.test(message))
    expect(fractional).toEqual([])
  })
})
