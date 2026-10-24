import type { PlannerDocument } from '@/core/model'
import { addLocalDays, datedOccurrences, localDateOf, zonedInstant } from '@/core/time'
import { weekDates } from '@/features/week/localTime'
import { wholeHourParts } from '@/ui/format'

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

export interface WeekSplit {
  // Whole minutes of the current week, split at `now`: elapsed, still covered by blocks, and free.
  pastMinutes: number
  plannedAheadMinutes: number
  freeAheadMinutes: number
  // pastMinutes + plannedAheadMinutes + freeAheadMinutes: 168 h, or 167/169 h in a DST week.
  weekMinutes: number
}

// The current week split at `now` into what has passed, what blocks still cover, and what is free. Overlapping
// blocks count once; time is measured between real instants, so a DST week is not forced to 168 h. This is the
// one source of the "free hours" figure for Today, Week, Insights and the assistant.
export function weekSplit(document: PlannerDocument, now: Date, timeZone: string): WeekSplit {
  const from = now.getTime()
  const { lastDate, end } = weekEnd(document, now, timeZone)
  const today = localDateOf(now, timeZone)
  const firstDate = weekDates(today, document.settings.weekStartsOn)[0]!
  const start = zonedInstant(firstDate, 0, timeZone).getTime()
  const to = end.getTime()
  const pastMinutes = Math.max(0, Math.round((from - start) / 60_000))
  const aheadMinutes = Math.max(0, Math.round((to - from) / 60_000))
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
  const plannedAheadMinutes = Math.min(aheadMinutes, Math.round(coveredMs / 60_000))
  return { pastMinutes, plannedAheadMinutes, freeAheadMinutes: aheadMinutes - plannedAheadMinutes, weekMinutes: pastMinutes + aheadMinutes }
}

export interface WeekSplitHours { past: number; plannedAhead: number; freeAhead: number; week: number }

// The split as it is shown: whole hours by the shared rounding rule, so every screen says the same number.
export function weekSplitHours(split: WeekSplit): WeekSplitHours {
  const [past, plannedAhead, freeAhead] = wholeHourParts([split.pastMinutes, split.plannedAheadMinutes, split.freeAheadMinutes]) as [number, number, number]
  return { past, plannedAhead, freeAhead, week: past + plannedAhead + freeAhead }
}

// Hours from `now` to the end of the current week that no block covers.
export function freeHoursAhead(document: PlannerDocument, now: Date, timeZone: string): number {
  return weekSplit(document, now, timeZone).freeAheadMinutes / 60
}
