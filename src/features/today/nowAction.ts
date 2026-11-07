import type { BlockActual } from '@/core/model'
import { localDateOf, type DatedOccurrence } from '@/core/time'
import { actualFor } from './actuals'
import type { NowSelection } from './nowSelection'
import { isAskable } from './planSince'
import { endedRecently, isReportable } from './statusWindow'
import type { TimelineItem } from './todayTimeline'

// The one thing the Now card offers to do: complete the task underway, say how a block went, or close the day.
export type NowAction =
  | { kind: 'task'; taskId: string; title: string }
  // `own` is false when the question is about a block other than the one the card shows, so it names the block.
  | { kind: 'ask'; occurrence: DatedOccurrence; actual: BlockActual | undefined; own: boolean }
  | { kind: 'closeDay' }

type BlockItem = TimelineItem & { kind: 'block' }
const isBlock = (item: TimelineItem | null | undefined): item is BlockItem => item?.kind === 'block'

interface ActionInput {
  selection: NowSelection
  items: TimelineItem[]
  actuals: BlockActual[]
  since: number | undefined
  now: Date
  today: string
  timeZone: string
  closeDayOpen: boolean
}

export function nowAction({ selection, items, actuals, since, now, today, timeZone, closeDayOpen }: ActionInput): NowAction | null {
  const { primary, others } = selection
  if (primary?.kind === 'task') return { kind: 'task', taskId: primary.taskId, title: primary.title }
  const answered = (item: BlockItem) => actualFor(actuals, item.occurrence)
  const ask = (item: BlockItem): NowAction => ({ kind: 'ask', occurrence: item.occurrence, actual: answered(item), own: item.key === primary?.key })

  // A block in its last minutes, or already answered, asks even when an event is what the card shows.
  const underway = [primary, ...others].find((item): item is BlockItem =>
    isBlock(item) && isAskable(item.start, since) && (isReportable(item, now) || answered(item) !== undefined))
  if (underway) return ask(underway)

  // With nothing current, the block that just ended is still asked about for a while. Last night's tail is not:
  // its question belongs to the day it began.
  if (!primary) {
    const ended = items
      .filter((item): item is BlockItem => isBlock(item) && localDateOf(item.start, timeZone) >= today && isAskable(item.start, since) && endedRecently(item, now) && !answered(item))
      .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0]
    if (ended) return ask(ended)
  }
  // In free time the slot stays empty (the check-in card below carries the way in); with something current, the link does.
  return closeDayOpen && primary ? { kind: 'closeDay' } : null
}
