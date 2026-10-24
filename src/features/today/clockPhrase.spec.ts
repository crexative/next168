import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { readsAsOne, untilClock } from './clockPhrase'

describe('readsAsOne', () => {
  it.each([
    ['1:00 a. m.', true], ['01:15', true], ['1:30 p. m.', true], ['1:05', true],
    ['11:00 p. m.', false], ['12:00 a. m.', false], ['13:00', false], ['10:00', false], ['7:00 a. m.', false],
  ])('%s -> %s', (clock, expected) => expect(readsAsOne(clock)).toBe(expected))
})

describe('untilClock', () => {
  it('agrees the Spanish article with the hour that is read', () => {
    i18n.global.locale.value = 'es'
    const t = i18n.global.t
    expect(untilClock(t, 'today.now.freeUntil', '11:00 p. m.')).toBe('Tiempo libre hasta las 11:00 p. m.')
    expect(untilClock(t, 'today.now.freeUntil', '1:00 a. m.')).toBe('Tiempo libre hasta la 1:00 a. m.')
    expect(untilClock(t, 'today.now.freeUntil', '13:00')).toBe('Tiempo libre hasta las 13:00')
  })

  it('agrees the Portuguese article with the hour that is read', () => {
    i18n.global.locale.value = 'pt'
    const t = i18n.global.t
    expect(untilClock(t, 'today.now.freeUntil', '23:00')).toBe('Tempo livre até às 23:00')
    expect(untilClock(t, 'today.now.freeUntil', '01:00')).toBe('Tempo livre até à 01:00')
  })

  it.each(['en', 'fr', 'de'] as const)('%s keeps one form for every hour', (locale) => {
    i18n.global.locale.value = locale
    const t = i18n.global.t
    const at = (clock: string) => untilClock(t, 'today.now.freeUntil', clock)
    expect(at('1:00').replace('1:00', 'X')).toBe(at('7:00').replace('7:00', 'X'))
    expect(at('7:00')).toContain('7:00')
  })
})
