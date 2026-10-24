import { describe, expect, it } from 'vitest'
import { nextUp } from './nextUp'
import type { TimelineItem } from './todayTimeline'

const NOW = new Date('2026-10-21T10:15:00Z')
const task = (start: string): TimelineItem => ({ kind: 'task', key: `task@${start}`, title: 'Write report', start, end: '2026-10-21T12:00:00.000Z', overlapsWith: [], taskId: 't', categoryId: 'work', late: false })
const block = { title: 'Gym', start: '2026-10-21T18:00:00.000Z' }

describe('nextUp', () => {
  it('puts a task that begins before the next block in "Después"', () => {
    expect(nextUp(block, [task('2026-10-21T10:30:00.000Z')], NOW)).toEqual({ title: 'Write report', start: '2026-10-21T10:30:00.000Z' })
  })

  it('keeps the block when it starts first or at the same time, and ignores tasks already started', () => {
    expect(nextUp(block, [task('2026-10-21T19:00:00.000Z')], NOW)).toBe(block)
    expect(nextUp(block, [task('2026-10-21T18:00:00.000Z')], NOW)).toBe(block)
    expect(nextUp(block, [task('2026-10-21T10:00:00.000Z')], NOW)).toBe(block)
  })

  it('offers a task when no block is left', () => {
    expect(nextUp(null, [task('2026-10-21T11:00:00.000Z')], NOW)?.title).toBe('Write report')
    expect(nextUp(null, [], NOW)).toBeNull()
  })

  it('ignores blocks and events in the timeline: only a placed task can come before the next block', () => {
    const occurrence = { blockId: 'b', categoryId: 'work', title: 'Review', date: '2026-10-21', start: '2026-10-21T10:30:00.000Z', end: '2026-10-21T11:00:00.000Z', plannedMinutes: 30 }
    const items: TimelineItem[] = [
      { kind: 'block', key: 'block:b', title: 'Review', start: occurrence.start, end: occurrence.end, overlapsWith: [], categoryId: 'work', occurrence },
      { kind: 'event', key: 'event:e', title: 'Dentist', start: '2026-10-21T10:45:00.000Z', end: '2026-10-21T11:15:00.000Z', overlapsWith: [] },
    ]
    expect(nextUp(block, items, NOW)).toBe(block)
  })
})
