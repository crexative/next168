import type { BlockActual } from '@/core/model'
import { localDateOf } from '@/core/time'
import { nowAction, type NowAction } from './nowAction'
import { nextUp, type NextUp, type UpcomingItem } from './nextUp'
import { nowContext, selectNow, type NowContext } from './nowSelection'
import type { TimelineItem } from './todayTimeline'

export const FREE_KEY = 'free'

// Everything the Now card shows, decided in one place so the card, the list and the announcements agree.
export interface NowState {
  // Key of the primary item, or FREE_KEY when nothing spans now.
  key: string
  primary: TimelineItem | null
  // When the current item, or the free time before the next item today, ends.
  endsAt: string | null
  minutesLeft: number | null
  progress: number | null
  context: NowContext | null
  next: NextUp | null
  action: NowAction | null
}

export interface NowStateInput {
  items: TimelineItem[]
  upcoming: UpcomingItem[]
  actuals: BlockActual[]
  since: number | undefined
  now: Date
  today: string
  timeZone: string
  closeDayOpen: boolean
}

export function buildNowState({ items, upcoming, actuals, since, now, today, timeZone, closeDayOpen }: NowStateInput): NowState {
  const selection = selectNow(items, now)
  const { primary, others } = selection
  const continues = primary !== null && others.some((item) => Date.parse(item.end) > Date.parse(primary.end))
  const next = nextUp({ primaryEnd: primary?.end, continues, upcoming, now, today, timeZone })
  const action = nowAction({ selection, items, actuals, since, now, today, timeZone, closeDayOpen })
  const instant = now.getTime()
  if (primary) {
    const length = Date.parse(primary.end) - Date.parse(primary.start)
    return {
      key: primary.key, primary, endsAt: primary.end, minutesLeft: Math.ceil((Date.parse(primary.end) - instant) / 60_000),
      progress: (instant - Date.parse(primary.start)) / length, context: nowContext(selection), next, action,
    }
  }
  // Free time names its end only when the next item starts today; otherwise "Después" names the day.
  const freeEnd = next?.kind === 'item' && localDateOf(next.start, timeZone) === today ? next.start : null
  return {
    key: FREE_KEY, primary: null, endsAt: freeEnd, minutesLeft: freeEnd ? Math.ceil((Date.parse(freeEnd) - instant) / 60_000) : null,
    progress: null, context: null, next, action,
  }
}
