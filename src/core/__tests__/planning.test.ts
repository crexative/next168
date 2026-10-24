import { describe, expect, it } from 'vitest'
import { goalStatus, plannedMinutesByCategory, planVsActual, sevenDayMeasures, computeStats } from '../stats'
import { currentAndNext } from '../now'
import { scheduleTasks } from '../scheduler'
import { block, category, document, now } from './fixtures'
import type { Task } from '../model'

const task = (id: string, changes: Partial<Task> = {}): Task => ({ id, title: id, categoryId: 'work', durationMin: 60, priority: 2, createdAt: '2026-10-01T00:00:00Z', ...changes })
describe('stats', () => {
  it('counts overnight repeats once per day and computes 168-hour unassigned time', () => {
    const doc = document(); doc.blocks = [{ ...block, days: [0, 1, 2, 3, 4, 5, 6] }]
    expect(plannedMinutesByCategory(doc)).toEqual({ work: 3360 })
    expect(computeStats(doc)).toMatchObject({ plannedMinutes: 3360, unassignedHours: 112, categories: [{ categoryId: 'work', plannedMinutes: 3360, goal: { kind: 'over', minutes: 960 } }] })
    expect(computeStats(document()).unassignedHours).toBe(168)
  })
  it('evaluates min, max, equal and absent goals', () => {
    expect(goalStatus({ type: 'min', hoursPerWeek: 2 }, 60)).toEqual({ kind: 'missing', minutes: 60 })
    expect(goalStatus({ type: 'max', hoursPerWeek: 2 }, 180)).toEqual({ kind: 'over', minutes: 60 })
    expect(goalStatus({ type: 'min', hoursPerWeek: 2 }, 120)).toEqual({ kind: 'ok', minutes: 0 })
    expect(goalStatus({ type: 'max', hoursPerWeek: 2 }, 60)).toEqual({ kind: 'ok', minutes: 0 })
    expect(goalStatus({ type: 'none', hoursPerWeek: 0 }, 60)).toEqual({ kind: 'none', minutes: 0 })
  })
  it('uses immutable actual snapshots even after template and categories disappear', () => {
    const doc = document(); doc.categories = []
    doc.actuals = ['done', 'partial', 'skipped'].map((status, i) => ({ date: `2026-10-${20 + i}`, blockId: 'deleted', categoryId: 'deleted', plannedStartAt: `2026-10-${20 + i}T00:00:00Z`, plannedEndAt: `2026-10-${20 + i}T01:00:00Z`, plannedMinutes: 60, status: status as 'done' | 'partial' | 'skipped', actualMinutes: status === 'partial' ? 25 : undefined }))
    expect(planVsActual(doc.actuals)).toEqual({ deleted: { plannedMinutes: 180, actualMinutes: 85 } })
  })
  it('computes seven-day sleep, exercise, late work and stress without inventing missing days', () => {
    const checkIns = [
      { date: '2026-10-19', bedtime: 1380, wake: 420, exercise: 'yes' as const, workEnd: 1260, stress: 2 as const },
      { date: '2026-10-20', bedtime: 0, wake: 300, exercise: 'no' as const, workEnd: 240, stress: 5 as const },
      { date: '2026-10-21', bedtime: 60, wake: 450, exercise: 'not-planned' as const, workEnd: 1259, stress: 3 as const },
      { date: '2026-10-22', workEnd: 300 },
      { date: '2026-10-01', exercise: 'yes' as const, stress: 5 as const },
    ]
    const measures = sevenDayMeasures(checkIns, '2026-10-24', 3)
    expect(measures).toMatchObject({ averageSleepMinutes: 390, exerciseCount: 1, exerciseTarget: 3, lateWorkNights: 2, averageStress: 10 / 3 })
    expect(measures.days).toHaveLength(7)
    expect(measures.days[1]).toMatchObject({ date: '2026-10-19', sleep: 'good', exercise: 'good', lateWork: 'bad', stress: 'good' })
    expect(measures.days[2]).toMatchObject({ sleep: 'bad', exercise: 'bad', lateWork: 'bad', stress: 'bad' })
    expect(measures.days[3]).toMatchObject({ sleep: 'amber', exercise: 'amber', lateWork: 'good', stress: 'amber' })
    expect(sevenDayMeasures([], '2026-10-24', 0)).toMatchObject({ averageSleepMinutes: null, averageStress: null, exerciseCount: 0 })
  })
})
describe('sleep display bands', () => {
  // good 7–9 h, amber 6–10 h, otherwise bad; edges are inclusive.
  it.each([
    [359, 'bad'], [360, 'amber'], [419, 'amber'], [420, 'good'], [540, 'good'], [541, 'amber'], [600, 'amber'], [601, 'bad'],
  ] as const)('%i minutes of sleep is %s', (minutes, state) => {
    const wake = 7 * 60
    const bedtime = (wake - minutes + 1440) % 1440
    const measures = sevenDayMeasures([{ date: '2026-10-24', bedtime, wake }], '2026-10-24', 0)
    expect(measures.days.find((day) => day.date === '2026-10-24')).toMatchObject({ sleep: state })
  })
})
describe('current and next', () => {
  it('finds the current overnight occurrence and tomorrow first with real progress', () => {
    const doc = document(); doc.blocks = [block, { ...block, id: 'tomorrow', days: [0], start: 600, end: 660 }]
    expect(currentAndNext(doc, new Date('2026-10-25T07:00:00Z'), 'America/Bogota')).toMatchObject({ current: { blockId: 'block', minutesLeft: 240, progress: 0.5 }, next: { blockId: 'tomorrow' } })
    expect(currentAndNext(doc, now, 'America/Bogota')).toMatchObject({ current: null, next: { blockId: 'block' } })
    expect(currentAndNext(document(), now, 'America/Bogota')).toEqual({ current: null, next: null })
  })
  it('uses exclusive end boundaries and finds a same-day block next week', () => {
    const doc = document(); doc.blocks = [{ ...block, start: 360, end: 420 }]
    const result = currentAndNext(doc, now, 'America/Bogota')
    expect(result.current).toBeNull()
    expect(result.next?.date).toBe('2026-10-31')
  })
})
describe('deterministic task fitting', () => {
  it('subtracts busy, planner events, past time and already placed tasks', () => {
    const doc = document(); doc.blocks = [{ ...block, start: 360, end: 600 }]
    doc.events = [{ id: 'meeting', title: 'Meeting', start: '2026-10-24T13:00:00Z', end: '2026-10-24T13:30:00Z', allDay: false, attendees: [] }]
    doc.tasks = [task('later'), task('first', { durationMin: 90, dueDate: '2026-10-24' }), task('done', { doneAt: now.toISOString() })]
    const result = scheduleTasks({ document: doc, busy: [{ start: '2026-10-24T12:30:00Z', end: '2026-10-24T12:45:00Z' }], now, timeZone: 'America/Bogota' })
    expect(result).toEqual([
      { taskId: 'first', chunks: [{ start: '2026-10-24T12:00:00.000Z', end: '2026-10-24T12:30:00.000Z' }, { start: '2026-10-24T12:45:00.000Z', end: '2026-10-24T13:00:00.000Z' }, { start: '2026-10-24T13:30:00.000Z', end: '2026-10-24T14:15:00.000Z' }], overflowMinutes: 0, late: false },
      { taskId: 'later', chunks: [{ start: '2026-10-24T14:15:00.000Z', end: '2026-10-24T15:00:00.000Z' }], overflowMinutes: 15, late: false },
    ])
    expect(scheduleTasks({ document: doc, busy: [], now, timeZone: 'America/Bogota' })).toEqual(scheduleTasks({ document: doc, busy: [], now, timeZone: 'America/Bogota' }))
  })
  it('merges overlapping windows, rejects sub-ten-minute chunks and flags late', () => {
    const doc = document(); doc.blocks = [{ ...block, start: 415, end: 440 }, { ...block, id: 'overlap', start: 430, end: 465 }]
    doc.tasks = [task('low', { durationMin: 15, priority: 3, dueDate: '2026-10-23' }), task('high', { durationMin: 30, priority: 1, dueDate: '2026-10-23' })]
    const result = scheduleTasks({ document: doc, busy: [{ start: '2026-10-24T12:08:00Z', end: '2026-10-24T12:15:00Z' }], now, timeZone: 'America/Bogota', days: 1 })
    expect(result[0]).toMatchObject({ taskId: 'high', overflowMinutes: 0, late: true, chunks: [{ start: '2026-10-24T12:15:00.000Z', end: '2026-10-24T12:45:00.000Z' }] })
    expect(result[1]).toEqual({ taskId: 'low', chunks: [], overflowMinutes: 15, late: true })
  })
  it('uses zoned DST elapsed capacity and overnight due boundaries', () => {
    const doc = document(); doc.blocks = [{ ...block, days: [0], start: 60, end: 240 }]; doc.tasks = [task('dst', { durationMin: 180 })]
    const result = scheduleTasks({ document: doc, busy: [], now: new Date('2026-03-29T00:00:00Z'), timeZone: 'Europe/Berlin', days: 1 })
    expect(result[0]).toMatchObject({ overflowMinutes: 60, chunks: [{ start: '2026-03-29T00:00:00.000Z', end: '2026-03-29T02:00:00.000Z' }] })
    doc.blocks = [block]; doc.tasks = [task('night', { dueDate: '2026-10-24' })]
    expect(scheduleTasks({ document: doc, busy: [], now: new Date('2026-10-25T04:30:00Z'), timeZone: 'America/Bogota' })[0]?.late).toBe(true)
  })
  it('shares capacity across categories and keeps stable id ordering for ties', () => {
    const doc = document(); doc.categories.push({ ...category, id: 'other' }); doc.blocks = [{ ...block, start: 420, end: 480 }, { ...block, id: 'other', categoryId: 'other', start: 420, end: 480 }]
    doc.tasks = [task('b', { categoryId: 'other' }), task('a')]
    expect(scheduleTasks({ document: doc, busy: [], now, timeZone: 'America/Bogota' })).toMatchObject([{ taskId: 'a', overflowMinutes: 0 }, { taskId: 'b', overflowMinutes: 60 }])
  })
})
