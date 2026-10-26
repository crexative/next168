// The closed, table-driven L0 grammar for es, en and pt (tasks design rev 2.1 §7.1 and §7.2). Every phrase is a
// pattern plus a resolver; a guard is data, so a parser can be built without one of them (the mutation tests do).
// Repeats are P2: here their words only stop all extraction.

export type CaptureField = 'date' | 'time' | 'duration'

// What a resolver decides for one match: a value, BLOCK (an unsupported construction of that class: nothing of the
// class is extracted), or undefined (not a phrase of this class at all; the words stay in the title).
export const BLOCK = Symbol('block')
export type Resolution = string | number | typeof BLOCK | undefined

export interface ResolveContext {
  text: string
  // Local date (YYYY-MM-DD) and minute of the day of `now` in the planner's zone.
  today: string
  // The words right before the match (lowercase, nearest first) and the text right after it.
  before: string[]
  after: string
}

export interface CaptureRule {
  field: CaptureField
  pattern: RegExp
  resolve(match: RegExpExecArray, context: ResolveContext): Resolution
}

export interface WeekdayGrammar {
  // Optional words before the determiner that belong to the phrase ("para el lunes").
  prefixes: readonly string[]
  // Pattern sources, longest first; '' allows a bare weekday (no determiner).
  determiners: readonly string[]
  names: Readonly<Record<string, number>>
  // Pattern source allowed right after the name ("que viene").
  suffix: string
  // Lowercase words that make the weekday word something else when they follow it ("na segunda vez").
  notBefore: readonly string[]
}

export interface CaptureGrammar {
  // Any match anywhere means nothing is extracted at all.
  negations: readonly RegExp[]
  repeats: readonly RegExp[]
  // Opening and closing characters of the quotes whose words are never parsed.
  quotePairs: readonly (readonly [string, string])[]
  weekdays: WeekdayGrammar
  rules: readonly CaptureRule[]
}

// Word edges for any letter or digit (accents included).
export const B = '(?<![\\p{L}\\p{N}_])'
export const E = '(?![\\p{L}\\p{N}_])'
const rx = (source: string) => new RegExp(source, 'giu')

const DAY_MS = 86_400_000
const isoDay = (date: string) => Date.parse(`${date}T00:00:00Z`)
const fromDay = (value: number) => new Date(value).toISOString().slice(0, 10)
export const addDays = (date: string, days: number) => fromDay(isoDay(date) + days * DAY_MS)
const pad = (value: number) => String(value).padStart(2, '0')

// The calendar date, or undefined when it does not exist (31 November).
function dateOf(year: number, month: number, day: number): string | undefined {
  const value = new Date(Date.UTC(year, month - 1, day))
  return value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : undefined
}

// The next date strictly after `today` on that weekday (0 = Sunday).
export function nextWeekday(today: string, weekday: number): string {
  const current = new Date(isoDay(today)).getUTCDay()
  return addDays(today, ((weekday - current + 7) % 7) || 7)
}

// The next date with that day of the month, on or after today; with a month, the next such date of that month.
function nextDayOfMonth(today: string, day: number, month?: number): Resolution {
  if (day < 1 || day > 31) return BLOCK
  const [year, current] = today.split('-').map(Number) as [number, number]
  if (month !== undefined) {
    for (const candidate of [year, year + 1]) {
      const date = dateOf(candidate, month, day)
      if (date === undefined) continue
      if (date >= today) return date
    }
    return dateOf(year, month, day) === undefined && dateOf(year + 1, month, day) === undefined ? BLOCK : undefined
  }
  for (let offset = 0; offset < 24; offset++) {
    const total = current - 1 + offset
    const date = dateOf(year + Math.floor(total / 12), (total % 12) + 1, day)
    if (date !== undefined && date >= today) return date
  }
  return BLOCK
}

const monthIndex = (names: readonly string[][], word: string) => names.findIndex((aliases) => aliases.includes(word.toLowerCase())) + 1

// A day number that is a quantity, a measure or part of a numeric date is not a day of the month.
const NOT_A_DAY = /^(?:[%/:-]|[.,]\d|\s*(?:%|kg|g|km|m|cm|ml|l|mil|millones?|pesos|euros?|d[oó]lares|reais|veces|vezes|times|a[nñ]os|anos|years|personas|pessoas|people|unidades|units|de\s+(?:la|las|los)|da|das|do|dos)(?![\p{L}]))/iu

