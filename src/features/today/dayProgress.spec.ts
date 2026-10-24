import { describe, expect, it } from 'vitest'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { recordActual } from './actuals'
import { dayProgress } from './dayProgress'
import { buildTimeline } from './todayTimeline'
import { datedOccurrences } from '@/core/time'

const TODAY = '2026-10-21'
const EARLY = Date.parse('2026-10-20T00:00:00Z')

function build(document = plannerDocument({ blocks: [deepWork, sleep] }), placements: Parameters<typeof buildTimeline>[0]['placements'] = []) {
  return { document, items: buildTimeline({ document, today: TODAY, timeZone: 'UTC', external: [], placements }).items }
}

describe('dayProgress', () => {
  it('counts blocks that start today, not the tail of last night’s sleep', () => {
    const { document, items } = build()
    expect(dayProgress(document, items, TODAY, EARLY)).toEqual({ done: 0, total: 2 })
  })

  it('counts a done block but not a partial or skipped one', () => {
    const { document, items } = build()
    const [, work, tonight] = datedOccurrences(document, TODAY, 1, 'UTC')
    recordActual(document, work!, 'done')
    recordActual(document, tonight!, 'partial', 30)
    expect(dayProgress(document, items, TODAY, EARLY)).toEqual({ done: 1, total: 2 })
  })

  it('leaves out blocks that started before the plan existed', () => {
    const { document, items } = build()
    expect(dayProgress(document, items, TODAY, Date.parse('2026-10-21T10:00:00Z'))).toEqual({ done: 0, total: 1 })
  })

  it('counts placed tasks once and tasks finished today as done', () => {
    const document = plannerDocument({
      blocks: [deepWork],
      tasks: [
        { id: 'a', title: 'A', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z' },
        { id: 'b', title: 'B', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z', doneAt: '2026-10-21T08:00:00.000Z' },
        { id: 'c', title: 'C', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z', doneAt: '2026-10-19T08:00:00.000Z' },
      ],
    })
    const chunks = [{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:15:00.000Z' }, { start: '2026-10-21T09:30:00.000Z', end: '2026-10-21T09:45:00.000Z' }]
    const { items } = build(document, [{ taskId: 'a', chunks, overflowMinutes: 0, late: false }])
    expect(dayProgress(document, items, TODAY, EARLY)).toEqual({ done: 1, total: 3 })
  })

  it('counts a task that is still placed once, as open, even if it carries a finish time', () => {
    const document = plannerDocument({
      blocks: [deepWork],
      tasks: [{ id: 'a', title: 'A', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z', doneAt: '2026-10-21T08:00:00.000Z' }],
    })
    const chunks = [{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:30:00.000Z' }]
    const { items } = build(document, [{ taskId: 'a', chunks, overflowMinutes: 0, late: false }])
    expect(dayProgress(document, items, TODAY, EARLY)).toEqual({ done: 0, total: 2 })
  })
})
