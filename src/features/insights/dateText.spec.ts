// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dayOfMonth, tightRange } from './dateText'

describe('the summary\'s date text', () => {
  it('writes a range of two numbers with an unspaced dash in every language, and keeps a range across months spaced', () => {
    const range = (locale: string, from: string, to: string) => tightRange((new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) as Intl.DateTimeFormat & { formatRange(a: Date, b: Date): string }).formatRange(new Date(`${from}T12:00:00Z`), new Date(`${to}T12:00:00Z`)))
    expect(range('en', '2026-11-16', '2026-11-22')).toBe('Nov 16–22')
    expect(range('pt', '2026-11-16', '2026-11-22')).toBe('16–22 de nov.')
    expect(range('es', '2026-11-16', '2026-11-22')).toBe('16–22 nov')
    expect(range('es', '2026-10-28', '2026-11-03')).toMatch(/^28 oct\s–\s3 nov$/)
  })

  it('writes the day alone as each language writes it before a month', () => {
    expect(['de', 'es', 'en', 'fr', 'pt'].map((locale) => dayOfMonth('2026-11-16', locale))).toEqual(['16.', '16', '16', '16', '16'])
  })
})
