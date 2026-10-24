import { addLocalDays } from '@/core/time'

export function shiftWeek(dates: readonly string[], weeks: number): string[] {
  return dates.map((date) => addLocalDays(date, weeks * 7))
}

export function isSameWeek(dates: readonly string[], other: readonly string[]): boolean {
  return dates[0] === other[0]
}

// "19–25 Oct": the year only appears when the week is not in the current year.
export function weekRangeLabel(dates: readonly string[], locale: string, today: string): string {
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (!first || !last) return ''
  const withYear = first.slice(0, 4) !== today.slice(0, 4) || last.slice(0, 4) !== today.slice(0, 4)
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' })
  return (format as Intl.DateTimeFormat & { formatRange(start: Date, end: Date): string }).formatRange(new Date(`${first}T12:00:00Z`), new Date(`${last}T12:00:00Z`))
}

// The weekday kept when paging between weeks; the current week opens on today.
export function pagerIndexFor(dates: readonly string[], today: string, previousIndex: number): number {
  const todayIndex = dates.indexOf(today)
  return todayIndex >= 0 ? todayIndex : Math.max(0, Math.min(previousIndex, dates.length - 1))
}
