import ICAL from 'ical.js'
import type { ExternalOccurrence } from './model'
import { zonedInstant } from './time'

export interface CalendarRange { start: string; end: string }
export const MAX_ICS_BYTES = 5 * 1024 * 1024
const WINDOWS_ZONES: Record<string, string> = {
  'UTC': 'UTC', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles', 'SA Pacific Standard Time': 'America/Bogota',
  'SA Eastern Standard Time': 'America/Cayenne', 'E. South America Standard Time': 'America/Sao_Paulo',
  'India Standard Time': 'Asia/Kolkata', 'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland', 'South Africa Standard Time': 'Africa/Johannesburg',
}

export class CalendarImportError extends Error {
  constructor(public readonly code: string) { super(`calendars.${code}`) }
}

const recurrenceKey = (time: ICAL.Time): string => time.isDate ? time.toString() : String(time.toUnixTime())

function recurrenceSeed(rule: ICAL.Recur, start: ICAL.Time, from: number): { start: ICAL.Time; skipped: number } {
  const periodHours: Record<string, number> = { HOURLY: 1, DAILY: 24, WEEKLY: 168 }
  const hours = periodHours[rule.freq]
  // COUNT with BY-parts needs an exact bounded replay; changing DTSTART would reset its count.
  if (!hours || (rule.count && Object.keys(rule.parts).length)) return { start, skipped: 0 }
  const target = ICAL.Time.fromJSDate(new Date(from), true).convertToZone(start.zone)
  const step = hours * rule.interval
  const skipped = Math.max(0, Math.floor(target.subtractDate(start).toSeconds() / (step * 3600)) - 1)
  const seed = start.clone()
  // Whole wall-time periods retain DTSTART's defaults and INTERVAL/WKST phase across DST.
  if (rule.freq === 'HOURLY') seed.adjust(0, skipped * step, 0, 0)
  else seed.adjust(skipped * step / 24, 0, 0, 0)
  return { start: seed, skipped }
}

// ICAL keeps recurrence arithmetic in wall time; Intl supplies offsets for zones without VTIMEZONE.
class IntlTimezone extends ICAL.Timezone {
  constructor(private readonly iana: string) { super({ tzid: iana }) }
  override utcOffset(time: ICAL.Time): number {
    const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
    const instant = zonedInstant(time.toString().slice(0, 10), time.hour * 60 + time.minute, this.iana).getTime() + time.second * 1000
    return (wall - instant) / 1000
  }
}

export function validateIcsText(text: string): ICAL.Component {
  if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) throw new CalendarImportError('size')
  try {
    const calendar = new ICAL.Component(ICAL.parse(text))
    if (calendar.name !== 'vcalendar') throw new Error('calendar')
    for (const component of [...calendar.getAllSubcomponents('vevent'), ...calendar.getAllSubcomponents('vtimezone').flatMap(zone => zone.getAllSubcomponents())]) {
      for (const property of component.getAllProperties('rrule')) {
        const rule = property.getFirstValue() as ICAL.Recur
        if (['SECONDLY', 'MINUTELY'].includes(rule.freq)) throw new CalendarImportError('frequency')
      }
    }
    return calendar
  } catch (error) {
    if (error instanceof CalendarImportError) throw error
    throw new CalendarImportError('invalid')
  }
}

