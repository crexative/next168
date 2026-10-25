import type { DayIndex } from '@/core/model'
import { clockFormat, formatMinuteOfDay, minuteOfDayInstant } from '@/ui/format'

function clockParts(minute: number, locale: string): Intl.DateTimeFormatPart[] {
  return clockFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).formatToParts(minuteOfDayInstant(minute))
}

// A clock time never wraps inside itself: "7:00 a." / "m." on two lines reads as two different things.
const noBreak = (text: string) => text.replace(/\s/g, '\u00a0')

// "7:30–8:00 a. m." and "9:00 a. m.–5:00 p. m.": a range names its am/pm once when both ends share it, and uses
// the person's own clock (12 or 24 h) elsewhere, so no range repeats a suffix.
export function timeRangeText(start: number, end: number, locale: string): string {
  const startParts = clockParts(start, locale)
  const period = startParts.find((part) => part.type === 'dayPeriod')?.value
  const endPeriod = clockParts(end, locale).find((part) => part.type === 'dayPeriod')?.value
  const startText = period !== undefined && period === endPeriod
    ? startParts.filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('').trim()
    : formatMinuteOfDay(start, locale)
  return `${noBreak(startText)}–${noBreak(formatMinuteOfDay(end, locale))}`
}

export interface DayLabels { weekdays: string; everyDay: string; weekend: string; everyNight?: string }

// A label inside a sentence: "every day", "lunes a viernes". A weekday name keeps the case its language writes it in,
// so English reads "Monday to Friday" and German "Montag bis Freitag", never "monday to Friday".
function inSentence(text: string, locale: string): string {
  if (!text) return text
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  const names = Array.from({ length: 7 }, (_, day) => weekday.format(Date.UTC(2024, 0, 7 + day)))
  const named = names.find((name) => text.toLocaleLowerCase(locale).startsWith(name.toLocaleLowerCase(locale)))
  if (named) return named + text.slice(named.length)
  return text.charAt(0).toLocaleLowerCase(locale) + text.slice(1)
}
const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

// "lunes a viernes", "todos los días", "lunes, miércoles y viernes": the sentence form of a set of days.
export function daysPhrase(days: readonly DayIndex[], locale: string, weekStartsOn: 0 | 1, labels: DayLabels, nights = false): string {
  const unique = [...new Set(days)]
  if (unique.length === 7) return inSentence(nights && labels.everyNight ? labels.everyNight : labels.everyDay, locale)
  if (sameSet(unique, [1, 2, 3, 4, 5])) return inSentence(labels.weekdays, locale)
  if (sameSet(unique, [6, 0])) return inSentence(labels.weekend, locale)
  const name = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  const ordered = Array.from({ length: 7 }, (_, index) => ((index + weekStartsOn) % 7) as DayIndex).filter((day) => unique.includes(day))
  // Intl.ListFormat is newer than the project's declared library.
  const ListFormat = (Intl as unknown as { ListFormat: new (locale: string, options: { style: string; type: string }) => { format(items: string[]): string } }).ListFormat
  return new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(ordered.map((day) => name.format(Date.UTC(2024, 0, 7 + day))))
}