// Words that, right after a weekday's day number, make that number a duration or a time rather than a date.
const NUMBER_UNIT = /^\s*(?:h(?:oras?|rs?|ours?)?|min(?:utos?|utes?|s)?|[ap]\.?\s?m|:|\d|de\s+la|da\s+(?:manh|tarde|noite))(?![\p{L}])/iu

// A weekday followed by a bare day number ("el martes 13", "Friday the 13th") names a date the weekday may contradict.
export function weekdayResolution(context: ResolveContext, date: string, notBefore: readonly string[]): Resolution {
  const next = /^\s+([\p{L}][\p{L}-]*)/u.exec(context.after)?.[1]
  if (next && /^\p{Lu}/u.test(next)) return undefined
  if (next && notBefore.includes(next.toLowerCase())) return undefined
  const number = /^\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?/iu.exec(context.after)
  if (number && !NUMBER_UNIT.test(context.after.slice(number[0].length))) return BLOCK
  return date
}

function hour12(hour: number, minute: number, half: string): number {
  return ((hour % 12) + (half.toLowerCase() === 'p' ? 12 : 0)) * 60 + minute
}

// "8 de la noche", "8 da manhã": a 12-hour clock with the part of the day; anything ambiguous is unsupported.
function withPeriod(hour: number, minute: number, period: string): Resolution {
  const word = period.toLowerCase()
  if (word.startsWith('ma')) return hour === 12 ? BLOCK : hour * 60 + minute
  if (word === 'tarde') return (hour === 12 ? 12 : hour + 12) * 60 + minute
  return hour >= 6 && hour <= 11 ? (hour + 12) * 60 + minute : BLOCK
}

// "15:00", "09:30": a two-digit hour is a 24-hour clock; "9:30" may be 12-hour, so it is unsupported.
function colonTime(hours: string, minutes: string): Resolution {
  const hour = Number(hours), minute = Number(minutes)
  return hours.length === 2 && hour <= 23 && minute <= 59 ? hour * 60 + minute : BLOCK
}

// "15h", "às 9h": with no lead-in, a low hour may be a length ("8h"), so only 13h and later read as a time alone.
function hourMark(prefixed: boolean, hours: string, minutes: string | undefined): Resolution {
  const hour = Number(hours)
  if (hour > 23) return BLOCK
  return prefixed || hour >= 13 ? hour * 60 + Number(minutes ?? 0) : BLOCK
}

const MIN_DURATION = 5
const MAX_DURATION = 1260

function length(minutes: number, context: ResolveContext, relative: readonly string[][], afterWords: readonly string[]): Resolution {
  if (relative.some((words) => words.every((word, index) => context.before[index] === word))) return BLOCK
  const next = /^\s+([\p{L}]+)/u.exec(context.after)?.[1]?.toLowerCase()
  if (next && afterWords.includes(next)) return BLOCK
  return minutes >= MIN_DURATION && minutes <= MAX_DURATION ? minutes : BLOCK
}

const block = (field: CaptureField, source: string): CaptureRule => ({ field, pattern: rx(source), resolve: () => BLOCK })
const words = (list: readonly string[]) => list.map((word) => rx(`${B}${word}${E}`))

// Spanish ---------------------------------------------------------------------------------------------------------
const ES_MONTHS = [['enero'], ['febrero'], ['marzo'], ['abril'], ['mayo'], ['junio'], ['julio'], ['agosto'], ['septiembre', 'setiembre'], ['octubre'], ['noviembre'], ['diciembre']]
const ES_MONTH = ES_MONTHS.flat().join('|')
const ES_AT = '(?:a\\s+las?\\s+)'
const ES_FOR = '(?:(?:por|durante)\\s+)?'
const ES_RELATIVE = [['en'], ['hace'], ['a'], ['tras'], ['de', 'dentro']]
const ES_AFTER = ['antes', 'después', 'despues', 'tarde', 'temprano', 'más', 'mas']
// "la mañana", "esta mañana": the morning, not tomorrow.
const ES_MORNING = ['la', 'esta', 'cada', 'de', 'una', 'toda', 'otra']

