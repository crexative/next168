import { addLocalDays, localDateOf } from '@/core/time'
import { formatDate } from '@/features/week/localTime'

interface ContinuationHint {
  key: string
  params: Record<string, string>
}

export function continuationHints(
  item: { start: string; end: string }, now: Date, timeZone: string, locale: string,
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
    hints.push(endDate === addLocalDays(today, 1)
      ? { key: 'today.timeline.untilTomorrow', params: {} }
      : { key: 'today.timeline.untilDate', params: { date: formatDate(lastCoveredDate, locale, { weekday: 'short', day: 'numeric' }) } })
  }
  return hints
}
