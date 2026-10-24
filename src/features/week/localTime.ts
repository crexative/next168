import { MINUTES_PER_DAY, type DayIndex } from '@/core/model'
import { addLocalDays } from '@/core/time'

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

export function formatTime(instant: number | string | Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant))
}

// Formats a nominal minute of day; UTC keeps it independent of the host zone.
export function formatMinute(minute: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(Date.UTC(2000, 0, 1, 0, minute % MINUTES_PER_DAY))
}

export function formatHour(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric' }).format(Date.UTC(2000, 0, 1, hour))
}

export function formatDate(date: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}
