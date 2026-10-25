import { addLocalDays, localDateOf } from '@/core/time'
import { formatTime } from '@/features/week/localTime'
import { formatDate } from '@/ui/format'
import { readsAsOne } from './clockPhrase'

interface ContinuationHint {
  key: string
  params: Record<string, string>
  // Picks the article form of "until {time}" in languages that agree it with the hour.
  plural?: number
}

// `clockLocale` is the person's time locale (12/24 h, region); `locale` names the app's language for the dates.
export function continuationHints(
  item: { start: string; end: string }, now: Date, timeZone: string, locale: string, clockLocale: string = locale,
): ContinuationHint[] {
  const today = localDateOf(now, timeZone)
  const startDate = localDateOf(item.start, timeZone)
  const endDate = localDateOf(item.end, timeZone)
  const lastCoveredDate = localDateOf(new Date(Date.parse(item.end) - 1), timeZone)
  const hints: ContinuationHint[] = []
  if (startDate < today) {
    hints.push(startDate === addLocalDays(today, -1)
      ? { key: 'today.timeline.sinceYesterday', params: {} }
      : { key: 'today.timeline.sinceDate', params: { date: formatDate(startDate, locale, { weekday: 'short', day: 'numeric' }) } })
  }
  if (lastCoveredDate > today) {
    if (endDate === addLocalDays(today, 1)) {
      // Tonight's sleep reads "from 11:00 p. m., until 7:00 a. m.": the end is a time, not the word "tomorrow".
      const time = formatTime(item.end, clockLocale, timeZone)
      hints.push({ key: 'today.timeline.untilTime', params: { time }, plural: readsAsOne(time) ? 1 : 2 })
    } else {
      hints.push({ key: 'today.timeline.untilDate', params: { date: formatDate(lastCoveredDate, locale, { weekday: 'short', day: 'numeric' }) } })
    }
  }
  return hints
}
