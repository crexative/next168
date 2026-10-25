import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages } from './index'

const messages = collectMessages(import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true }))
const onboarding = (locale: string) => messages[locale]!.onboarding as Record<string, unknown>

function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, path ? `${path}.${key}` : key))
}

// The glossary: one word per idea. Setup talks about routines, "asignadas / sin asignar" hours and whole numbers.
const RETIRED: Record<string, RegExp> = {
  en: /\b(blocks?|planned|goals?|caps?)\b/i,
  es: /\b(bloques?|planificad[ao]s?|objetivos?|metas?)\b/i,
  fr: /\b(blocs?|planifiées?|objectifs?)\b/i,
  pt: /\b(blocos?|planejad[ao]s?|metas?)\b/i,
  de: /\b(blöcke?|blöcken|geplant|ziele?)\b/i,
}
// "libres" belongs to the live number on Hoy and Semana; in setup the hours are assigned or unassigned.
const LIVE_FREE_WORD = /\b(free|libres?|livres?|frei|disponibles?|available)\b/i

describe.each(SUPPORTED_LOCALES)('%s onboarding copy', (locale) => {
  it('keeps the same placeholders as English in every string', () => {
    const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    const english = new Map(strings(onboarding('en')))
    for (const [path, value] of strings(onboarding(locale))) expect(names(value), `${locale}:${path}`).toEqual(names(english.get(path)!))
  })

  it('uses the glossary: no retired word for a routine, a goal or the hours', () => {
    const offenders = strings(onboarding(locale)).filter(([path, value]) => !path.startsWith('templates.') && RETIRED[locale]!.test(value))
    expect(offenders).toEqual([])
  })

  it('never calls the setup hours "free": they are assigned or unassigned', () => {
    const summary = onboarding(locale).summary as Record<string, string>
    for (const key of ['assigned', 'unassigned']) expect(summary[key], `${locale}:summary.${key}`).not.toMatch(LIVE_FREE_WORD)
  })

  it('shows hours only as whole numbers: no hour string carries a decimal', () => {
    for (const [path, value] of strings(onboarding(locale))) expect(value, `${locale}:${path}`).not.toMatch(/\d[.,]\d/)
  })
})

describe('Spanish onboarding copy', () => {
  it('says "asignadas" for the routine and "sin asignar" for what is left, and nothing about "libres"', () => {
    const summary = onboarding('es').summary as Record<string, string>
    expect(summary.assigned).toBe('{hours} asignadas')
    expect(summary.unassigned).toBe('{hours} sin asignar')
  })
})
