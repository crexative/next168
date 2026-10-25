// Seeded weeks for the Week text property spec (and its memory check): 5 to 15 minute routines, back-to-back tasks,
// events on a routine's title row, overnight items, 2 to 4 overlapping lanes and titles with their own "…".
export const WEEK_LOCALES = ['es', 'en', 'de'] as const
// Wednesday 2026-10-21 05:00 UTC: Monday and Tuesday are past (with outcomes), the rest of the week holds the tasks.
export const SEEDED_NOW = new Date('2026-10-21T05:00:00.000Z')
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']

const WORDS = {
  es: {
    categories: ['Trabajo', 'Sueño', 'Ejercicio', 'Familia y amigos'],
    routines: ['Reunión diaria', 'Trabajo profundo', 'Trayecto', 'Almuerzo', 'Revisión semanal del presupuesto', 'Pausa…', 'Paseo con el perro', 'Dormir'],
    events: ['Llamada con proveedor', 'Revisión de diseño de producto', 'Dentista', 'Cumpleaños de Ana', 'Entrevista', 'Sincronización del equipo', 'Y después…', 'Pausa… larga reunión de presupuesto'],
    tasks: ['Revisar presupuesto trimestral', 'Responder correos', 'Llamar al banco', 'Leer un capítulo', 'Pagar la luz', 'Preparar la presentación para el cliente', 'Pendiente…', 'Pausa… larga reunión de presupuesto'],
  },
  en: {
    categories: ['Work', 'Sleep', 'Exercise', 'Family and friends'],
    routines: ['Stand-up', 'Deep work', 'Commute', 'Lunch', 'Weekly budget review', 'Wait...', 'Walk the dog', 'Sleep'],
    events: ['Vendor call', 'Product design review', 'Dentist', "Ana's birthday", 'Interview', 'Team sync', 'To be continued...', 'Wait... for the quarterly bus'],
    tasks: ['Write the quarterly report', 'Answer emails', 'Call the bank', 'Read a chapter', 'Pay the power bill', 'Prepare the client presentation', 'Follow up...', 'Wait... for the quarterly bus'],
  },
  de: {
    categories: ['Arbeit', 'Schlaf', 'Sport', 'Familie und Freunde'],
    routines: ['Tagesabstimmung', 'Konzentriertes Arbeiten', 'Arbeitsweg', 'Mittagessen', 'Wöchentliche Budgetprüfung', 'Pause…', 'Gassi gehen', 'Schlafen'],
    events: ['Abstimmung mit dem Lieferanten', 'Produktdesign-Review', 'Zahnarzt', 'Annas Geburtstag', 'Vorstellungsgespräch', 'Teamrunde', 'Und dann…', 'Pause… und dann Kaffee'],
    tasks: ['Quartalsbericht schreiben', 'E-Mails beantworten', 'Bank anrufen', 'Ein Kapitel lesen', 'Stromrechnung bezahlen', 'Kundenpräsentation vorbereiten', 'Nachfassen…', 'Pause… und dann Kaffee'],
  },
} as const

