import { describe, expect, it } from 'vitest'
import { scheduleTasks } from '@/core/scheduler'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { buildTimeline } from './todayTimeline'

const document = plannerDocument({
  blocks: [deepWork, sleep],
  tasks: [{ id: 't', title: 'Write report', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z' }],
  events: [
    { id: 'meet', title: 'Client call', start: '2026-10-21T10:30:00Z', end: '2026-10-21T11:30:00Z', allDay: false, attendees: [] },
  ],
})

describe('today timeline', () => {
  const now = new Date('2026-10-21T08:00:00Z')
  const placements = scheduleTasks({ document, busy: [], now, timeZone: 'UTC' })
  const { items, allDay } = buildTimeline({
    document, today: '2026-10-21', timeZone: 'UTC', placements,
    external: [
      { sourceId: 'cal', uid: 'x', title: 'Gym class', start: '2026-10-21T21:30:00Z', end: '2026-10-21T22:30:00Z', allDay: false, busy: true },
      { sourceId: 'cal', uid: 'y', title: 'Conference', start: '2026-10-21', end: '2026-10-22', allDay: true, busy: true },
    ],
  })

  it('orders occurrences, placed tasks and events by start, including last night', () => {
    expect(items.map((item) => [item.kind, item.title])).toEqual([
      ['block', 'Sleep'], ['block', 'Deep work'], ['task', 'Write report'], ['event', 'Client call'], ['external', 'Gym class'], ['block', 'Sleep'],
    ])
    expect(allDay).toEqual([{ key: 'external:cal/y/', title: 'Conference', kind: 'external' }])
  })

  it('marks overlapping blocks and events as conflicts but never placed tasks', () => {
    expect(items.filter((item) => item.conflict).map((item) => item.title)).toEqual(['Deep work', 'Client call', 'Gym class', 'Sleep'])
    expect(items.find((item) => item.kind === 'task')).toMatchObject({ conflict: false, start: '2026-10-21T09:00:00.000Z' })
  })
})
