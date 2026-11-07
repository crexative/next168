import type { PlannerDocument } from '@/core/model'
import { localDateOf } from '@/core/time'
import { upcomingItems } from './nextUp'
import { buildNowState } from './nowState'
import { buildTimeline } from './todayTimeline'

// The Now state of a synthetic UTC document at an instant, built the way TodayView builds it.
export function nowStateFor(document: PlannerDocument, instant: string, options: { since?: number | null; closeDayOpen?: boolean } = {}) {
  const now = new Date(instant)
  const today = localDateOf(now, 'UTC')
  const { items } = buildTimeline({ document, today, timeZone: 'UTC', external: [], placements: [] })
  return buildNowState({
    items, upcoming: upcomingItems(document, today, 'UTC', items), actuals: document.actuals,
    since: options.since === null ? undefined : options.since ?? Date.parse('2026-10-01T00:00:00Z'),
    now, today, timeZone: 'UTC', closeDayOpen: options.closeDayOpen ?? false,
  })
}