function random(seed: number): () => number {
  let state = seed * 2654435761
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (date: string, minute: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + minute * 60_000).toISOString()
const dayIndex = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

// One seeded week: the document, and calendar text with instants and midnight events for every fourth seed.
export function weekFor(seed: number) {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  const between = (low: number, high: number, step = 5) => low + Math.floor(next() * ((high - low) / step + 1)) * step
  const locale = WEEK_LOCALES[seed % WEEK_LOCALES.length]!
  const words = WORDS[locale]
  const categories = words.categories.map((name, index) => ({ id: `c${index}`, name, colorKey: ['blue', 'purple', 'green', 'orange'][index], goal: { type: 'none', hoursPerWeek: 0 } }))
  const blocks: { id: string; categoryId: string; title: string; days: number[]; start: number; end: number }[] = []
  const add = (categoryId: string, title: string, days: number[], start: number, end: number) => {
    if (start !== end && days.length) blocks.push({ id: `b${blocks.length}`, categoryId, title, days, start: ((start % 1440) + 1440) % 1440, end: ((end % 1440) + 1440) % 1440 })
  }
  const weekdays = [1, 2, 3, 4, 5].filter(() => next() < 0.9)
  const sleepStart = between(1290, 1410)
  add('c1', words.routines[7], [0, 1, 2, 3, 4, 5, 6], sleepStart, between(300, 450))
  const workStart = between(480, 600, 15)
  const shortLength = pick([5, 10, 15])
  // A short routine right before a long one (the 9:00–9:15 stand-up over "Deep work" in verify5).
  add('c0', words.routines[0], weekdays, workStart, workStart + shortLength)
  add('c0', words.routines[1], weekdays, workStart + shortLength, between(720, 840, 15))
  add('c0', words.routines[3], weekdays.filter(() => next() < 0.7), 780 + between(0, 60, 15), 840 + between(0, 60, 15))
  for (let count = between(1, 4, 1); count > 0; count--) {
    const start = between(360, 1380)
    add(pick(['c2', 'c3']), pick(words.routines.slice(2)), [pick([0, 1, 2, 3, 4, 5, 6])], start, start + pick([5, 10, 15, 20, 30, 45, 90]))
  }
  // Back-to-back short routines, and now and then one overlapping another (data migrated from v1 can overlap).
  const runStart = between(1020, 1200, 15)
  const runDay = pick([0, 1, 2, 3, 4, 5, 6])
  let cursor = runStart
  for (let count = between(2, 4, 1); count > 0; count--) {
    const length = pick([5, 10, 15])
    add('c2', pick(words.routines.slice(2, 7)), [runDay], cursor, cursor + length)
    cursor += length
  }
  if (next() < 0.5) add('c3', pick(words.routines.slice(2)), [pick(weekdays.length ? weekdays : [1])], workStart + 30, workStart + 150)

  const events: { id: string; title: string; start: string; end: string; allDay: false; attendees: string[] }[] = []
  const event = (date: string, start: number, end: number) => events.push({ id: `e${events.length}`, title: pick(words.events), start: iso(date, start), end: iso(date, end), allDay: false, attendees: [] })
  for (const date of WEEK) {
    if (next() < 0.35) continue
    const hosts = blocks.filter((block) => block.days.includes(dayIndex(date)) && block.end > block.start)
    if (hosts.length === 0) continue
    const host = pick(hosts)
    // On the routine's title row, then up to three more events in one cluster: 2 to 4 lanes.
    const start = host.start + pick([0, 0, 5, 10, 15, 20])
    event(date, start, start + pick([5, 10, 15, 30, 60]))
    for (let lane = between(0, 2, 1); lane > 0; lane--) {
      const other = start + pick([0, 5, 10, 20])
      event(date, other, other + pick([15, 30, 45]))
    }
  }
  // Touching midnight on both sides, and a five-minute event late at night.
  const midnightDay = pick(WEEK.slice(0, 6))
  events.push({ id: 'e-midnight', title: pick(words.events), start: iso(midnightDay, 1425), end: iso(midnightDay, 1455), allDay: false, attendees: [] })
  event(pick(WEEK), 1430, 1440)
  event(pick(WEEK), 1395, 1400)

  const tasks = Array.from({ length: between(4, 10, 1) }, (_, index) => ({
    id: `t${index}`,
    title: pick(words.tasks),
    ...(next() < 0.2 ? {} : { categoryId: pick(['c0', 'c0', 'c2', 'c3']) }),
    durationMin: pick([15, 15, 20, 30, 45, 60, 90]),
    priority: pick([1, 2, 3] as const),
    ...(next() < 0.2 ? { dueDate: pick(WEEK.slice(2)) } : {}),
    createdAt: '2026-10-18T08:00:00.000Z',
  }))

  const actuals = blocks.filter((block) => block.end > block.start && block.days.includes(1)).slice(0, 3).map((block, index) => ({
    date: WEEK[0], blockId: block.id, categoryId: block.categoryId, plannedStartAt: iso(WEEK[0]!, block.start), plannedEndAt: iso(WEEK[0]!, block.end),
    plannedMinutes: block.end - block.start, status: (['done', 'skipped', 'partial'] as const)[index],
    ...(index === 2 ? { actualMinutes: Math.max(1, Math.floor((block.end - block.start) / 2)) } : {}),
  }))

  const calendar = seed % 4 === 0 ? [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    // A reminder with no duration on a routine's title row, and one at midnight.
    'BEGIN:VEVENT', 'UID:instant@e2e', `DTSTART:${iso(WEEK[3]!, workStart).replace(/[-:]|\.\d{3}/g, '')}`, `DTEND:${iso(WEEK[3]!, workStart).replace(/[-:]|\.\d{3}/g, '')}`, `SUMMARY:${pick(words.events)}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:midnight@e2e', `DTSTART:${iso(WEEK[4]!, 1440).replace(/[-:]|\.\d{3}/g, '')}`, `DTEND:${iso(WEEK[4]!, 1440).replace(/[-:]|\.\d{3}/g, '')}`, `SUMMARY:${pick(words.events)}`, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:overnight@e2e', `DTSTART:${iso(WEEK[5]!, 1410).replace(/[-:]|\.\d{3}/g, '')}`, `DTEND:${iso(WEEK[5]!, 1470).replace(/[-:]|\.\d{3}/g, '')}`, `SUMMARY:${pick(words.events)}`, 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n') : undefined

  const document = {
    schemaVersion: 2, workspaceId: `week-text-${seed}`, revision: 1, updatedAt: '2026-10-18T08:00:00.000Z',
    settings: { locale, weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories, blocks, tasks, checkIns: [], actuals, events, calendarSources: [], appliedProposalIds: [],
  }
  return { locale, document, calendar }
}
