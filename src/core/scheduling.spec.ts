// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlannerDocument, TaskPlacement } from './model'
import { movedOnFromToday, scheduleStable } from './scheduling'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const

function planner(blocks: PlannerDocument['blocks'], durationMin = 60): PlannerDocument {
  return {
    schemaVersion: 2, workspaceId: 'w', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
    blocks,
    tasks: [{ id: 'report', title: 'Report', categoryId: 'work', durationMin, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
    checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
  }
}
const morning = [{ id: 'b', categoryId: 'work', title: 'Deep work', days: [...EVERY_DAY], start: 540, end: 780 }]
const at = (time: string) => new Date(`2026-10-21T${time}:00Z`)
const byId = (placements: TaskPlacement[]) => new Map(placements.map((placement) => [placement.taskId, placement]))
const start = (placements: TaskPlacement[]) => placements[0]!.chunks[0]!.start.slice(11, 16)

describe('scheduleStable', () => {
  it('starts chunks on the 15-minute grid instead of at the exact minute', () => {
    expect(start(scheduleStable({ document: planner(morning), busy: [], now: at('10:07'), timeZone: 'UTC' }))).toBe('10:15')
    expect(start(scheduleStable({ document: planner(morning), busy: [], now: at('10:16'), timeZone: 'UTC' }))).toBe('10:30')
  })

  it('starts after a calendar event on the grid', () => {
    const busy = [{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:07:00.000Z' }]
    expect(start(scheduleStable({ document: planner(morning), busy, now: at('08:00'), timeZone: 'UTC' }))).toBe('10:15')
  })

  it('does not slide with the clock while the previous placement is still valid', () => {
    const document = planner(morning)
    const first = scheduleStable({ document, busy: [], now: at('10:07'), timeZone: 'UTC' })
    const drifting = scheduleStable({ document, busy: [], now: at('10:20'), timeZone: 'UTC' })
    const stable = scheduleStable({ document, busy: [], now: at('10:20'), timeZone: 'UTC', previous: byId(first) })
    expect(start(drifting)).toBe('10:30')
    expect(start(stable)).toBe('10:15')
  })

  it('recomputes once the previous placement has elapsed or an event now occupies it', () => {
    const document = planner(morning)
    const first = byId(scheduleStable({ document, busy: [], now: at('10:07'), timeZone: 'UTC' }))
    expect(start(scheduleStable({ document, busy: [], now: at('11:20'), timeZone: 'UTC', previous: first }))).toBe('11:30')
    const busy = [{ start: '2026-10-21T10:30:00.000Z', end: '2026-10-21T11:00:00.000Z' }]
    expect(start(scheduleStable({ document, busy, now: at('10:20'), timeZone: 'UTC', previous: first }))).toBe('11:00')
  })

  it('drops a previous placement when the task changed length', () => {
    const first = byId(scheduleStable({ document: planner(morning), busy: [], now: at('10:07'), timeZone: 'UTC' }))
    const longer = scheduleStable({ document: planner(morning, 90), busy: [], now: at('10:20'), timeZone: 'UTC', previous: first })
    expect(longer[0]!.chunks.map((chunk) => chunk.end.slice(11, 16))).toEqual(['12:00'])
    expect(start(longer)).toBe('10:30')
  })

  it('keeps a pinned placement for the rest of the day, even after its time has passed', () => {
    const short = [{ id: 'b', categoryId: 'work', title: 'Deep work', days: [...EVERY_DAY], start: 540, end: 600 }]
    const document = planner(short)
    const morningPlacement = byId(scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' }))
    expect(start([...morningPlacement.values()])).toBe('09:00')
    const late = at('10:05')
    expect(scheduleStable({ document, busy: [], now: late, timeZone: 'UTC', previous: morningPlacement })[0]!.chunks[0]!.start).toContain('2026-10-22')
    expect(scheduleStable({ document, busy: [], now: late, timeZone: 'UTC', pinned: morningPlacement })[0]!.chunks[0]!.start).toBe('2026-10-21T09:00:00.000Z')
    expect(scheduleStable({ document, busy: [], now: new Date('2026-10-22T08:00:00Z'), timeZone: 'UTC', pinned: morningPlacement })[0]!.chunks[0]!.start).toBe('2026-10-22T09:00:00.000Z')
  })
})

describe('movedOnFromToday', () => {
  const short = [{ id: 'b', categoryId: 'work', title: 'Deep work', days: [...EVERY_DAY], start: 540, end: 600 }]
  const document = planner(short)

  it('reports a task set for today that now starts on a later day', () => {
    const before = byId(scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' }))
    const after = scheduleStable({ document, busy: [], now: at('10:05'), timeZone: 'UTC', previous: before })
    expect(movedOnFromToday(before, after, '2026-10-21', 'UTC')).toEqual([{ taskId: 'report', from: '2026-10-21', to: '2026-10-22' }])
  })

  it('stays quiet while the task keeps its day, or came from an earlier day', () => {
    const before = byId(scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' }))
    const same = scheduleStable({ document, busy: [], now: at('09:30'), timeZone: 'UTC', previous: before })
    expect(movedOnFromToday(before, same, '2026-10-21', 'UTC')).toEqual([])
    expect(movedOnFromToday(before, same, '2026-10-22', 'UTC')).toEqual([])
  })
})
