import { localDateOf } from '../time'
import { MAX_FIXED_MIN } from '../model'
import { addDays, B, BLOCK, E, GRAMMARS, weekdayResolution, type CaptureField, type CaptureGrammar, type CaptureRule, type ResolveContext } from './grammar'

// L0 single-line capture (tasks design rev 2.1 §7, rev 3 §2.1): a closed, conservative grammar for es, en and pt. It
// extracts a field only when the text cannot mean anything else; every word it does not consume stays in the title.

export interface CaptureSpan {
  field: CaptureField
  // Half-open offsets into the parsed text.
  start: number
  end: number
  text: string
  // The normalized words, as the UI suppresses them after a chip is removed.
  key: string
  value: string | number
}

export interface CaptureFields {
  dueDate?: string
  at?: number
  durationMin?: number
  // The due date came only from a time without a date: today when that time is still ahead, otherwise tomorrow.
  dateFromTime?: true
}

export interface CaptureParse {
  title: string
  fields: CaptureFields
  spans: CaptureSpan[]
}

export interface CaptureInput {
  text: string
  locale: string
  now: Date
  timeZone: string
  // Fields the person set with a control: never parsed, so their words stay in the title.
  manual?: { date?: boolean; time?: boolean; duration?: boolean }
  // Keys of chips the person removed: those words are not parsed again while the text still holds them.
  suppressed?: readonly string[]
}

interface Candidate { field: CaptureField; start: number; end: number; value: string | number | typeof BLOCK }

export function captureKey(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

function capitalized(text: string, locale: string): string {
  const first = text.codePointAt(0)
  if (first === undefined) return text
  const head = String.fromCodePoint(first)
  return head.toLocaleUpperCase(locale) + text.slice(head.length)
}

function wholeTitle(text: string, locale: string): CaptureParse {
  return { title: capitalized(text.replace(/\s+/g, ' ').trim(), locale), fields: {}, spans: [] }
}

// Paired quotes only: an opening mark needs its closing mark later on; an apostrophe is not a quote.
function quotedRegions(text: string, pairs: CaptureGrammar['quotePairs']): [number, number][] {
  const regions: [number, number][] = []
  let index = 0
  while (index < text.length) {
    const pair = pairs.find(([open]) => text.startsWith(open, index))
    const close = pair ? text.indexOf(pair[1], index + pair[0].length) : -1
    if (pair && close !== -1) {
      regions.push([index, close + pair[1].length])
      index = close + pair[1].length
    } else index += 1
  }
  return regions
}

const escapeSource = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function weekdayRule(grammar: CaptureGrammar): CaptureRule {
  const { prefixes, determiners, names, suffix, notBefore } = grammar.weekdays
  const bare = determiners.includes('')
  const listed = determiners.filter((determiner) => determiner !== '')
  const determiner = listed.length ? `(?:(?:${listed.join('|')})\\s+)${bare ? '?' : ''}` : ''
  const prefix = prefixes.length ? `(?:(?:${prefixes.join('|')})\\s+)?` : ''
  const nameList = Object.keys(names).sort((a, b) => b.length - a.length).map(escapeSource).join('|')
  return {
    field: 'date',
    pattern: new RegExp(`${B}${prefix}${determiner}(${nameList})${suffix}${E}`, 'giu'),
    resolve: (match, context) => {
      const weekday = names[match[1]!.toLowerCase()]
      if (weekday === undefined) return undefined
      const today = new Date(`${context.today}T00:00:00Z`).getUTCDay()
      return weekdayResolution(context, addDays(context.today, ((weekday - today + 7) % 7) || 7), notBefore)
    },
  }
}

function localMinute(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return value('hour') * 60 + value('minute')
}

function wordsBefore(text: string, index: number): string[] {
  return (text.slice(0, index).toLowerCase().match(/[\p{L}\p{N}'’-]+/gu) ?? []).reverse()
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

// A parser for one set of grammars (by language); `parseCapture` uses the shipped ones.
export function createCaptureParser(grammars: Readonly<Record<string, CaptureGrammar>> = GRAMMARS): (input: CaptureInput) => CaptureParse {
  const rulesOf = new Map(Object.entries(grammars).map(([language, grammar]) => [language, [...grammar.rules, weekdayRule(grammar)]]))
  return (input) => {
    const { text, locale, now, timeZone, manual = {} } = input
    const language = locale.toLowerCase().split(/[-_]/)[0]!
    const grammar = grammars[language]
    const rules = rulesOf.get(language)
    if (!grammar || !rules) return wholeTitle(text, locale)
    if ([...grammar.negations, ...grammar.repeats].some((pattern) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text))) return wholeTitle(text, locale)

    const today = localDateOf(now, timeZone)
    const quoted = quotedRegions(text, grammar.quotePairs).map(([start, end]) => ({ start, end }))
    const suppressed = new Set((input.suppressed ?? []).map(captureKey))
    const candidates: Candidate[] = []
    const reserved = [...quoted]
    for (const rule of rules) {
      for (const match of text.matchAll(rule.pattern)) {
        const start = match.index
        const end = start + match[0].length
        const context: ResolveContext = { text, today, before: wordsBefore(text, start), after: text.slice(end) }
        const value = rule.resolve(match, context)
        if (value === undefined) continue
        if (value !== BLOCK && suppressed.has(captureKey(match[0]))) reserved.push({ start, end })
        else candidates.push({ field: rule.field, start, end, value })
      }
    }
    // Longest first, then leftmost; nothing inside quotes or removed chips, and no field the person set by hand.
    const chosen: Candidate[] = []
    for (const candidate of candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
      if (manual[candidate.field]) continue
      if (reserved.some((region) => overlaps(region, candidate)) || chosen.some((other) => overlaps(other, candidate))) continue
      chosen.push(candidate)
    }
    // One phrase per field: two of a kind, or an unsupported construction of that kind, extracts nothing of it.
    const extracted = (['date', 'time', 'duration'] as const).flatMap((field) => {
      const ofField = chosen.filter((candidate) => candidate.field === field)
      return ofField.length === 1 && ofField[0]!.value !== BLOCK ? [ofField[0]!] : []
    })
    const at = extracted.find((candidate) => candidate.field === 'time')
    const kept = extracted.filter((candidate) => !(candidate.field === 'duration' && at && (candidate.value as number) > MAX_FIXED_MIN))
    if (!kept.length) return wholeTitle(text, locale)

    let title = text
    for (const span of [...kept].sort((a, b) => b.start - a.start)) title = `${title.slice(0, span.start)} ${title.slice(span.end)}`
    title = title.replace(/\s+/g, ' ').replace(/\s+([,;:])/g, '$1').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    if (!title) return wholeTitle(text, locale)

    const fields: CaptureFields = {}
    for (const span of kept) {
      if (span.field === 'date') fields.dueDate = span.value as string
      else if (span.field === 'time') fields.at = span.value as number
      else fields.durationMin = span.value as number
    }
    if (fields.at !== undefined && fields.dueDate === undefined && !manual.date) {
      fields.dueDate = fields.at > localMinute(now, timeZone) ? today : addDays(today, 1)
      fields.dateFromTime = true
    }
    const spans = kept.sort((a, b) => a.start - b.start).map((span): CaptureSpan => ({
      field: span.field, start: span.start, end: span.end, text: text.slice(span.start, span.end), key: captureKey(text.slice(span.start, span.end)), value: span.value as string | number,
    }))
    return { title: capitalized(title, locale), fields, spans }
  }
}

export const parseCapture = createCaptureParser()
