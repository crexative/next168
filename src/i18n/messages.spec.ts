import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages, i18n } from './index'

const files = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true })
const messages = collectMessages(files)

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const englishKeys = flatten(messages.en).sort()

describe('i18n catalogs', () => {
  it('loads real translated strings, not empty catalogs', () => {
    expect(englishKeys.length).toBeGreaterThan(10)
    for (const locale of SUPPORTED_LOCALES) {
      const app = messages[locale]?.app as { name?: unknown } | undefined
      expect(app?.name).toBe('Next168')
    }
    expect(i18n.global.t('app.name')).toBe('Next168')
  })

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

  it.each(SUPPORTED_LOCALES)('%s overflow hint does not put an indefinite article before the category name', (locale) => {
    const hint = (messages[locale]?.tasks as { overflowHint: string }).overflowHint
    expect(hint).toContain('{category}')
    expect(hint).not.toMatch(/\b(a|an|un|une|uma|ein|einem|einen|eine)\b[^,.{]*\{category\}/i)
  })
})
