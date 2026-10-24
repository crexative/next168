import { describe, expect, it } from 'vitest'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { isWorkCategory, suggestFromPlan } from './planAnchors'

const sleepCategory = { id: 'sleep', name: 'Sleep', colorKey: 'purple' as const, icon: '😴', goal: { type: 'none' as const, hoursPerWeek: 0 } }
const workCategory = { id: 'work', name: 'Trabajo', colorKey: 'blue' as const, icon: '💼', goal: { type: 'max' as const, hoursPerWeek: 40 } }
const document = plannerDocument({ categories: [sleepCategory, workCategory], blocks: [{ ...deepWork, start: 540, end: 1020 }, sleep] })

describe('suggestFromPlan', () => {
  it('takes bedtime and wake from last night’s sleep block and work end from that day’s work', () => {
    // Wednesday 2026-10-21: slept Tuesday 22:00 → 06:00, works until 17:00.
    expect(suggestFromPlan(document, '2026-10-21')).toEqual({ bedtime: 1320, wake: 360, workEnd: 1020, worksThatDay: true })
  })

  it('has no work end and flags a non-work day on Saturday', () => {
    const saturday = suggestFromPlan(document, '2026-10-24')
    expect(saturday).toEqual({ bedtime: 1320, wake: 360, worksThatDay: false })
    expect('workEnd' in saturday).toBe(false)
  })

  it('suggests nothing, and does not hide "work ended", when the plan has no sleep and no work at all', () => {
    expect(suggestFromPlan(plannerDocument(), '2026-10-21')).toEqual({ worksThatDay: true })
  })

  it('recognises Work by icon or by its name in any supported language', () => {
    expect(isWorkCategory({ name: 'Anything', icon: '💼' })).toBe(true)
    expect(['Work', 'trabajo', ' Travail ', 'Trabalho', 'Arbeit'].every((name) => isWorkCategory({ name }))).toBe(true)
    expect(isWorkCategory({ name: 'Gym' })).toBe(false)
  })
})
