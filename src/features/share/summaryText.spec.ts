import { afterEach, describe, expect, it } from 'vitest'
import { i18n, SUPPORTED_LOCALES } from '@/i18n'
import { buildShareSummary } from './shareSummary'
import { summaryText } from './summaryText'
import { overlapDocument, sentinelDocument } from './testFixtures'

const brand = { name: 'Weeklid', slug: 'weeklid' }
const t = (locale: string) => {
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  return i18n.global.t
}
afterEach(() => { i18n.global.locale.value = 'en' })

// The fragment of share.textOverlap that carries the qualifier ("…because some overlap…"), per locale.
const OVERLAP_CLAUSE: Record<string, RegExp> = {
  en: /add up to 465 h because some overlap; the image shows the proportion/,
  es: /suman 465 h porque algunas se solapan; la imagen muestra la proporción/,
  pt: /somam 465 h porque algumas se sobrepõem; a imagem mostra a proporção/,
  fr: /font 465 h car certaines se chevauchent ; l'image montre la proportion/,
  de: /ergeben 465 h, weil sich einige überschneiden; das Bild zeigt den Anteil/,
}

// T-1B-09: the text alternative carries the same qualifier as the image's caption.
describe('summaryText', () => {
  it.each(SUPPORTED_LOCALES)('states the raw 465 h and why the image is proportional (%s)', (locale) => {
    const text = summaryText(buildShareSummary(overlapDocument(), { includeNames: true, brand }), t(locale), locale)
    expect(text).toMatch(OVERLAP_CLAUSE[locale]!)
    expect(text).toContain('Weeklid')
  })

  it.each(SUPPORTED_LOCALES)('has no overlap clause when routines do not overlap (%s)', (locale) => {
    const text = summaryText(buildShareSummary(sentinelDocument(), { includeNames: false, brand }), t(locale), locale)
    for (const clause of Object.values(OVERLAP_CLAUSE)) expect(text).not.toMatch(new RegExp(clause.source.replace('465', '\\d+')))
    expect(text).toMatch(/102 h/)
  })

  it('lists every category with its hours, in the order of the card', () => {
    const text = summaryText(buildShareSummary(sentinelDocument(), { includeNames: true, brand }), t('en'), 'en')
    expect(text).toBe('My typical week in Weeklid: 102 h of 168 h planned. Sleep 56 h, Work 44 h, Gym 2 h.')
  })
})
