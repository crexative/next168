import type { PlannerDocument } from './model'
import { datedOccurrences, localDateOf } from './time'

export function currentAndNext(document: PlannerDocument, now: Date, timeZone: string) {
  const instant = now.getTime()
  const dated = datedOccurrences(document, localDateOf(now, timeZone), 8, timeZone)
  const active = dated.find((item) => Date.parse(item.start) <= instant && instant < Date.parse(item.end))
  const current = active ? {
    ...active, minutesLeft: Math.ceil((Date.parse(active.end) - instant) / 60000),
    progress: (instant - Date.parse(active.start)) / (Date.parse(active.end) - Date.parse(active.start)),
  } : null
  return { current, next: dated.find((item) => Date.parse(item.start) > instant) ?? null }
}
