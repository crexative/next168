import { z } from 'zod'
import { MINUTES_PER_DAY, MINUTES_PER_WEEK, minuteSchema, type PlannerDocument, type TimeBlock } from './model'

export interface WeekInterval { start: number; end: number; day: number }
export interface DatedOccurrence {
  blockId: string
  categoryId: string
  title: string
  date: string
  start: string
  end: string
  plannedMinutes: number
}
export function occurrences(block: TimeBlock): WeekInterval[] {
  return block.days.flatMap((day) => {
    const start = day * MINUTES_PER_DAY + block.start
    if (block.end > block.start) return [{ start, end: day * MINUTES_PER_DAY + block.end, day }]
    const intervals = [{ start, end: (day + 1) * MINUTES_PER_DAY, day }]
    if (block.end > 0) intervals.push({ start: ((day + 1) * MINUTES_PER_DAY) % MINUTES_PER_WEEK, end: ((day + 1) * MINUTES_PER_DAY) % MINUTES_PER_WEEK + block.end, day: (day + 1) % 7 })
    return intervals
  })
}
export function overlaps(a: TimeBlock, b: TimeBlock): boolean {
  return occurrences(a).some((x) => occurrences(b).some((y) => x.start < y.end && y.start < x.end))
}
export function addLocalDays(date: string, days: number): string {
  z.iso.date().parse(date)
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

// One formatter per zone in use: building one is the costly part of a zoned conversion, and a formatter never changes.
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    formatters.set(timeZone, format)
  }
  return format
}
function wallTime(instant: number, format: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, part.value]))
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
}
export function localDateOf(instant: Date | string, timeZone: string): string {
  return new Date(wallTime(new Date(instant).getTime(), formatter(timeZone))).toISOString().slice(0, 10)
}

export function zonedInstant(localDate: string, minute: number, timeZone: string): Date {
  z.iso.date().parse(localDate)
  minuteSchema.parse(minute)
  const target = Date.parse(`${localDate}T00:00:00Z`) + minute * 60000
  const format = formatter(timeZone)
  // Probe both sides of transitions; use the earlier instant in a fold, and the later in a gap.
  // This also handles non-hour transitions and entire skipped dates without a date library.
  const offsets = new Set([-48, -24, 0, 24, 48].map((hours) => {
    const probe = target + hours * 3600000
    return wallTime(probe, format) - probe
  }))
  const candidates = [...offsets].map((offset) => target - offset).sort((a, b) => a - b)
  const exact = candidates.filter((candidate) => wallTime(candidate, format) === target)
  if (exact.length) return new Date(exact[0]!)
  const shifted = candidates.filter((candidate) => wallTime(candidate, format) > target)
    .sort((a, b) => wallTime(a, format) - wallTime(b, format))
  if (!shifted.length) throw new Error('time.unresolvable')
  return new Date(shifted[0]!)
}

export function datedOccurrences(document: PlannerDocument, fromDate: string, days: number, timeZone: string): DatedOccurrence[] {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('time.invalidRange')
  const rangeStart = zonedInstant(fromDate, 0, timeZone).getTime()
  const rangeEnd = zonedInstant(addLocalDays(fromDate, days), 0, timeZone).getTime()
  const result: DatedOccurrence[] = []
  for (let offset = -1; offset < days; offset++) {
    const date = addLocalDays(fromDate, offset)
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    for (const block of document.blocks) {
      if (!block.days.includes(day)) continue
      const start = zonedInstant(date, block.start, timeZone)
      const end = zonedInstant(addLocalDays(date, block.end <= block.start ? 1 : 0), block.end, timeZone)
      if (end.getTime() <= start.getTime() || start.getTime() >= rangeEnd || end.getTime() <= rangeStart) continue
      result.push({ blockId: block.id, categoryId: block.categoryId, title: block.title, date, start: start.toISOString(), end: end.toISOString(), plannedMinutes: (end.getTime() - start.getTime()) / 60000 })
    }
  }
  return result.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.blockId.localeCompare(b.blockId))
}
