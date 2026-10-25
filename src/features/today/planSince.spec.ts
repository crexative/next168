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
    // A check-in proves the plan by the end of its day.
    const withCheckIn = plannerDocument({ checkIns: [{ date: '2026-10-19' }] })
    expect(planSince(withCheckIn, stamped)).toBe(Date.parse('2026-10-20T00:00:00Z'))
    const actual = { date: '2026-10-17', blockId: 'b', categoryId: 'work', plannedStartAt: '2026-10-17T09:00:00.000Z', plannedEndAt: '2026-10-17T10:00:00.000Z', plannedMinutes: 60, status: 'done' as const }
    expect(planSince(plannerDocument({ actuals: [actual] }), stamped)).toBe(Date.parse('2026-10-17T09:00:00Z'))
    expect(planSince(plannerDocument({ tasks: [{ id: 't', title: 'T', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-18T10:00:00.000Z' }] }), stamped)).toBe(Date.parse('2026-10-18T10:00:00Z'))
  })

  // verify4 defect 7: the first Day wrap-up, on the day the plan was made, made that morning's blocks askable.
  it('the first check-in, on the day the plan was first seen, keeps the blocks before the plan unaskable', () => {
    const stamped = Date.parse('2026-10-24T20:52:00Z')
    const afterWrapUp = plannerDocument({ checkIns: [{ date: '2026-10-24', bedtime: 1380, wake: 420, stress: 1 }] })
    const since = planSince(afterWrapUp, stamped)
    expect(since).toBe(stamped)
    expect(isAskable('2026-10-24T12:00:00.000Z', since)).toBe(false)
    expect(isAskable('2026-10-24T20:51:59.000Z', since)).toBe(false)
    expect(isAskable('2026-10-24T20:52:00.000Z', since)).toBe(true)
    // In the person's own zone: the check-in day ends at their midnight, not UTC's.
    const bogota = plannerDocument({ checkIns: [{ date: '2026-10-24' }] })
    bogota.settings.timeZone = 'America/Bogota'
    expect(planSince(bogota, Date.parse('2026-10-26T00:00:00Z'))).toBe(Date.parse('2026-10-25T05:00:00Z'))
  })

  it('asks only about blocks that started after the plan existed, and nothing before the plan was seen', () => {
    const since = Date.parse('2026-10-21T14:00:00Z')
    expect(isAskable('2026-10-21T09:00:00.000Z', since)).toBe(false)
    expect(isAskable('2026-10-21T14:00:00.000Z', since)).toBe(true)
    expect(isAskable('2026-10-21T18:00:00.000Z', since)).toBe(true)
    expect(isAskable('2026-10-21T18:00:00.000Z', undefined)).toBe(false)
  })
})
