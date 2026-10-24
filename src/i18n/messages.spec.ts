import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages } from './index'

const files = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true })
const messages = collectMessages(files)

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const englishKeys = flatten(messages.en).sort()

describe('i18n catalogs', () => {
  it('provides every supported locale', () => {
    expect(Object.keys(messages).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))('%s has every key present in en and no extras', (locale) => {
    expect(flatten(messages[locale]).sort()).toEqual(englishKeys)
  })

  it('has no empty strings', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const empty = flatten(messages[locale]).filter((key) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages[locale]) === '')
      expect(empty).toEqual([])
    }
  })
})
