import { MINUTES_PER_DAY, type DayIndex } from '@/core/model'
import { addLocalDays } from '@/core/time'
import { clockFormat, formatClock, formatHourOfDay, formatMinuteOfDay } from '@/ui/format'

const clockFormatters = new Map<string, Intl.DateTimeFormat>()

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let format = clockFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US-u-nu-latn', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    clockFormatters.set(timeZone, format)
  }
  return format
}

export function localMinuteOf(instant: number | string | Date, timeZone: string): number {
  const parts = clockFormatter(timeZone).formatToParts(new Date(instant))
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return (value('hour') % 24) * 60 + value('minute')
}

export function dayIndexOf(date: string): DayIndex {
  return new Date(`${date}T00:00:00Z`).getUTCDay() as DayIndex
}

export function weekDates(today: string, weekStartsOn: 0 | 1): string[] {
  const offset = (dayIndexOf(today) - weekStartsOn + 7) % 7
  const first = addLocalDays(today, -offset)
  return Array.from({ length: 7 }, (_, index) => addLocalDays(first, index))
}

export function orderedDays(weekStartsOn: 0 | 1): DayIndex[] {
  return Array.from({ length: 7 }, (_, index) => ((index + weekStartsOn) % 7) as DayIndex)
}

export function minuteToTimeValue(minute: number): string {
  const normalized = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function timeValueToMinute(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const minute = Number(match[1]) * 60 + Number(match[2])
  return minute < MINUTES_PER_DAY && Number(match[2]) < 60 ? minute : null
}

// Time formatting lives in @/ui/format (one formatter app-wide); these names stay for existing callers.
export function formatTime(instant: number | string | Date, locale: string, timeZone: string): string {
  return formatClock(instant, locale, timeZone)
}

// Formats a nominal minute of day; UTC keeps it independent of the host zone.
export function formatMinute(minute: number, locale: string): string {
  return formatMinuteOfDay(minute, locale)
}

export function formatHour(hour: number, locale: string): string {
  return formatHourOfDay(hour, locale)
}

// "6", "12p", "6a": the hour without the clock's words, for the seven-day overview where its axis is 2.5 rem wide.
// A 12-hour clock keeps the first letter of its day period so morning and evening stay apart.
export function formatHourCompact(hour: number, locale: string): string {
  const parts = clockFormat(locale, { timeZone: 'UTC', hour: 'numeric' }).formatToParts(Date.UTC(2000, 0, 1, ((hour % 24) + 24) % 24))
  const raw = parts.find((part) => part.type === 'hour')?.value ?? ''
  const value = /^\d+$/.test(raw) ? String(Number(raw)) : raw
  const period = parts.find((part) => part.type === 'dayPeriod')?.value.match(/\p{L}/u)?.[0]
  return period ? `${value}${period.toLowerCase()}` : value
}

export function formatDate(date: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}
