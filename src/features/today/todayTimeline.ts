import type { ExternalOccurrence, PlannerDocument, TaskPlacement } from '@/core/model'
import { addLocalDays, datedOccurrences, zonedInstant, type DatedOccurrence } from '@/core/time'

interface TimelineBase { key: string; title: string; start: string; end: string; conflict: boolean }
export type TimelineItem =
  | TimelineBase & { kind: 'block'; occurrence: DatedOccurrence; categoryId: string }
  | TimelineBase & { kind: 'task'; taskId: string; categoryId: string; late: boolean }
  | TimelineBase & { kind: 'event' | 'external' }

export interface AllDayItem { key: string; title: string; kind: 'event' | 'external' }

export interface TimelineInput {
  document: PlannerDocument
  today: string
  timeZone: string
  external: ExternalOccurrence[]
  placements: TaskPlacement[]
}

const intersects = (start: string, end: string, from: number, to: number) => Date.parse(start) < to && Date.parse(end) > from

// Blocks, Next168 events and busy calendar events that overlap each other are conflicts.
// Task chunks are placed inside free block time by the scheduler, so they never count.
function markConflicts(items: TimelineItem[]): TimelineItem[] {
  const candidates = items.filter((item) => item.kind === 'block' || item.kind === 'event' || item.kind === 'external')
  const conflicting = new Set<string>()
  for (const [index, item] of candidates.entries()) {
    for (const other of candidates.slice(index + 1)) {
      if (Date.parse(item.start) < Date.parse(other.end) && Date.parse(other.start) < Date.parse(item.end)) {
        conflicting.add(item.key)
        conflicting.add(other.key)
      }
    }
  }
  return items.map((item) => ({ ...item, conflict: conflicting.has(item.key) }))
}

export function buildTimeline({ document, today, timeZone, external, placements }: TimelineInput): { items: TimelineItem[]; allDay: AllDayItem[] } {
  const from = zonedInstant(today, 0, timeZone).getTime()
  const to = zonedInstant(addLocalDays(today, 1), 0, timeZone).getTime()
  const tasks = new Map(document.tasks.map((task) => [task.id, task]))
  const items: TimelineItem[] = [
    ...datedOccurrences(document, today, 1, timeZone).map((occurrence): TimelineItem => ({
      kind: 'block', key: `block:${occurrence.blockId}@${occurrence.start}`, title: occurrence.title,
      start: occurrence.start, end: occurrence.end, conflict: false, occurrence, categoryId: occurrence.categoryId,
    })),
    ...placements.flatMap((placement) => {
      const task = tasks.get(placement.taskId)
      if (!task) return []
      return placement.chunks.filter((chunk) => intersects(chunk.start, chunk.end, from, to)).map((chunk): TimelineItem => ({
        kind: 'task', key: `task:${task.id}@${chunk.start}`, title: task.title, start: chunk.start, end: chunk.end,
        conflict: false, taskId: task.id, categoryId: task.categoryId, late: placement.late,
      }))
    }),
    ...document.events.filter((event) => !event.allDay && intersects(event.start, event.end, from, to)).map((event): TimelineItem => ({
      kind: 'event', key: `event:${event.id}`, title: event.title, start: event.start, end: event.end, conflict: false,
    })),
    ...external.filter((item) => item.busy && !item.allDay && intersects(item.start, item.end, from, to)).map((item): TimelineItem => ({
      kind: 'external', key: `external:${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, start: item.start, end: item.end, conflict: false,
    })),
  ]
  const allDay: AllDayItem[] = [
    ...document.events.filter((event) => event.allDay && event.start.slice(0, 10) <= today && today < event.end.slice(0, 10))
      .map((event) => ({ key: `event:${event.id}`, title: event.title, kind: 'event' as const })),
    ...external.filter((item) => item.allDay && item.start.slice(0, 10) <= today && today < item.end.slice(0, 10))
      .map((item) => ({ key: `external:${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, kind: 'external' as const })),
  ]
  const sorted = items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(b.end) - Date.parse(a.end) || a.key.localeCompare(b.key))
  return { items: markConflicts(sorted), allDay }
}