export const ES: CaptureGrammar = {
  negations: words(['no', 'nunca', 'sin', 'jamás', 'tampoco']),
  repeats: words(['cada', 'todos\\s+los', 'todas\\s+las', 'diari[oa]s?', 'diariamente', 'semanal(?:es|mente)?', 'mensual(?:es|mente)?', 'anual(?:es|mente)?',
    'entre\\s+semana', 'de\\s+lunes\\s+a\\s+viernes', 'veces', 'fines\\s+de\\s+semana', 'los\\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados|domingos)']),
  quotePairs: [['«', '»'], ['"', '"'], ['“', '”'], ['‘', '’']],
  weekdays: {
    prefixes: ['para'],
    determiners: ['el\\s+pr[oó]ximo', 'este\\s+pr[oó]ximo', 'este', 'esta', 'el'],
    names: { lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5, 'sábado': 6, sabado: 6, domingo: 0 },
    suffix: '(?:\\s+que\\s+viene|\\s+pr[oó]ximo)?',
    notBefore: [],
  },
  rules: [
    {
      field: 'date', pattern: rx(`${B}(?:para\\s+)?(pasado\\s+mañana|mañana|hoy)${E}`),
      resolve: (match, context) => {
        const word = match[1]!.toLowerCase().replace(/\s+/g, ' ')
        if (word === 'mañana' && ES_MORNING.includes(context.before[0] ?? '')) return undefined
        if (word === 'hoy' && /^\s+en\s+d[ií]a/iu.test(context.after)) return undefined
        return addDays(context.today, word === 'hoy' ? 0 : word === 'mañana' ? 1 : 2)
      },
    },
    {
      field: 'date', pattern: rx(`${B}(?:para\\s+)?el\\s+(\\d{1,2})(?:\\s+de\\s+(${ES_MONTH}))?${E}`),
      resolve: (match, context) => (match[2] === undefined && NOT_A_DAY.test(context.after)
        ? undefined : nextDayOfMonth(context.today, Number(match[1]), match[2] ? monthIndex(ES_MONTHS, match[2]) : undefined)),
    },
    block('date', `${B}\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?${E}`),
    block('date', `${B}quincenas?${E}`),
    { field: 'time', pattern: rx(`${B}${ES_AT}?(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s?([ap])\\.?\\s?m\\.?(?![\\p{L}\\p{N}])`), resolve: (match) => hour12(Number(match[1]), Number(match[2] ?? 0), match[3]!) },
    { field: 'time', pattern: rx(`${B}${ES_AT}?(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s+de\\s+la\\s+(mañana|tarde|noche)${E}`), resolve: (match) => withPeriod(Number(match[1]), Number(match[2] ?? 0), match[3]!) },
    { field: 'time', pattern: rx(`${B}(?:al?\\s+)?mediod[ií]a${E}`), resolve: () => 720 },
    { field: 'time', pattern: rx(`${B}${ES_AT}?(\\d{1,2}):(\\d{2})(?:\\s?h(?:s|rs)?)?${E}`), resolve: (match) => colonTime(match[1]!, match[2]!) },
    { field: 'time', pattern: rx(`${B}(${ES_AT})?(\\d{1,2})h([0-5]\\d)?${E}`), resolve: (match) => hourMark(match[1] !== undefined, match[2]!, match[3]) },
    block('time', `${B}${ES_AT}?\\d{1,2}\\.\\d{2}${E}`),
    block('time', `${B}a\\s+las?\\s+\\d{1,2}${E}`),
    block('time', `${B}a\\s+las?\\s+(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)${E}`),
    { field: 'duration', pattern: rx(`${B}${ES_FOR}(\\d{1,2})\\s?h(?:oras?)?\\s?(\\d{1,2})\\s?min(?:utos?|s)?${E}`), resolve: (match, context) => length(Number(match[1]) * 60 + Number(match[2]), context, ES_RELATIVE, ES_AFTER) },
    { field: 'duration', pattern: rx(`${B}${ES_FOR}(\\d{1,4})\\s?(?:minutos|minuto|mins|min)${E}`), resolve: (match, context) => length(Number(match[1]), context, ES_RELATIVE, ES_AFTER) },
    { field: 'duration', pattern: rx(`${B}${ES_FOR}(\\d{1,4})(?:\\s?(?:horas|hora|hrs|hr)|\\s+h)${E}`), resolve: (match, context) => length(Number(match[1]) * 60, context, ES_RELATIVE, ES_AFTER) },
    {
      field: 'duration', pattern: rx(`${B}${ES_FOR}(una\\s+hora\\s+y\\s+media|hora\\s+y\\s+media|media\\s+hora|una\\s+hora)${E}`),
      resolve: (match, context) => length({ 'media hora': 30, 'una hora': 60 }[match[1]!.toLowerCase().replace(/\s+/g, ' ')] ?? 90, context, ES_RELATIVE, ES_AFTER),
    },
    block('duration', `${B}\\d+[.,]\\d+\\s?(?:horas?|hrs?|h|min(?:utos?|s)?)${E}`),
    block('duration', `${B}\\d+\\s?(?:-|–|a|o|y)\\s?\\d+\\s?(?:horas?|hrs?|h|min(?:utos?|s)?)${E}`),
  ],
}

