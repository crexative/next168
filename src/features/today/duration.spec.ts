import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { formatSpan } from './duration'

describe('formatSpan', () => {
  it.each([[0, '1 min'], [-5, '1 min'], [0.2, '1 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30 min'], [90.4, '1 h 31 min'], [605, '10 h 5 min']])('%s min → %s', (minutes, expected) => {
    i18n.global.locale.value = 'en'
    expect(formatSpan(minutes)).toBe(expected)
  })
})
