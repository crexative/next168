import type { PlannerDocument } from '@/core/model'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from '@/core/time'
import { weekDates } from '@/features/week/localTime'

const DAY_MS = 86_400_000

export interface WeekEnd {
  // Local date of the week's last day (Sunday when weeks start on Monday).
  lastDate: string
  // First instant of the next week, exclusive.
  end: Date
}

export function weekEnd(document: PlannerDocument, now: Date, timeZone: string): WeekEnd {
  const lastDate = weekDates(localDateOf(now, timeZone), document.settings.weekStartsOn)[6]!
  return { lastDate, end: zonedInstant(addLocalDays(lastDate, 1), 0, timeZone) }
}

// Hours from `now` to the end of the current week that no block covers. Overlapping blocks count once,
// elapsed time is measured between real instants (so a DST week is not forced to 168 h).
export function freeHoursAhead(document: PlannerDocument, now: Date, timeZone: string): number {
  const from = now.getTime()
  const { lastDate, end } = weekEnd(document, now, timeZone)
  const to = end.getTime()
  if (to <= from) return 0
  const today = localDateOf(now, timeZone)
  const days = Math.round((Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) + 1
  const covered = datedOccurrences(document, today, days, timeZone)
    .map((item) => ({ start: Math.max(from, Date.parse(item.start)), end: Math.min(to, Date.parse(item.end)) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start)
  let coveredMs = 0
  let open: { start: number; end: number } | undefined
  for (const item of covered) {
    if (open && item.start <= open.end) open.end = Math.max(open.end, item.end)
    else {
      if (open) coveredMs += open.end - open.start
      open = { ...item }
    }
  }
  if (open) coveredMs += open.end - open.start
  return Math.max(0, Math.round((to - from - coveredMs) / 60_000)) / 60
}
