// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlannerDocument, TaskPlacement } from './model'
import { fitTasks, movedOnFromToday, PLACEMENT_STEP_MINUTES, scheduleStable as scheduleOnGrid, type StableScheduleInput } from './scheduling'
import { scheduleTasks } from './scheduler'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const
// The grid mechanics are exercised on a 15-minute step (any step works the same); the app's step is five minutes.
const scheduleStable = (input: StableScheduleInput) => scheduleOnGrid({ snapMinutes: 15, ...input })

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
  it('snaps block starts without changing minute-exact scheduler callers', () => {
    const input = { document: planner([{ ...morning[0]!, start: 545 }]), busy: [], now: at('08:00'), timeZone: 'UTC' }
    expect(start(scheduleTasks(input))).toBe('09:05')
    expect(start(scheduleStable(input))).toBe('09:15')
    expect(start(scheduleStable({ ...input, snapMinutes: 30 }))).toBe('09:30')
  })

  it('snaps starts after newly placed tasks without rounding their durations', () => {
    const document = planner(morning, 20)
    document.tasks.push({ ...document.tasks[0]!, id: 'second', durationMin: 35 })
    const placements = scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' })
    expect(placements.map((item) => item.chunks)).toEqual([
      [{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:20:00.000Z' }],
      [{ start: '2026-10-21T09:30:00.000Z', end: '2026-10-21T10:05:00.000Z' }],
    ])
  })

  it('snaps every split chunk after events and busy intervals', () => {
    const document = planner([{ ...morning[0]!, start: 545 }], 90)
    document.events.push({ id: 'e', title: 'Meeting', start: '2026-10-21T09:40:00Z', end: '2026-10-21T10:07:00Z', allDay: false, attendees: [] })
    const busy = [{ start: '2026-10-21T10:40:00Z', end: '2026-10-21T11:07:00Z' }]
    const [placement] = scheduleStable({ document, busy, now: at('09:07'), timeZone: 'UTC' })
    expect(placement!.chunks).toEqual([
      { start: '2026-10-21T09:15:00.000Z', end: '2026-10-21T09:40:00.000Z' },
      { start: '2026-10-21T10:15:00.000Z', end: '2026-10-21T10:40:00.000Z' },
      { start: '2026-10-21T11:15:00.000Z', end: '2026-10-21T11:55:00.000Z' },
    ])
    expect(placement!.overflowMinutes).toBe(0)
  })

  it.each([
    { name: 'cross-midnight block', blockStart: 1435, blockEnd: 65, now: '2026-10-21T22:00:00Z', zone: 'UTC', expectedStart: '2026-10-22T00:00:00.000Z', expectedEnd: '2026-10-22T01:00:00.000Z' },
    { name: 'spring DST gap', blockStart: 115, blockEnd: 245, now: '2026-03-08T05:00:00Z', zone: 'America/New_York', expectedStart: '2026-03-08T07:00:00.000Z', expectedEnd: '2026-03-08T08:00:00.000Z' },
    { name: 'autumn DST fold', blockStart: 115, blockEnd: 185, now: '2026-11-01T04:00:00Z', zone: 'America/New_York', expectedStart: '2026-11-01T06:00:00.000Z', expectedEnd: '2026-11-01T07:00:00.000Z' },
  ])('snaps actual instants within a $name', ({ blockStart, blockEnd, now, zone, expectedStart, expectedEnd }) => {
    const document = planner([{ ...morning[0]!, start: blockStart, end: blockEnd }])
    const [placement] = scheduleStable({ document, busy: [], now: new Date(now), timeZone: zone, days: 2 })
    expect(placement!.chunks).toEqual([{ start: expectedStart, end: expectedEnd }])
    expect(placement!.overflowMinutes).toBe(0)
  })

  it('reports no fit for a block shorter than a grid step', () => {
    const document = planner([{ ...morning[0]!, start: 545, end: 555 }], 10)
    const [placement] = scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([])
    expect(placement!.overflowMinutes).toBe(10)
  })

  it('keeps a minute-exact block end and reports the minutes lost to snapping', () => {
    const document = planner([{ ...morning[0]!, start: 545, end: 607 }], 60)
    const [placement] = scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([{ start: '2026-10-21T09:15:00.000Z', end: '2026-10-21T10:07:00.000Z' }])
    expect(placement!.overflowMinutes).toBe(8)
  })

  it('moves a chunk that cannot fit after snapping to the next block', () => {
    const document = planner([{ ...morning[0]!, start: 545, end: 563 }, { ...morning[0]!, id: 'later', start: 660, end: 720 }], 15)
    const [placement] = scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([{ start: '2026-10-21T11:00:00.000Z', end: '2026-10-21T11:15:00.000Z' }])
    expect(placement!.overflowMinutes).toBe(0)
  })

  it('does not extend a one-day horizon when now rounds across midnight', () => {
    const document = planner([{ ...morning[0]!, start: 1425, end: 1439 }], 10)
    const [placement] = scheduleStable({ document, busy: [], now: new Date('2026-10-21T23:59:01Z'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([])
    expect(placement!.overflowMinutes).toBe(10)
  })

  it('reserves the grid gap after a kept task without changing its duration', () => {
    const document = planner(morning, 20)
    const previous = byId(scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' }))
    document.tasks.push({ ...document.tasks[0]!, id: 'second', durationMin: 30 })
    const placements = scheduleStable({ document, busy: [], now: at('09:07'), timeZone: 'UTC', previous })
    expect(placements[0]).toEqual(previous.get('report'))
    expect(placements[1]!.chunks).toEqual([{ start: '2026-10-21T09:30:00.000Z', end: '2026-10-21T10:00:00.000Z' }])
  })

  it('replaces a remembered off-grid placement', () => {
    const document = planner([{ ...morning[0]!, start: 545 }])
    const input = { document, busy: [], now: at('08:00'), timeZone: 'UTC' }
    const previous = byId(scheduleTasks(input))
    expect(start(scheduleStable({ ...input, previous }))).toBe('09:15')
  })

  it('applies block lead-ins only to their category and merges overlapping windows', () => {
    const document = planner([
      ...morning,
      { ...morning[0]!, id: 'nested', start: 545, end: 605 },
      { ...morning[0]!, id: 'other', categoryId: 'other', start: 545, end: 605 },
    ])
    expect(scheduleStable({ document, busy: [], now: at('08:00'), timeZone: 'UTC' })[0]!.chunks)
      .toEqual([{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T10:00:00.000Z' }])
  })

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

describe('a task with no category fits any free time', () => {
  const anytime = (document: PlannerDocument, durationMin = 60) => {
    const task = { ...document.tasks[0]!, id: 'gift', title: 'Gift', durationMin }
    delete (task as { categoryId?: string }).categoryId
    return { ...document, tasks: [task] }
  }
  const work = [{ id: 'job', categoryId: 'work', title: 'Job', days: [...EVERY_DAY], start: 540, end: 1020 }]

  it('goes before a routine block, never inside it, whatever the block category is', () => {
    const document = anytime(planner(work), 120)
    const [placement] = scheduleTasks({ document, busy: [], now: at('06:00'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([{ start: '2026-10-21T06:00:00.000Z', end: '2026-10-21T08:00:00.000Z' }])
    // A task of another category reaches the very same time only through its own blocks.
    expect(scheduleTasks({ document: { ...document, tasks: [{ ...document.tasks[0]!, categoryId: 'work' }] }, busy: [], now: at('06:00'), timeZone: 'UTC', days: 1 })[0]!.chunks[0]!.start).toBe('2026-10-21T09:00:00.000Z')
  })

  it('treats the block end as free (half-open ranges) and splits around the block', () => {
    const document = anytime(planner(work), 180)
    const [placement] = scheduleTasks({ document, busy: [], now: at('07:00'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([
      { start: '2026-10-21T07:00:00.000Z', end: '2026-10-21T09:00:00.000Z' },
      { start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T18:00:00.000Z' },
    ])
    expect(placement!.overflowMinutes).toBe(0)
  })

  it('keeps out of a block that started yesterday and runs past midnight, and of a calendar event', () => {
    const sleep = [{ id: 'night', categoryId: 'work', title: 'Night', days: [...EVERY_DAY], start: 1320, end: 360 }]
    const document = anytime(planner(sleep), 60)
    const busy = [{ start: '2026-10-21T06:00:00.000Z', end: '2026-10-21T07:00:00.000Z' }]
    const [placement] = scheduleTasks({ document, busy, now: at('00:30'), timeZone: 'UTC', days: 1 })
    expect(placement!.chunks).toEqual([{ start: '2026-10-21T07:00:00.000Z', end: '2026-10-21T08:00:00.000Z' }])
  })

  it('reports the missing minutes when no moment of the horizon is free', () => {
    const allDay = [{ id: 'all', categoryId: 'work', title: 'All', days: [...EVERY_DAY], start: 0, end: 1 }, { id: 'rest', categoryId: 'work', title: 'Rest', days: [...EVERY_DAY], start: 1, end: 0 }]
    const [placement] = scheduleTasks({ document: anytime(planner(allDay), 60), busy: [], now: at('08:00'), timeZone: 'UTC', days: 1 })
    expect(placement).toMatchObject({ chunks: [], overflowMinutes: 60 })
  })

  it('is placed on the 15-minute grid by the stable scheduler, in the same free time, and kept while valid', () => {
    const document = anytime(planner(work), 60)
    const first = scheduleStable({ document, busy: [], now: at('06:07'), timeZone: 'UTC', days: 1 })
    expect(first[0]!.chunks).toEqual([{ start: '2026-10-21T06:15:00.000Z', end: '2026-10-21T07:15:00.000Z' }])
    const later = scheduleStable({ document, busy: [], now: at('06:20'), timeZone: 'UTC', days: 1, previous: byId(first) })
    expect(later[0]).toEqual(first[0])
    // The kept placement stops being valid once a block would cover it.
    const covered = { ...document, blocks: [{ ...work[0]!, start: 360, end: 480 }] }
    expect(scheduleStable({ document: covered, busy: [], now: at('06:20'), timeZone: 'UTC', days: 1, previous: byId(first) })[0]!.chunks[0]!.start).toBe('2026-10-21T08:00:00.000Z')
  })

  it('finds the free hour either side of the spring-forward gap', () => {
    const document = anytime(planner([{ id: 'early', categoryId: 'work', title: 'Early', days: [...EVERY_DAY], start: 0, end: 120 }]), 60)
    // New York, 2026-03-08: 02:00 does not exist, 03:00 EDT = 07:00Z; the block ends at the gap.
    const [placement] = scheduleTasks({ document, busy: [], now: new Date('2026-03-08T05:00:00Z'), timeZone: 'America/New_York', days: 1 })
    expect(placement!.chunks[0]!.start).toBe('2026-03-08T07:00:00.000Z')
  })
})

describe('fitTasks: the one placement every screen uses', () => {
  const document = planner([{ id: 'b', categoryId: 'work', title: 'Deep work', days: [...EVERY_DAY], start: 540, end: 720 }])
  const at = (time: string) => new Date(`2026-10-21T${time}:00Z`)
  const start = (placements: TaskPlacement[]) => placements[0]!.chunks[0]!.start.slice(11, 16)

  it('steps by five minutes', () => {
    expect(PLACEMENT_STEP_MINUTES).toBe(5)
  })

  it('starts a re-fitted task on the next five minutes from now, not at the exact minute', () => {
    expect(start(fitTasks({ document, busy: [], now: at('09:31'), timeZone: 'UTC' }))).toBe('09:35')
    expect(start(fitTasks({ document, busy: [], now: at('09:35'), timeZone: 'UTC' }))).toBe('09:35')
    expect(start(scheduleTasks({ document, busy: [], now: at('09:31'), timeZone: 'UTC' }))).toBe('09:31')
  })

  it('keeps a placement that is under way until it really ends, even within the last five minutes', () => {
    const [first] = fitTasks({ document, busy: [], now: at('09:07'), timeZone: 'UTC' })
    const later = fitTasks({ document, busy: [], now: new Date('2026-10-21T10:06:30Z'), timeZone: 'UTC', previous: new Map([[first!.taskId, first!]]) })
    expect(later[0]!.chunks[0]!.start).toBe(first!.chunks[0]!.start)
  })

  it('starts after a busy slot on the five-minute grid too', () => {
    const busy = [{ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T09:47:00.000Z' }]
    expect(start(fitTasks({ document, busy, now: at('08:00'), timeZone: 'UTC' }))).toBe('09:50')
  })
})
