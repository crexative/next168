import { describe, expect, it } from 'vitest'
import { scheduleTasks } from '@/core/scheduler'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { buildTimeline, liveOverlapTitles } from './todayTimeline'

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

  it('names what a block shares time with while the pair is current or upcoming, never on events or placed tasks', () => {
    const during = new Date('2026-10-21T10:45:00Z')
    const overlaps = (title: string, now = during) => items.filter((item) => item.title === title).map((item) => liveOverlapTitles(item, items, now))
    expect(overlaps('Deep work')).toEqual([['Client call']])
    expect(overlaps('Client call')).toEqual([[]])
    expect(overlaps('Gym class')).toEqual([[]])
    expect(overlaps('Write report')).toEqual([[]])
    // Last night's tail of Sleep overlaps nothing; tonight's Sleep overlaps the evening class, which names it only on Sleep.
    expect(overlaps('Sleep')).toEqual([[], ['Gym class']])
    expect(items.find((item) => item.kind === 'task')).toMatchObject({ start: '2026-10-21T09:00:00.000Z' })
  })

  it('stops naming a pair once the overlap itself is over', () => {
    const deepWorkRow = items.find((item) => item.title === 'Deep work')!
    expect(liveOverlapTitles(deepWorkRow, items, new Date('2026-10-21T10:59:00Z'))).toEqual(['Client call'])
    expect(liveOverlapTitles(deepWorkRow, items, new Date('2026-10-21T11:00:00Z'))).toEqual([])
    expect(liveOverlapTitles(deepWorkRow, items, new Date('2026-10-21T12:00:00Z'))).toEqual([])
  })

  it('lists each overlapping title once, however many times it overlaps', () => {
    const twice = plannerDocument({
      blocks: [deepWork],
      events: [
        { id: 'a', title: 'Standup', start: '2026-10-21T09:00:00Z', end: '2026-10-21T09:15:00Z', allDay: false, attendees: [] },
        { id: 'b', title: 'Standup', start: '2026-10-21T10:00:00Z', end: '2026-10-21T10:15:00Z', allDay: false, attendees: [] },
      ],
    })
    const built = buildTimeline({ document: twice, today: '2026-10-21', timeZone: 'UTC', placements: [], external: [] })
    expect(liveOverlapTitles(built.items.find((item) => item.title === 'Deep work')!, built.items, new Date('2026-10-21T08:00:00Z'))).toEqual(['Standup'])
  })
})