// English ---------------------------------------------------------------------------------------------------------
const EN_MONTHS = [['january'], ['february'], ['march'], ['april'], ['may'], ['june'], ['july'], ['august'], ['september'], ['october'], ['november'], ['december']]
const EN_MONTH = EN_MONTHS.flat().join('|')
const EN_FOR = '(?:for\\s+)?'
const EN_RELATIVE = [['in'], ['within'], ['after']]
const EN_AFTER = ['ago', 'earlier', 'later', 'before', 'after', 'early', 'late']

export const EN: CaptureGrammar = {
  negations: [...words(['not', 'never', "don['’]t", 'dont', 'no']), rx(`${B}[\\p{L}]+n['’]t${E}`)],
  repeats: words(['every', 'each', 'daily', 'weekly', 'monthly', 'yearly', 'annually', 'biweekly', 'fortnightly', 'weekdays', 'weekends', 'twice', 'thrice',
    'times\\s+a', 'per\\s+(?:day|week|month|year)', '(?:mon|tues|wednes|thurs|fri|satur|sun)days']),
  quotePairs: [['"', '"'], ['“', '”'], ['‘', '’'], ['«', '»']],
  weekdays: {
    prefixes: ['by'],
    determiners: ['on', 'this', 'next'],
    names: { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 },
    suffix: '',
    notBefore: [],
  },
  rules: [
    {
      field: 'date', pattern: rx(`${B}(?:(?:by|for)\\s+)?(today|tomorrow)${E}`),
      resolve: (match, context) => (/^['’]s(?![\p{L}])/iu.test(context.after) ? undefined : addDays(context.today, match[1]!.toLowerCase() === 'today' ? 0 : 1)),
    },
    {
      field: 'date', pattern: rx(`${B}(on\\s+)?(${EN_MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?${E}`),
      resolve: (match, context) => {
        // "may" is mostly the verb: only "May" or "on may" name the month.
        if (match[2] === 'may' && match[1] === undefined) return undefined
        if (/^\s*,?\s*\d{4}(?![\p{N}])/u.test(context.after)) return BLOCK
        if (/^[:.,]?\d/u.test(context.after)) return undefined
        return nextDayOfMonth(context.today, Number(match[3]), monthIndex(EN_MONTHS, match[2]!))
      },
    },
    {
      field: 'date', pattern: rx(`${B}on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+(${EN_MONTH}))?${E}`),
      resolve: (match, context) => nextDayOfMonth(context.today, Number(match[1]), match[2] ? monthIndex(EN_MONTHS, match[2]) : undefined),
    },
    block('date', `${B}\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?${E}`),
    { field: 'time', pattern: rx(`${B}(?:at\\s+)?(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s?([ap])\\.?\\s?m\\.?(?![\\p{L}\\p{N}])`), resolve: (match) => hour12(Number(match[1]), Number(match[2] ?? 0), match[3]!) },
    { field: 'time', pattern: rx(`${B}(?:at\\s+)?noon${E}`), resolve: () => 720 },
    { field: 'time', pattern: rx(`${B}(?:at\\s+)?(\\d{1,2}):(\\d{2})${E}`), resolve: (match) => colonTime(match[1]!, match[2]!) },
    block('time', `${B}(?:at\\s+)?\\d{1,2}\\.\\d{2}${E}`),
    block('time', `${B}at\\s+\\d{1,2}${E}`),
    block('time', `${B}at\\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)${E}`),
    block('time', `${B}\\d{1,2}\\s*o['’]?clock${E}`),
    { field: 'duration', pattern: rx(`${B}${EN_FOR}(\\d{1,2})\\s?h(?:ours?|rs?)?\\s?(\\d{1,2})\\s?m(?:in(?:utes?|s)?)?${E}`), resolve: (match, context) => length(Number(match[1]) * 60 + Number(match[2]), context, EN_RELATIVE, EN_AFTER) },
    { field: 'duration', pattern: rx(`${B}${EN_FOR}(\\d{1,4})\\s?(?:minutes|minute|mins|min)${E}`), resolve: (match, context) => length(Number(match[1]), context, EN_RELATIVE, EN_AFTER) },
    { field: 'duration', pattern: rx(`${B}${EN_FOR}(\\d{1,4})\\s?(?:hours|hour|hrs|hr|h)${E}`), resolve: (match, context) => length(Number(match[1]) * 60, context, EN_RELATIVE, EN_AFTER) },
    {
      field: 'duration', pattern: rx(`${B}${EN_FOR}(an\\s+hour\\s+and\\s+a\\s+half|half\\s+an\\s+hour|an\\s+hour|one\\s+hour)${E}`),
      resolve: (match, context) => length({ 'half an hour': 30, 'an hour': 60, 'one hour': 60 }[match[1]!.toLowerCase().replace(/\s+/g, ' ')] ?? 90, context, EN_RELATIVE, EN_AFTER),
    },
    block('duration', `${B}\\d+[.,]\\d+\\s?(?:hours?|hrs?|h|min(?:utes?|s)?)${E}`),
    block('duration', `${B}\\d+\\s?(?:-|–|to|or)\\s?\\d+\\s?(?:hours?|hrs?|h|min(?:utes?|s)?)${E}`),
  ],
}

// Portuguese ------------------------------------------------------------------------------------------------------
const PT_MONTHS = [['janeiro'], ['fevereiro'], ['março', 'marco'], ['abril'], ['maio'], ['junho'], ['julho'], ['agosto'], ['setembro'], ['outubro'], ['novembro'], ['dezembro']]
const PT_MONTH = PT_MONTHS.flat().join('|')
const PT_AT = '(?:(?:às|as)\\s+)'
const PT_UNTIL = '(?:(?:para|até|ate)\\s+)?'
const PT_FOR = '(?:(?:por|durante)\\s+)?'
const PT_RELATIVE = [['em'], ['há'], ['ha'], ['a', 'daqui'], ['de', 'dentro'], ['após'], ['apos'], ['a']]
const PT_AFTER = ['antes', 'depois', 'mais', 'atrás', 'atras']

export const PT: CaptureGrammar = {
  negations: words(['não', 'nao', 'nunca', 'sem', 'jamais']),
  repeats: words(['cada', 'todo\\s+dia', 'todos\\s+os', 'todas\\s+as', 'toda\\s+(?:segunda|terça|terca|quarta|quinta|sexta|semana|manhã|manha|tarde|noite)',
    'diariamente', 'di[aá]ri[oa]s?', 'semanal(?:mente)?', 'mensal(?:mente)?', 'anual(?:mente)?', 'dias\\s+[uú]teis', 'vezes',
    '(?:às|aos|as|os)\\s+(?:segundas|terças|tercas|quartas|quintas|sextas|sábados|sabados|domingos)']),
  quotePairs: [['«', '»'], ['"', '"'], ['“', '”'], ['‘', '’']],
  weekdays: {
    prefixes: ['para', 'até', 'ate'],
    determiners: ['na\\s+pr[oó]xima', 'no\\s+pr[oó]ximo', 'nesta', 'neste', 'na', 'no'],
    names: {
      'segunda-feira': 1, 'terça-feira': 2, 'terca-feira': 2, 'quarta-feira': 3, 'quinta-feira': 4, 'sexta-feira': 5,
      segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6, domingo: 0,
    },
    suffix: '',
    notBefore: ['vez', 'vezes', 'parte', 'etapa', 'fase', 'opção', 'opcao', 'chance', 'rodada', 'mão', 'mao', 'via', 'edição', 'edicao'],
  },
  rules: [
    {
      field: 'date', pattern: rx(`${B}${PT_UNTIL}(depois\\s+de\\s+amanh[ãa]|amanh[ãa]|hoje)${E}`),
      resolve: (match, context) => {
        const word = match[1]!.toLowerCase()
        if (word === 'hoje' && /^\s+em\s+dia/iu.test(context.after)) return undefined
        return addDays(context.today, word === 'hoje' ? 0 : word.startsWith('depois') ? 2 : 1)
      },
    },
    {
      field: 'date', pattern: rx(`${B}${PT_UNTIL}(?:no\\s+)?dia\\s+(\\d{1,2})(?:\\s+de\\s+(${PT_MONTH}))?${E}`),
      resolve: (match, context) => (match[2] === undefined && NOT_A_DAY.test(context.after)
        ? undefined : nextDayOfMonth(context.today, Number(match[1]), match[2] ? monthIndex(PT_MONTHS, match[2]) : undefined)),
    },
    { field: 'date', pattern: rx(`${B}${PT_UNTIL}(?:em\\s+)?(\\d{1,2})\\s+de\\s+(${PT_MONTH})${E}`), resolve: (match, context) => nextDayOfMonth(context.today, Number(match[1]), monthIndex(PT_MONTHS, match[2]!)) },
    block('date', `${B}\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?${E}`),
    { field: 'time', pattern: rx(`${B}(${PT_AT})?(\\d{1,2})h([0-5]\\d)?${E}`), resolve: (match) => hourMark(match[1] !== undefined, match[2]!, match[3]) },
    {
      field: 'time', pattern: rx(`${B}${PT_AT}?(1[0-2]|0?[1-9])(?::([0-5]\\d)|h([0-5]\\d)?)?\\s+da\\s+(manhã|manha|tarde|noite)${E}`),
      resolve: (match) => withPeriod(Number(match[1]), Number(match[2] ?? match[3] ?? 0), match[4]!),
    },
    { field: 'time', pattern: rx(`${B}(?:(?:ao|às|as)\\s+)?meio[\\s-]dia${E}`), resolve: () => 720 },
    { field: 'time', pattern: rx(`${B}${PT_AT}?(\\d{1,2}):(\\d{2})(?:\\s?h)?${E}`), resolve: (match) => colonTime(match[1]!, match[2]!) },
    block('time', `${B}${PT_AT}?\\d{1,2}\\.\\d{2}${E}`),
    block('time', `${B}(?:às|as)\\s+\\d{1,2}${E}`),
    block('time', `${B}(?:às|as)\\s+(?:uma|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)${E}`),
    { field: 'duration', pattern: rx(`${B}${PT_FOR}(\\d{1,2})\\s?h(?:oras?)?\\s?(\\d{1,2})\\s?min(?:utos?|s)?${E}`), resolve: (match, context) => length(Number(match[1]) * 60 + Number(match[2]), context, PT_RELATIVE, PT_AFTER) },
    { field: 'duration', pattern: rx(`${B}${PT_FOR}(\\d{1,4})\\s?(?:minutos|minuto|mins|min)${E}`), resolve: (match, context) => length(Number(match[1]), context, PT_RELATIVE, PT_AFTER) },
    { field: 'duration', pattern: rx(`${B}${PT_FOR}(\\d{1,4})(?:\\s?(?:horas|hora|hrs)|\\s+h)${E}`), resolve: (match, context) => length(Number(match[1]) * 60, context, PT_RELATIVE, PT_AFTER) },
    {
      field: 'duration', pattern: rx(`${B}${PT_FOR}(uma\\s+hora\\s+e\\s+meia|meia\\s+hora|uma\\s+hora)${E}`),
      resolve: (match, context) => length({ 'meia hora': 30, 'uma hora': 60 }[match[1]!.toLowerCase().replace(/\s+/g, ' ')] ?? 90, context, PT_RELATIVE, PT_AFTER),
    },
    block('duration', `${B}\\d+[.,]\\d+\\s?(?:horas?|hrs?|h|min(?:utos?|s)?)${E}`),
    block('duration', `${B}\\d+\\s?(?:-|–|a|ou|e)\\s?\\d+\\s?(?:horas?|hrs?|h|min(?:utos?|s)?)${E}`),
  ],
}

export const GRAMMARS: Readonly<Record<string, CaptureGrammar>> = { es: ES, en: EN, pt: PT }
