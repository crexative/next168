import type { DayIndex } from '@/core/model'
import { formatMinuteOfDay } from '@/ui/format'
import type { BlockPreset } from './templates'

const MINUTES_PER_DAY = 24 * 60

function clockParts(minute: number, locale: string): Intl.DateTimeFormatPart[] {
  const normalized = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).formatToParts(Date.UTC(2000, 0, 1, 0, normalized))
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

// "lun–vie", "lun, mié, vie", "sáb": runs of three or more consecutive days collapse, in the order the week is shown.
export function daysText(days: readonly DayIndex[], locale: string, weekStartsOn: 0 | 1, everyDay: string): string {
  if (new Set(days).size === 7) return everyDay
  const name = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const label = (day: DayIndex) => name.format(Date.UTC(2024, 0, 7 + day))
  const ordered = Array.from({ length: 7 }, (_, index) => ((index + weekStartsOn) % 7) as DayIndex).filter((day) => days.includes(day))
  const runs: DayIndex[][] = []
  for (const day of ordered) {
    const last = runs[runs.length - 1]
    if (last && (last[last.length - 1]! + 1) % 7 === day) last.push(day)
    else runs.push([day])
  }
  return runs.map((run) => run.length >= 3 ? `${label(run[0]!)}–${label(run[run.length - 1]!)}` : run.map(label).join(', ')).join(', ')
}

export function routineLineText(block: BlockPreset, locale: string, weekStartsOn: 0 | 1, everyDay: string): string {
  return `${daysText(block.days, locale, weekStartsOn, everyDay)} · ${timeRangeText(block.start, block.end, locale)}`
}
