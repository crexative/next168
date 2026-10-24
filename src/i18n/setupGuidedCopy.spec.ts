import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, collectMessages } from './index'

// A32: the guided setup speaks plain language a child of eight or an older person understands. A lint, not a proof:
// the human comprehension check (H1) is the real gate.
const messages = collectMessages(import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true }))

function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, path ? `${path}.${key}` : key))
}

const guided = (locale: string) => strings((messages[locale]!.onboarding as Record<string, unknown>).guided)

const LABELS = new Set([
  'close', 'back', 'next', 'skip', 'noFixedTime', 'yes', 'no', 'current',
  'workStudy.work', 'workStudy.study', 'workStudy.both', 'workStudy.neither',
  'more.family', 'more.friends', 'more.me', 'more.learning', 'more.other', 'more.add',
  'commuteRanges.there', 'commuteRanges.back',
  'sleep.bed', 'sleep.wake', 'sleep.weeknights', 'sleep.weekend',
  'range.days', 'range.start', 'range.end', 'range.otherTime', 'range.add', 'range.remove',
])
const isLabel = (path: string) => LABELS.has(path) || path.startsWith('time.') || path.startsWith('days.')
const isQuestion = (path: string) => path.endsWith('.question') || path.startsWith('extra.')

const JARGON: Record<string, string[]> = {
  es: ['categoría', 'bloque', 'rutina', 'meta', 'objetivo', 'configurar', 'asignad', 'franja', 'intervalo'],
  en: ['category', 'block', 'routine', 'goal', 'configure', 'assign', 'slot', 'interval'],
  fr: ['catégorie', 'bloc', 'routine', 'objectif', 'configurer', 'assign', 'créneau', 'intervalle'],
  pt: ['categoria', 'bloco', 'rotina', 'meta', 'objetivo', 'configurar', 'atribu', 'intervalo'],
  de: ['Kategorie', 'Block', 'Routine', 'Ziel', 'konfigur', 'zuweis', 'Zeitfenster', 'Intervall'],
}

// A name of 20 characters, the longest a typical person types, as it appears on screen.
const NAME = 'Clases de natación 2'
const render = (value: string) => value.replace(/\{name\}/g, NAME).replace(/\{time\}/g, '7:35').replace(/\{\w+\}/g, '')
// Words are whitespace tokens that contain a letter; numbers and punctuation alone do not count.
const words = (value: string) => value.split(/\s+/).filter((token) => /\p{L}/u.test(token))
const sentences = (value: string) => value.split(/(?<=[.!?…])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence !== '')

export function copyProblems(locale: string, entries: [string, string][]): string[] {
  const problems: string[] = []
  for (const [path, raw] of entries) {
    for (const value of [raw.replace(/\{\w+\}/g, ''), render(raw)]) {
      if (isQuestion(path) && words(value).length > 12) problems.push(`${locale}:${path}: a question over 12 words`)
      const list = sentences(value)
      if (list.length > 2) problems.push(`${locale}:${path}: more than 2 sentences`)
      for (const sentence of list) if (words(sentence).length > 15) problems.push(`${locale}:${path}: a sentence over 15 words`)
      if (isLabel(path) && words(value).length > 3) problems.push(`${locale}:${path}: a label over 3 words`)
      for (const word of JARGON[locale]!) if (value.toLowerCase().includes(word.toLowerCase())) problems.push(`${locale}:${path}: jargon "${word}"`)
    }
  }
  return [...new Set(problems)]
}

describe.each(SUPPORTED_LOCALES)('%s guided setup copy (A32)', (locale) => {
  it('has every label it is checked against', () => {
    const paths = new Set(guided(locale).map(([path]) => path))
    for (const label of LABELS) expect(paths.has(label), `${locale}:${label}`).toBe(true)
  })

  it('keeps questions short, sentences short, labels to three words and no jargon', () => {
    expect(copyProblems(locale, guided(locale))).toEqual([])
  })
})

describe('the plain-language lint itself', () => {
  it('catches jargon, a long question, a third sentence and a long label', () => {
    expect(copyProblems('es', [['more.hint', 'Elige la categoría.']])).toEqual(['es:more.hint: jargon "categoría"'])
    expect(copyProblems('en', [['work.question', 'When do you usually go to work on most of the days of your week?']])).toEqual(['en:work.question: a question over 12 words'])
    expect(copyProblems('en', [['intro', 'One. Two. Three.']])).toEqual(['en:intro: more than 2 sentences'])
    expect(copyProblems('en', [['next', 'Go on to the next one']])).toEqual(['en:next: a label over 3 words'])
    expect(copyProblems('de', [['range.add', 'Zeitfenster']])).toEqual(['de:range.add: jargon "Zeitfenster"'])
  })

  it('counts a long name the person typed as part of the question', () => {
    expect(copyProblems('en', [['extra.custom', 'When do you usually have "{name}" each and every single week?']])).toEqual(['en:extra.custom: a question over 12 words'])
  })
})
