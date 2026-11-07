import { nextTick } from 'vue'
import type { TimelineItem } from './todayTimeline'

// Synthetic Friday 2026-11-06 (UTC) items for the Now selection tests.
export const at = (time: string) => new Date(`2026-11-06T${time}:00.000Z`)
const iso = (time: string) => at(time).toISOString()

export function block(id: string, from: string, to: string, title = id): TimelineItem {
  const [start, end] = [iso(from), iso(to)]
  const plannedMinutes = (Date.parse(end) - Date.parse(start)) / 60_000
  return {
    kind: 'block', key: `block:${id}@${start}`, title, start, end, categoryId: 'work',
    occurrence: { blockId: id, categoryId: 'work', title, date: '2026-11-06', start, end, plannedMinutes },
  }
}

export function task(id: string, from: string, to: string, title = id): TimelineItem {
  return { kind: 'task', key: `task:${id}@${iso(from)}`, title, start: iso(from), end: iso(to), taskId: id, categoryId: 'work', late: false }
}

export function event(id: string, from: string, to: string, title = id, kind: 'event' | 'external' = 'event'): TimelineItem {
  return { kind, key: `${kind}:${id}`, title, start: iso(from), end: iso(to) }
}

// Opens the folded "Earlier" row of a mounted TodayTimeline.
export async function expandEarlier(host: HTMLElement): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-testid="timeline-earlier"]')?.click()
  await nextTick()
  await nextTick()
}
