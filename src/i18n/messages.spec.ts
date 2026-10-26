import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages, i18n } from './index'

const files = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true })
const messages = collectMessages(files)
const featureSources = import.meta.glob<string>([
  '../features/{settings,onboarding,tasks,assistant,proposals}/**/*.{vue,ts}',
  '!../features/**/*.spec.ts',
  '!../features/**/*.test.ts',
], { eager: true, query: '?raw', import: 'default' })

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
}

const englishKeys = flatten(messages.en).sort()

describe('i18n catalogs', () => {
  it.each([
    ['es', 1, 'Y 1 más no cabe en los próximos 7 días.'],
    ['es', 2, 'Y 2 más no caben en los próximos 7 días.'],
    ['en', 1, "And 1 more doesn't fit in the next 7 days."],
    ['en', 2, "And 2 more don't fit in the next 7 days."],
    ['pt', 1, 'E mais 1 não cabe nos próximos 7 dias.'],
    ['pt', 2, 'E mais 2 não cabem nos próximos 7 dias.'],
    ['de', 1, 'Und 1 weitere passt nicht in die nächsten 7 Tage.'],
    ['de', 2, 'Und 2 weitere passen nicht in die nächsten 7 Tage.'],
    ['fr', 1, 'Et 1 autre ne rentre pas dans les 7 prochains jours.'],
    ['fr', 2, 'Et 2 autres ne rentrent pas dans les 7 prochains jours.'],
  ] as const)('%s warning summary agrees with count %i', (locale, count, expected) => {
    expect(i18n.global.t('tasks.moreWarnings', { count }, { locale })).toBe(expected)
  })

  it('loads real translated strings, not empty catalogs', () => {
    expect(englishKeys.length).toBeGreaterThan(10)
    for (const locale of SUPPORTED_LOCALES) {
      const app = messages[locale]?.app as { name?: unknown } | undefined
      expect(app?.name).toBe('Weeklid')
    }
    expect(i18n.global.t('app.name')).toBe('Weeklid')
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

  it.each(SUPPORTED_LOCALES)('%s defines every literal translation key used by setup features', (locale) => {
    const keys = new Set(flatten(messages[locale]))
    const missing: string[] = []
    for (const [file, source] of Object.entries(featureSources)) {
      for (const match of source.matchAll(/(?<![\w$])\$?t\s*\(\s*(['"`])([^'"`]+)\1/g)) {
        const key = match[2]!
        // Computed template keys are covered by the components' domain-specific tests.
        if (!key.includes('${') && !keys.has(key)) missing.push(`${file}: ${key}`)
      }
    }
    expect(Object.keys(featureSources).length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s overflow hint does not put an indefinite article before the category name', (locale) => {
    const hint = (messages[locale]?.tasks as { overflowHint: string }).overflowHint
    expect(hint).toContain('{category}')
    const indefinite = { en: 'an?', es: 'una?', fr: 'une?', pt: 'uma?', de: 'einem|einen|eine|ein' }[locale]
    expect(hint).not.toMatch(new RegExp(`\\b(${indefinite})\\b[^,.{]*\\{category\\}`, 'i'))
  })
})
