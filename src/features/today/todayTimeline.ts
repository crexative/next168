import type { ExternalOccurrence, PlannerDocument, TaskPlacement } from '@/core/model'
import { addLocalDays, datedOccurrences, zonedInstant, type DatedOccurrence } from '@/core/time'
import { chunkIsLate } from '@/core/scheduling'

interface TimelineBase { key: string; title: string; start: string; end: string }
export type TimelineItem =
  | TimelineBase & { kind: 'block'; occurrence: DatedOccurrence; categoryId: string }
  | TimelineBase & { kind: 'task'; taskId: string; categoryId: string; late: boolean }
  // `sourceName` is the calendar a Google or file event comes from; Weeklid's own events have none.
  | TimelineBase & { kind: 'event' | 'external'; sourceName?: string }

export interface AllDayItem { key: string; title: string; kind: 'event' | 'external' }

export interface TimelineInput {
  document: PlannerDocument
  today: string
  timeZone: string
  external: ExternalOccurrence[]
  placements: TaskPlacement[]
}

const intersects = (start: string, end: string, from: number, to: number) => Date.parse(start) < to && Date.parse(end) > from

// What a routine block still shares time with, as titles: events and other blocks whose overlap has not ended yet.
// The notice belongs to the block (the routine that gives way), only while the pair is current or upcoming, and
// never to events or placed tasks (the scheduler puts task chunks inside free block time).
export function liveOverlapTitles(item: TimelineItem, items: TimelineItem[], now: Date): string[] {
  if (item.kind !== 'block') return []
  const titles: string[] = []
  for (const other of items) {
    if (other.key === item.key || other.kind === 'task') continue
    const overlapEnd = Math.min(Date.parse(item.end), Date.parse(other.end))
    const overlapStart = Math.max(Date.parse(item.start), Date.parse(other.start))
    if (overlapStart < overlapEnd && overlapEnd > now.getTime() && !titles.includes(other.title)) titles.push(other.title)
  }
  return titles
}

export function buildTimeline({ document, today, timeZone, external, placements }: TimelineInput): { items: TimelineItem[]; allDay: AllDayItem[] } {
  const from = zonedInstant(today, 0, timeZone).getTime()
  const to = zonedInstant(addLocalDays(today, 1), 0, timeZone).getTime()
  const tasks = new Map(document.tasks.map((task) => [task.id, task]))
  const sourceNames = new Map(document.calendarSources.map((source) => [source.id, source.name]))
  const items: TimelineItem[] = [
    ...datedOccurrences(document, today, 1, timeZone).map((occurrence): TimelineItem => ({
      kind: 'block', key: `block:${occurrence.blockId}@${occurrence.start}`, title: occurrence.title,
      start: occurrence.start, end: occurrence.end, occurrence, categoryId: occurrence.categoryId,
    })),
    ...placements.flatMap((placement) => {
      const task = tasks.get(placement.taskId)
      if (!task) return []
      return placement.chunks.filter((chunk) => intersects(chunk.start, chunk.end, from, to)).map((chunk): TimelineItem => ({
        kind: 'task', key: `task:${task.id}@${chunk.start}`, title: task.title, start: chunk.start, end: chunk.end,
        taskId: task.id, categoryId: task.categoryId ?? '', late: chunkIsLate(task, chunk, timeZone),
      }))
    }),
    ...document.events.filter((event) => !event.allDay && intersects(event.start, event.end, from, to)).map((event): TimelineItem => ({
      kind: 'event', key: `event:${event.id}`, title: event.title, start: event.start, end: event.end,
    })),
    ...external.filter((item) => item.busy && !item.allDay && intersects(item.start, item.end, from, to)).map((item): TimelineItem => ({
      kind: 'external', key: `external:${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, start: item.start, end: item.end,
      sourceName: sourceNames.get(item.sourceId),
    })),
  ]
  const allDay: AllDayItem[] = [
    ...document.events.filter((event) => event.allDay && event.start.slice(0, 10) <= today && today < event.end.slice(0, 10))
      .map((event) => ({ key: `event:${event.id}`, title: event.title, kind: 'event' as const })),
    ...external.filter((item) => item.allDay && item.start.slice(0, 10) <= today && today < item.end.slice(0, 10))
      .map((item) => ({ key: `external:${item.sourceId}/${item.uid}/${item.recurrenceId ?? ''}`, title: item.title, kind: 'external' as const })),
  ]
  const sorted = items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(b.end) - Date.parse(a.end) || a.key.localeCompare(b.key))
  return { items: sorted, allDay }
}
