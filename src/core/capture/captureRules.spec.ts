import { describe, expect, it } from 'vitest'
import { EN } from './__corpus__/en'
import { ES } from './__corpus__/es'
import { PT } from './__corpus__/pt'
import { CORPUS_CLOCKS, CORPUS_TIME_ZONE, type CorpusCase } from './__corpus__/types'
import { GRAMMARS, type CaptureGrammar } from './grammar'
import { normalizeCaptureText } from './normalize'
import { createCaptureParser, parseCapture, type CaptureInput } from './parseCapture'

const SUNDAY = CORPUS_CLOCKS.sun
const MONDAY = CORPUS_CLOCKS.mon
const zone = CORPUS_TIME_ZONE
const es = (text: string, extra: Partial<CaptureInput> = {}) => parseCapture({ text, locale: 'es', now: SUNDAY, timeZone: zone, ...extra })

describe('normalizeCaptureText (addendum 6.1 F6)', () => {
  it('turns CRLF, CR, LF, U+2028 and U+2029 into lines, trimmed, without empty ones', () => {
    expect(normalizeCaptureText('uno\r\ndos\rtres\ncuatro\u2028cinco\u2029seis')).toEqual(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'])
    expect(normalizeCaptureText('  a  \r\n\r\n  \u2028 b ')).toEqual(['a', 'b'])
  })

  it('one non-empty line among blank lines is a single line', () => {
    expect(normalizeCaptureText('\n\n  dentista mañana 9am  \r\n \u2029')).toEqual(['dentista mañana 9am'])
    expect(normalizeCaptureText(' \n \r\n')).toEqual([])
  })
})

describe('chips: removal, suppression and manual fields (rev 2.1 §7.3, §7.5)', () => {
  it('spans give raw offsets and normalized keys', () => {
    const parsed = es('Dentista  Mañana 9 A.M.')
    expect(parsed.spans.map(({ field, start, end, text, key }) => ({ field, text, key, slice: 'Dentista  Mañana 9 A.M.'.slice(start, end) }))).toEqual([
      { field: 'date', text: 'Mañana', key: 'mañana', slice: 'Mañana' },
      { field: 'time', text: '9 A.M.', key: '9 a.m.', slice: '9 A.M.' },
    ])
  })

  it('a removed date chip stays in the title; the time alone resolves to today while 9:00 is still ahead (§7.5 b)', () => {
    expect(es('Dentista mañana 9am', { suppressed: ['mañana'] })).toMatchObject({
      title: 'Dentista mañana', fields: { dueDate: '2026-10-25', at: 540, dateFromTime: true },
    })
  })

  it('both chips removed, more typing: nothing is parsed again (§7.5 a, c)', () => {
    const parsed = es('Dentista mañana 9am ya', { suppressed: ['mañana', '9am'] })
    expect(parsed).toEqual({ title: 'Dentista mañana 9am ya', fields: {}, spans: [] })
  })

  it('a suppressed phrase also keeps a shorter phrase inside it from being read', () => {
    expect(es('cena a las 9 pm', { suppressed: ['a las 9 pm'] })).toEqual({ title: 'Cena a las 9 pm', fields: {}, spans: [] })
  })

  it('once the text no longer holds a suppressed phrase, a new phrase is read again', () => {
    expect(es('Dentista el lunes 9am', { suppressed: ['mañana'] }).fields).toEqual({ dueDate: '2026-10-26', at: 540 })
  })

  it('a field set by hand is never parsed: its words stay in the title', () => {
    expect(es('trotar hoy 1 h', { manual: { duration: true } })).toMatchObject({ title: 'Trotar 1 h', fields: { dueDate: '2026-10-25' } })
    expect(es('dentista mañana 9am', { manual: { date: true } })).toEqual(expect.objectContaining({ title: 'Dentista mañana', fields: { at: 540 } }))
    expect(es('dentista mañana 9am', { manual: { time: true } }).title).toBe('Dentista 9am')
  })

  it('a time without a date is tomorrow once it has passed', () => {
    expect(parseCapture({ text: 'sacar al perro 8am', locale: 'es', now: MONDAY, timeZone: zone }).fields).toEqual({ at: 480, dueDate: '2026-10-27', dateFromTime: true })
  })

  it('locales without a grammar return the text as the title', () => {
    expect(parseCapture({ text: 'zahnarzt morgen 9 Uhr', locale: 'de', now: MONDAY, timeZone: zone })).toEqual({ title: 'Zahnarzt morgen 9 Uhr', fields: {}, spans: [] })
    expect(parseCapture({ text: 'dentiste demain 9h', locale: 'fr-FR', now: MONDAY, timeZone: zone }).fields).toEqual({})
    expect(parseCapture({ text: 'dentista mañana 9am', locale: 'es-CO', now: SUNDAY, timeZone: zone }).fields).toEqual({ dueDate: '2026-10-26', at: 540 })
  })

  it('a fixed time keeps a duration only up to 12 hours', () => {
    expect(parseCapture({ text: 'dormir 13 horas a las 22:00', locale: 'es', now: MONDAY, timeZone: zone }).fields).toEqual({ at: 1320, dueDate: '2026-10-26', dateFromTime: true })
    expect(parseCapture({ text: 'trabajar 13 horas', locale: 'es', now: MONDAY, timeZone: zone }).fields).toEqual({ durationMin: 780 })
  })
})

// Mutation proof (rev 2.1 §7.5): a parser built without one guard must fail frozen cases. The grammar is data, so the
// mutated parser is a real one built through the same factory.
describe('the frozen corpus discriminates each guard', () => {
  const corpora: [string, CorpusCase[]][] = [['es', ES], ['en', EN], ['pt', PT]]
  function failures(grammars: Record<string, CaptureGrammar>): string[] {
    const parse = createCaptureParser(grammars)
    return corpora.flatMap(([locale, corpus]) => corpus.filter((item) => {
      const parsed = parse({ text: item.text, locale, now: CORPUS_CLOCKS[item.clock ?? 'mon'], timeZone: zone })
      const fields = { dueDate: item.dueDate, at: item.at, durationMin: item.durationMin, dateFromTime: item.dateFromTime }
      return parsed.title !== item.title || JSON.stringify(Object.entries(parsed.fields).sort()) !== JSON.stringify(Object.entries(fields).filter(([, value]) => value !== undefined).sort())
    }).map((item) => `${locale}: ${item.text}`))
  }
  const mutate = (change: (grammar: CaptureGrammar) => CaptureGrammar) => Object.fromEntries(Object.entries(GRAMMARS).map(([language, grammar]) => [language, change(grammar)]))

  it('the shipped grammar fails none', () => {
    expect(failures({ ...GRAMMARS })).toEqual([])
  })

  it('without the negation guard', () => {
    const failed = failures(mutate((grammar) => ({ ...grammar, negations: [] })))
    expect(failed).toEqual(expect.arrayContaining(['es: no llamar mañana', 'es: café sin azúcar mañana', "en: don't call tomorrow", 'en: not today, Friday', 'pt: não agendar hoje']))
  })

  it('without the determiner rule (a bare weekday is read)', () => {
    const failed = failures(mutate((grammar) => ({ ...grammar, weekdays: { ...grammar.weekdays, determiners: [...grammar.weekdays.determiners, ''] } })))
    expect(failed).toEqual(expect.arrayContaining(['es: llamar a domingo', 'en: call Friday', 'pt: segunda revisar contas']))
  })

  it('without the quote rule', () => {
    const failed = failures(mutate((grammar) => ({ ...grammar, quotePairs: [] })))
    expect(failed).toEqual(expect.arrayContaining(['es: leer «el lunes» de Cortázar', 'pt: comprar «pão de amanhã» hoje', 'pt: ver "Amanhã é outro dia" no cinema']))
  })
})