export function icsImport(text: string, sourceId: string, range: CalendarRange, timeZone: string): ExternalOccurrence[] {
  const root = validateIcsText(text)
  const boundary = (value: string) => value.length === 10 ? zonedInstant(value, 0, timeZone).getTime() : Date.parse(value)
  const from = boundary(range.start), until = boundary(range.end)
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) throw new CalendarImportError('range')
  let iterations = 0
  const tick = (work = 1) => {
    // Historical replay and in-range candidates share one source-wide work limit.
    iterations += work
    if (iterations > 50000) throw new CalendarImportError('iterations')
  }
  const budgetRules = (component: ICAL.Component): void => {
    for (const property of component.getAllProperties('rrule')) {
      const rule = property.getFirstValue() as ICAL.Recur
      if (!Number.isSafeInteger(rule.interval) || rule.interval < 1) throw new CalendarImportError('invalid')
      if (rule.interval > 50000) throw new CalendarImportError('iterations')
      if (rule.count !== null && (!Number.isSafeInteger(rule.count) || rule.count < 1)) throw new CalendarImportError('iterations')
      // A next() call can skip unbounded invalid candidates internally. Budget its input reads,
      // including VTIMEZONE rules, without patching ICAL's implementation or global prototypes.
      property.setValue(new Proxy(rule, { get(target, key, receiver) {
        if (key === 'freq') tick()
        if (key === 'interval') tick(target.interval)
        return Reflect.get(target, key, receiver)
      } }))
    }
    for (const child of component.getAllSubcomponents()) budgetRules(child)
  }
  budgetRules(root)
  const zones = new Map<string, ICAL.Timezone>()
  for (const component of root.getAllSubcomponents('vtimezone')) {
    const tzid = String(component.getFirstPropertyValue('tzid'))
    zones.set(tzid, new ICAL.Timezone({ component, tzid }))
  }
  const resolveZone = (name: string) => {
    if (zones.has(name)) return zones.get(name)!
    const iana = WINDOWS_ZONES[name] ?? name
    try { new Intl.DateTimeFormat('en', { timeZone: iana }).format() }
    catch { throw new CalendarImportError('timezone') }
    const zone = new IntlTimezone(iana)
    zones.set(name, zone)
    return zone
  }
  for (const component of root.getAllSubcomponents('vevent')) {
    for (const name of ['dtstart', 'dtend', 'recurrence-id', 'exdate', 'rdate']) {
      for (const property of component.getAllProperties(name)) {
        for (const value of property.getValues()) {
          const times = value instanceof ICAL.Period ? [value.start, value.end].filter(Boolean) : value instanceof ICAL.Time ? [value] : []
          for (const time of times) if (!time.isDate && time.zone !== ICAL.Timezone.utcTimezone) {
            const tzid = String(property.getParameter('tzid') ?? timeZone)
            time.zone = resolveZone(tzid)
          }
        }
      }
    }
  }
  const output = new Map<string, ExternalOccurrence>()
  const cancelled = (component: ICAL.Component) => component.getFirstPropertyValue('status') === 'CANCELLED'
  const emit = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId?: string) => {
    if (cancelled(event.component)) return
    const startText = start.isDate ? start.toString() : start.toJSDate().toISOString()
    const endText = end.isDate ? end.toString() : end.toJSDate().toISOString()
    const startMs = start.isDate ? boundary(startText) : Date.parse(startText)
    const endMs = end.isDate ? boundary(endText) : Date.parse(endText)
    if (endMs < startMs) throw new CalendarImportError('interval')
    if (startMs >= until || endMs <= from) return
    const occurrence: ExternalOccurrence = { sourceId, uid: event.uid, ...(recurrenceId ? { recurrenceId } : {}), title: event.summary || '', start: startText, end: endText, allDay: start.isDate, busy: event.component.getFirstPropertyValue('transp') !== 'TRANSPARENT' }
    output.set(JSON.stringify([sourceId, event.uid, recurrenceId ?? '']), occurrence)
    if (output.size > 5000) throw new CalendarImportError('occurrences')
  }
  const components = root.getAllSubcomponents('vevent')
  const exceptions = components.filter(component => component.hasProperty('recurrence-id'))
  for (const component of components.filter(component => !component.hasProperty('recurrence-id'))) {
    tick()
    if (cancelled(component)) continue
    if (!component.hasProperty('dtstart') || !component.getFirstPropertyValue('uid')) throw new CalendarImportError('invalid')
    const related = exceptions.filter(exception => exception.getFirstPropertyValue('uid') === component.getFirstPropertyValue('uid'))
    const active = related.filter(exception => !cancelled(exception) && exception.hasProperty('dtstart'))
    const event = new ICAL.Event(component, { exceptions: active })
    if (!event.isRecurring()) { emit(event, event.startDate, event.endDate); continue }
    const excluded = new Set(component.getAllProperties('exdate').flatMap(property => property.getValues().map(value => recurrenceKey(value as ICAL.Time))))
    const overridden = new Set(related.map(exception => recurrenceKey(exception.getFirstPropertyValue('recurrence-id') as ICAL.Time)))
    const visit = (time: ICAL.Time) => {
      const key = recurrenceKey(time)
      if (excluded.has(key) || overridden.has(key)) return
      const details = event.getOccurrenceDetails(time)
      emit(details.item, details.startDate, details.endDate, time.toString())
    }
    visit(event.startDate)
    // Include overlapping instances and forward range shifts, with a margin for offset transitions.
    const lookback = Math.max(0, event.duration.toSeconds(), ...active.filter(exception =>
      exception.getFirstProperty('recurrence-id')?.getParameter('range') === 'THISANDFUTURE',
    ).map(exception => {
      const override = new ICAL.Event(exception)
      return override.startDate.toUnixTime() - override.recurrenceId.toUnixTime() + override.duration.toSeconds()
    }))
    const nearFrom = from - (lookback + 2 * 86400) * 1000
    for (const property of component.getAllProperties('rrule')) {
      const rule = property.getFirstValue() as ICAL.Recur
      const seed = recurrenceSeed(rule, event.startDate, nearFrom)
      if (rule.count && seed.skipped >= rule.count) continue
      const iterator = rule.iterator(seed.start)
      let first = true
      for (;;) {
        tick()
        const next = iterator.next()
        if (!next) break
        if (first && rule.count) iterator.occurrence_number += seed.skipped
        first = false
        const instant = next.isDate ? boundary(next.toString()) : next.toJSDate().getTime()
        if (instant < nearFrom) continue
        if (instant >= until) break
        visit(next)
      }
    }
    for (const property of component.getAllProperties('rdate')) for (const value of property.getValues()) {
      tick()
      if (value instanceof ICAL.Time) visit(value)
      else if (value instanceof ICAL.Period) {
        const key = recurrenceKey(value.start)
        if (!excluded.has(key) && !overridden.has(key)) emit(event, value.start, value.getEnd(), value.start.toString())
      } else throw new CalendarImportError('invalid')
    }
  }
  // Detached/moved exceptions are checked independently, including moves into the requested range.
  for (const component of exceptions) {
    tick()
    if (cancelled(component)) continue
    const event = new ICAL.Event(component)
    emit(event, event.startDate, event.endDate, event.recurrenceId.toString())
  }
  return [...output.values()].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))
}
