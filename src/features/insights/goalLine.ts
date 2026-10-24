import type { Goal } from '@/core/model'
import { WEEK_MINUTES } from './capacity'

export type GoalLine =
  | { kind: 'none' }
  | { kind: 'maxLeft'; goalMinutes: number; leftMinutes: number }
  | { kind: 'atMax'; goalMinutes: number }
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
    ? (plannedMinutes > goalMinutes
      ? { kind: 'over', goalMinutes, overMinutes: plannedMinutes - goalMinutes }
      : plannedMinutes === goalMinutes ? { kind: 'atMax', goalMinutes } : { kind: 'maxLeft', goalMinutes, leftMinutes: goalMinutes - plannedMinutes })
    : (plannedMinutes < goalMinutes ? { kind: 'minMissing', goalMinutes, leftMinutes: goalMinutes - plannedMinutes } : { kind: 'minMet', goalMinutes })
  return {
    line,
    fillPercent: scale > 0 ? (plannedMinutes / scale) * 100 : 0,
    markerPercent: scale > 0 ? (goalMinutes / scale) * 100 : null,
  }
}

export interface GoalFigures {
  // Minutes, written with the same formatter as the week's legend (formatTotal), so a category reads the same figure in
  // both places. `amountMinutes` is what is left, over or missing.
  plannedMinutes: number
  goalMinutes: number
  amountMinutes: number
  // One state per row: a met or kept goal, or one that needs a look. A category without a goal has none.
  state: 'ok' | 'attention' | null
}

export function goalFigures(line: GoalLine, plannedMinutes: number): GoalFigures {
  const figures = (goalMinutes: number, amountMinutes: number, state: GoalFigures['state']): GoalFigures => ({ plannedMinutes, goalMinutes, amountMinutes, state })
  switch (line.kind) {
    case 'none': return figures(0, 0, null)
    case 'minMissing': return figures(line.goalMinutes, line.leftMinutes, 'attention')
    case 'maxLeft': return figures(line.goalMinutes, line.leftMinutes, 'ok')
    case 'over': return figures(line.goalMinutes, line.overMinutes, 'attention')
    case 'atMax': return figures(line.goalMinutes, 0, 'ok')
    case 'minMet': return figures(line.goalMinutes, 0, 'ok')
  }
}
