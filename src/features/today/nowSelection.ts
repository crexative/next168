import type { TimelineItem } from './todayTimeline'

// A timed event longer than this is a trip or a conference day, not a meeting: it does not outrank the task or
// routine the person is actually doing (docs/design/today-screen.md §5.1, D7).
export const LONG_EVENT_HOURS = 4

const isEvent = (item: TimelineItem) => item.kind === 'event' || item.kind === 'external'
const duration = (item: TimelineItem) => Date.parse(item.end) - Date.parse(item.start)
const isLongEvent = (item: TimelineItem) => isEvent(item) && duration(item) > LONG_EVENT_HOURS * 3_600_000

// Lower wins: a meeting with other people, then the specific task, then the routine, then a long event.
function rank(item: TimelineItem): number {
  if (isLongEvent(item)) return 3
  if (isEvent(item)) return 0
  return item.kind === 'task' ? 1 : 2
}

// Inside one rank the shorter item is the more specific commitment, then the later start, then the stable key.
function byPriority(a: TimelineItem, b: TimelineItem): number {
  return rank(a) - rank(b) || duration(a) - duration(b) || Date.parse(b.start) - Date.parse(a.start) || a.key.localeCompare(b.key)
}

export interface NowSelection {
  primary: TimelineItem | null
  // Everything else that spans now, the first being the one the context line names.
  others: TimelineItem[]
}

export function selectNow(items: TimelineItem[], now: Date): NowSelection {
  const instant = now.getTime()
  const spanning = items.filter((item) => Date.parse(item.start) <= instant && instant < Date.parse(item.end)).sort(byPriority)
  const [primary = null, ...rest] = spanning
  // An event runner-up outranks a routine one on the context line, whatever its length.
  const others = [...rest.filter(isEvent), ...rest.filter((item) => !isEvent(item))]
  return { primary, others }
}

export type NowContextKind = 'taskContext' | 'routineContext' | 'alsoNow'
export interface NowContext { kind: NowContextKind; title: string; end: string; more: number }

export function nowContext({ primary, others }: NowSelection): NowContext | null {
  const [runnerUp] = others
  if (!primary || !runnerUp) return null
  const kind: NowContextKind = runnerUp.kind !== 'block' ? 'alsoNow' : primary.kind === 'task' ? 'taskContext' : isEvent(primary) ? 'routineContext' : 'alsoNow'
  return { kind, title: runnerUp.title, end: runnerUp.end, more: others.length - 1 }
}
