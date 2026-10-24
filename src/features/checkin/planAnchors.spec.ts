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

  it('prefers the longest sleep block over a nap, and the latest work end over an earlier one', () => {
    const nap = { id: 'nap', categoryId: 'sleep', title: 'Nap', days: [0, 1, 2, 3, 4, 5, 6] as [0, 1, 2, 3, 4, 5, 6], start: 780, end: 840 }
    const morning = { ...deepWork, id: 'morning', start: 540, end: 720 }
    const afternoon = { ...deepWork, id: 'afternoon', start: 780, end: 1020 }
    for (const blocks of [[nap, sleep, afternoon, morning], [morning, afternoon, sleep, nap]]) {
      expect(suggestFromPlan(plannerDocument({ categories: [sleepCategory, workCategory], blocks }), '2026-10-21')).toEqual({ bedtime: 1320, wake: 360, workEnd: 1020, worksThatDay: true })
    }
  })

  it('treats a sleep block that ends exactly at midnight as ending on the day it started', () => {
    const untilMidnight = { ...sleep, days: [2] as [2], start: 1200, end: 0 } // Tuesday 20:00 → Wednesday 00:00
    const document = plannerDocument({ categories: [sleepCategory, workCategory], blocks: [untilMidnight] })
    expect(suggestFromPlan(document, '2026-10-20')).toEqual({ bedtime: 1200, wake: 0, worksThatDay: true })
    expect(suggestFromPlan(document, '2026-10-21')).toEqual({ worksThatDay: true })
  })

  it('only counts work that starts on the asked date', () => {
    const nightShift = { ...deepWork, id: 'night', days: [2] as [2], start: 1320, end: 360 } // Tue 22:00 → Wed 06:00
    expect(suggestFromPlan(plannerDocument({ categories: [sleepCategory, workCategory], blocks: [nightShift] }), '2026-10-21')).toEqual({ worksThatDay: false })
  })
})
