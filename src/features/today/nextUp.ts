import type { PlannerDocument } from '@/core/model'
import { datedOccurrences, localDateOf } from '@/core/time'
import type { TimelineItem } from './todayTimeline'

export interface UpcomingItem { key: string; title: string; start: string }

// "Después" is either the next thing that starts or, when nothing starts right after the current item, the free
// time that follows it.
export type NextUp =
  | { kind: 'item'; title: string; start: string }
  | { kind: 'free'; start: string; until: string }

const NEXT_DAYS = 8

// Today's items of every kind plus the routine blocks of the coming days, so "Después" can name tomorrow.
export function upcomingItems(document: PlannerDocument, today: string, timeZone: string, items: TimelineItem[]): UpcomingItem[] {
  const known = new Set(items.map((item) => item.key))
  const later = datedOccurrences(document, today, NEXT_DAYS, timeZone)
    .map((occurrence) => ({ key: `block:${occurrence.blockId}@${occurrence.start}`, title: occurrence.title, start: occurrence.start }))
    .filter((item) => !known.has(item.key))
  return [...items, ...later]
}

interface NextInput {
  // End of the primary item, or undefined when nothing is current.
  primaryEnd: string | undefined
  // True when another item spans the primary item's end: there is no free time to name.
  continues: boolean
  upcoming: UpcomingItem[]
  now: Date
  today: string
  timeZone: string
}

export function nextUp({ primaryEnd, continues, upcoming, now, today, timeZone }: NextInput): NextUp | null {
  const first = upcoming
    .filter((item) => Date.parse(item.start) > now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.key.localeCompare(b.key))[0]
  if (!first) return null
  const item: NextUp = { kind: 'item', title: first.title, start: first.start }
  if (primaryEnd === undefined || continues || Date.parse(first.start) <= Date.parse(primaryEnd)) return item
  const freeToday = localDateOf(primaryEnd, timeZone) === today && localDateOf(first.start, timeZone) === today
  return freeToday ? { kind: 'free', start: primaryEnd, until: first.start } : item
}
