import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages } from '@/i18n'

// A41: source hygiene for the retired two-step wizard. Hygiene only; the behaviour is proven by the flow's own tests.
const sources = import.meta.glob<string>('./**/*.{ts,vue}', { eager: true, query: '?raw', import: 'default' })
const catalogues = import.meta.glob<{ default: Record<string, unknown> }>('../../i18n/*/*.json', { eager: true })
const messages = collectMessages(Object.fromEntries(Object.entries(catalogues).map(([path, module]) => [path.replace('../../i18n/', './'), module])))

const production = Object.entries(sources).filter(([path]) => !path.endsWith('.spec.ts'))

describe('the retired wizard is gone (A41)', () => {
  it('reads the onboarding sources', () => {
    expect(production.map(([path]) => path)).toContain('./setup/SetupHost.vue')
  })

  it('does not nest the Week block editor or restore the page\'s sheet marker', () => {
    for (const [path, source] of production) {
      expect(source, path).not.toMatch(/BlockEditorSheet/)
      expect(source, path).not.toMatch(/dataset\.sheetOpen/)
    }
  })

  it.each(SUPPORTED_LOCALES)('has none of the old wizard\'s strings in %s', (locale) => {
    const onboarding = messages[locale]!.onboarding as Record<string, unknown>
    expect(onboarding.steps).toBeUndefined()
    expect(onboarding.taskLabel).toBeUndefined()
    expect(onboarding.counterOver).toBeUndefined()
    expect((onboarding.done as Record<string, unknown> | undefined)?.seeWeek).toBeUndefined()
  })
})
