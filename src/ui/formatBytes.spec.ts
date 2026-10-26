import { afterEach, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { formatBytes } from './format'

afterEach(() => { i18n.global.locale.value = 'en' })

it.each([
  [0, '1 KB'], [1, '1 KB'], [999, '1 KB'], [1000, '1 KB'],
  [6000, '6 KB'], [999_000, '999 KB'], [1_000_000, '1 MB'],
  [1_500_000, '1.5 MB'], [9_500_000, '9.5 MB'], [10_500_000, '11 MB'],
  [705_000_000, '705 MB'],
])('formats %i bytes as %s', (bytes, expected) => {
  expect(formatBytes(bytes, 'en')).toBe(expected)
})

it.each([
  ['es', '1,5 MB', '6 KB'], ['de', '1,5 MB', '6 KB'],
  ['fr', '1,5\u202fMo', '6\u202fko'], ['pt', '1,5 MB', '6 KB'],
] as const)('localizes size numbers and units (%s)', (locale, megabytes, kilobytes) => {
  expect(formatBytes(1_500_000, locale)).toBe(megabytes)
  expect(formatBytes(6000, locale)).toBe(kilobytes)
})

it('follows the current app language by default', () => {
  i18n.global.locale.value = 'es'
  expect(formatBytes(1_500_000)).toBe('1,5 MB')
})
