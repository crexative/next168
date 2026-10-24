import { describe, expect, it } from 'vitest'
import { nextUp } from './nextUp'
import type { TimelineItem } from './todayTimeline'

const NOW = new Date('2026-10-21T10:15:00Z')
const task = (start: string): TimelineItem => ({ kind: 'task', key: `task@${start}`, title: 'Write report', start, end: '2026-10-21T12:00:00.000Z', conflict: false, taskId: 't', categoryId: 'work', late: false })
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
})
