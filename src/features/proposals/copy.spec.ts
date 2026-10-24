import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, i18n } from '@/i18n'

describe('proposal copy', () => {
  it('pluralises the pending badge in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { t } = i18n.global
      const one = t('proposals.pending', { count: 1 }, { locale, plural: 1 })
      const many = t('proposals.pending', { count: 3 }, { locale, plural: 3 })
      expect(one, locale).toContain('1')
      expect(many, locale).toContain('3')
      expect(one, locale).not.toBe(many.replace('3', '1'))
    }
    expect(i18n.global.t('proposals.pending', { count: 1 }, { locale: 'en', plural: 1 })).toBe('1 pending proposal')
    expect(i18n.global.t('proposals.pending', { count: 2 }, { locale: 'en', plural: 2 })).toBe('2 pending proposals')
  })

  it('names every proposal source readably', () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const source of ['mcp', 'assistant', 'import']) {
        const label = i18n.global.t(`proposals.sources.${source}`, {}, { locale })
        expect(label, `${locale}/${source}`).not.toBe(`proposals.sources.${source}`)
        expect(label).not.toBe(source)
      }
    }
    expect(i18n.global.t('proposals.sources.mcp', {}, { locale: 'en' })).toBe('Claude via MCP')
    expect(i18n.global.t('proposals.sources.assistant', {}, { locale: 'en' })).toBe('On-device assistant')
  })
})
