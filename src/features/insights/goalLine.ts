import type { Goal } from '@/core/model'
import { WEEK_MINUTES } from './capacity'

export type GoalLine =
  | { kind: 'none' }
  | { kind: 'maxLeft'; goalMinutes: number; leftMinutes: number }
  | { kind: 'over'; goalMinutes: number; overMinutes: number }
  | { kind: 'minMissing'; goalMinutes: number; leftMinutes: number }
  | { kind: 'minMet'; goalMinutes: number }

export interface GoalProgress {
  line: GoalLine
  // Bar scale is max(goal, planned); a category without a goal is shown against the whole week.
  fillPercent: number
  markerPercent: number | null
}

export function goalProgress(goal: Goal, plannedMinutes: number): GoalProgress {
  if (goal.type === 'none') {
    return { line: { kind: 'none' }, fillPercent: Math.min(100, (plannedMinutes / WEEK_MINUTES) * 100), markerPercent: null }
  }
  const goalMinutes = goal.hoursPerWeek * 60
  const scale = Math.max(goalMinutes, plannedMinutes)
  const line: GoalLine = goal.type === 'max'
    ? (plannedMinutes > goalMinutes ? { kind: 'over', goalMinutes, overMinutes: plannedMinutes - goalMinutes } : { kind: 'maxLeft', goalMinutes, leftMinutes: goalMinutes - plannedMinutes })
    : (plannedMinutes < goalMinutes ? { kind: 'minMissing', goalMinutes, leftMinutes: goalMinutes - plannedMinutes } : { kind: 'minMet', goalMinutes })
  return {
    line,
    fillPercent: scale > 0 ? (plannedMinutes / scale) * 100 : 0,
    markerPercent: scale > 0 ? (goalMinutes / scale) * 100 : null,
  }
}
