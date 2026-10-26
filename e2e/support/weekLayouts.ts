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

// The realistic week verify6 used (its fixture f3): a family and work routine with 10 to 20 minute routines (breakfast,
// a pause, meditation, school pickup), a 30-minute webinar beside "Correos y seguimiento", a 10-minute stand-up beside
// "Trabajo de la mañana", and an hour-long task among 15-minute ones.
export const VERIFY6_NOW = new Date('2026-10-21T10:07:00.000Z')
const task = (id: string, title: string, durationMin: number, extra: Record<string, unknown> = {}) => ({ id, title, durationMin, priority: 2, createdAt: '2026-10-20T08:00:00.000Z', ...extra })
const event = (id: string, title: string, start: string, end: string) => ({ id, title, start, end, allDay: false, attendees: [] as string[] })
const weekdays = [1, 2, 3, 4, 5]
export const VERIFY6_WEEK = {
  schemaVersion: 2, workspaceId: 'workspace-v6', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 45 } },
    { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-family', name: 'Familia', colorKey: 'orange', goal: { type: 'min', hoursPerWeek: 10 } },
    { id: 'c-health', name: 'Salud', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 2 } },
    { id: 'c-home', name: 'Hogar', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
  blocks: [
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 390 },
    { id: 'b-breakfast', categoryId: 'c-family', title: 'Desayuno con los niños', days: weekdays, start: 405, end: 425 },
    { id: 'b-commute', categoryId: 'c-work', title: 'Traslado a la oficina', days: weekdays, start: 450, end: 490 },
    { id: 'b-standup', categoryId: 'c-work', title: 'Reunión de equipo', days: weekdays, start: 495, end: 510 },
    { id: 'b-am', categoryId: 'c-work', title: 'Trabajo de la mañana', days: weekdays, start: 510, end: 750 },
    { id: 'b-lunch', categoryId: 'c-family', title: 'Almuerzo', days: weekdays, start: 750, end: 795 },
    { id: 'b-pm1', categoryId: 'c-work', title: 'Trabajo', days: weekdays, start: 795, end: 900 },
    { id: 'b-break', categoryId: 'c-health', title: 'Pausa activa', days: weekdays, start: 900, end: 910 },
    { id: 'b-pm2', categoryId: 'c-work', title: 'Correos y seguimiento', days: weekdays, start: 910, end: 1050 },
    { id: 'b-pickup', categoryId: 'c-family', title: 'Recoger a los niños', days: weekdays, start: 1065, end: 1085 },
    { id: 'b-dinner', categoryId: 'c-family', title: 'Cena familiar', days: [0, 1, 2, 3, 4, 5, 6], start: 1140, end: 1185 },
    { id: 'b-med', categoryId: 'c-health', title: 'Meditación', days: [0, 1, 2, 3, 4, 5, 6], start: 1290, end: 1300 },
    { id: 'b-market', categoryId: 'c-home', title: 'Mercado de la semana', days: [6], start: 540, end: 630 },
    { id: 'b-mass', categoryId: 'c-family', title: 'Visita a los abuelos', days: [0], start: 600, end: 780 },
  ],
  tasks: [
    task('t-1', 'Pagar la factura de la luz', 15, { categoryId: 'c-home', dueDate: '2026-10-22' }),
    task('t-2', 'Enviar fotos a la abuela', 15, { categoryId: 'c-family' }),
    task('t-3', 'Llamar al pediatra', 15, { categoryId: 'c-health', priority: 1 }),
    task('t-4', 'Revisar extracto bancario', 20),
    task('t-5', 'Comprar regalo de cumpleaños', 20, { dueDate: '2026-10-24' }),
    task('t-6', 'Responder a Carolina', 15, { categoryId: 'c-work' }),
    task('t-7', 'Actualizar hoja de gastos del equipo', 15, { categoryId: 'c-work' }),
    task('t-8', 'Preparar presentación para el cliente', 60, { categoryId: 'c-work', priority: 1, dueDate: '2026-10-23' }),
    task('t-9', 'Firmar permiso escolar', 15, { categoryId: 'c-family', dueDate: '2026-10-21' }),
    task('t-10', 'Agendar revisión del carro', 15, { categoryId: 'c-home' }),
  ],
  checkIns: [], actuals: [],
  events: [
    event('e-1', 'Llamada con el contador', '2026-10-20T08:20:00.000Z', '2026-10-20T08:50:00.000Z'),
    event('e-2', 'Cita odontológica', '2026-10-21T12:45:00.000Z', '2026-10-21T13:30:00.000Z'),
    event('e-3', 'Webinar de ventas internacionales', '2026-10-22T15:00:00.000Z', '2026-10-22T15:30:00.000Z'),
    event('e-4', 'Reunión escolar de padres', '2026-10-23T17:40:00.000Z', '2026-10-23T18:20:00.000Z'),
    event('e-5', 'Stand-up con el cliente', '2026-10-19T09:00:00.000Z', '2026-10-19T09:10:00.000Z'),
    event('e-6', 'Cumpleaños de Sofía', '2026-10-24T16:00:00.000Z', '2026-10-24T19:00:00.000Z'),
    event('e-7', 'Café con Andrés', '2026-10-21T10:00:00.000Z', '2026-10-21T10:20:00.000Z'),
  ],
  calendarSources: [], appliedProposalIds: [],
}

