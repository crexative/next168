import { beforeEach, describe, expect, it } from 'vitest'
import { plannerDocument } from '@/features/week/testDocument'
import { isAskable, planSince, readPlanSince, stampPlanSince } from './planSince'

beforeEach(() => window.localStorage.clear())

describe('planSince', () => {
  it('keeps the first moment a plan was seen and never moves it later', () => {
    expect(readPlanSince('ws')).toBeUndefined()
    expect(stampPlanSince('ws', new Date('2026-10-21T14:00:00Z'))).toBe(Date.parse('2026-10-21T14:00:00Z'))
    expect(stampPlanSince('ws', new Date('2026-10-22T09:00:00Z'))).toBe(Date.parse('2026-10-21T14:00:00Z'))
    expect(readPlanSince('other')).toBeUndefined()
  })

  it('goes back to older evidence of use: an actual, a check-in or a task', () => {
    const stamped = Date.parse('2026-10-21T14:00:00Z')
    expect(planSince(plannerDocument(), stamped)).toBe(stamped)
    const withCheckIn = plannerDocument({ checkIns: [{ date: '2026-10-19' }] })
    expect(planSince(withCheckIn, stamped)).toBe(Date.parse('2026-10-19T00:00:00Z'))
    const actual = { date: '2026-10-17', blockId: 'b', categoryId: 'work', plannedStartAt: '2026-10-17T09:00:00.000Z', plannedEndAt: '2026-10-17T10:00:00.000Z', plannedMinutes: 60, status: 'done' as const }
    expect(planSince(plannerDocument({ actuals: [actual] }), stamped)).toBe(Date.parse('2026-10-17T09:00:00Z'))
    expect(planSince(plannerDocument({ tasks: [{ id: 't', title: 'T', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-18T10:00:00.000Z' }] }), stamped)).toBe(Date.parse('2026-10-18T10:00:00Z'))
  })

  it('asks only about blocks that started after the plan existed, and nothing before the plan was seen', () => {
    const since = Date.parse('2026-10-21T14:00:00Z')
    expect(isAskable('2026-10-21T09:00:00.000Z', since)).toBe(false)
    expect(isAskable('2026-10-21T14:00:00.000Z', since)).toBe(true)
    expect(isAskable('2026-10-21T18:00:00.000Z', since)).toBe(true)
    expect(isAskable('2026-10-21T18:00:00.000Z', undefined)).toBe(false)
  })
})