// The week verify8 used (its fixture f4): 15 and 20 minute routines next to long ones of the same category, and an
// imported calendar whose events cross routines (conflicts) at 10, 15, 20 and 60 minutes.
export const VERIFY8_WEEK = {
  schemaVersion: 2, workspaceId: 'workspace-v8', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [
    { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 42 } },
    { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-pet', name: 'Mascota', colorKey: 'orange', goal: { type: 'min', hoursPerWeek: 3 } },
    { id: 'c-fit', name: 'Ejercicio', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 3 } },
    { id: 'c-learn', name: 'Estudio', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 2 } },
  ],
  blocks: [
    { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1350, end: 360 },
    { id: 'b-dog1', categoryId: 'c-pet', title: 'Paseo del perro', days: [0, 1, 2, 3, 4, 5, 6], start: 375, end: 395 },
    { id: 'b-coffee', categoryId: 'c-work', title: 'Café y agenda', days: weekdays, start: 465, end: 480 },
    { id: 'b-focus', categoryId: 'c-work', title: 'Bloque de foco', days: weekdays, start: 480, end: 690 },
    { id: 'b-lunch', categoryId: 'c-pet', title: 'Almuerzo y perro', days: weekdays, start: 720, end: 780 },
    { id: 'b-calls', categoryId: 'c-work', title: 'Llamadas con clientes', days: weekdays, start: 780, end: 960 },
    { id: 'b-wrap', categoryId: 'c-work', title: 'Cierre del día', days: weekdays, start: 960, end: 975 },
    { id: 'b-run', categoryId: 'c-fit', title: 'Trotar', days: [1, 3, 5], start: 1050, end: 1080 },
    { id: 'b-read', categoryId: 'c-learn', title: 'Lectura', days: [0, 1, 2, 3, 4, 5, 6], start: 1290, end: 1310 },
    { id: 'b-dog2', categoryId: 'c-pet', title: 'Paseo nocturno', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 1335 },
  ],
  tasks: [
    task('u-1', 'Renovar la licencia de conducción', 20, { dueDate: '2026-10-23' }),
    task('u-2', 'Enviar factura a Lucía', 15, { categoryId: 'c-work', priority: 1 }),
    task('u-3', 'Comprar comida del perro', 15, { categoryId: 'c-pet' }),
    task('u-4', 'Estirar', 20, { categoryId: 'c-fit' }),
    task('u-5', 'Revisar contrato de arriendo', 20, { dueDate: '2026-10-22' }),
    task('u-6', 'Pedir cita con el veterinario', 15, { categoryId: 'c-pet', dueDate: '2026-10-21' }),
  ],
  checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}

const VERIFY8_EVENTS: [string, string, string][] = [
  ['Demo con el cliente', '20261020T133000Z', '20261020T143000Z'],
  ['Revisión de presupuesto', '20261021T074500Z', '20261021T080000Z'],
  ['Llamada de RR. HH.', '20261022T090000Z', '20261022T091000Z'],
  ['Firma digital', '20261022T180000Z', '20261022T181500Z'],
  ['Sincronización semanal', '20261023T120000Z', '20261023T122000Z'],
  ['Entrega del paquete', '20261024T150000Z', '20261024T152000Z'],
  ['Llamada con mamá', '20261025T170000Z', '20261025T171500Z'],
]
export const VERIFY8_CALENDAR = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...VERIFY8_EVENTS.flatMap(([title, start, end], index) => [
  'BEGIN:VEVENT', `UID:v-${index + 1}@verify8.example.invalid`, 'DTSTAMP:20261019T000000Z', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`, 'END:VEVENT',
]), 'END:VCALENDAR', ''].join('\r\n')
