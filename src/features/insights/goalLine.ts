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

export interface GoalHours {
  // Whole hours as the row reads them: "3 of at least 4 h · 1 h to go". `amount` is what is left, over or missing.
  planned: number
  goal: number
  amount: number
  // One state per row: a met or kept goal, or one that needs a look. A category without a goal has none.
  state: 'ok' | 'attention' | null
}

const wholeHours = (minutes: number) => Math.round(minutes / 60)

// The line in whole hours. What is missing, left or over rounds up, so a part of an hour never reads as "0 h"
// while the goal is still open, and `planned` is derived from it, so planned and amount always add up to the goal.
export function goalHours(line: GoalLine, plannedMinutes: number): GoalHours {
  if (line.kind === 'none') return { planned: wholeHours(plannedMinutes), goal: 0, amount: 0, state: null }
  const goal = Math.max(1, wholeHours(line.goalMinutes))
  const rest = (minutes: number) => Math.min(goal, Math.max(1, Math.ceil(minutes / 60)))
  switch (line.kind) {
    case 'minMissing': return { planned: goal - rest(line.leftMinutes), goal, amount: rest(line.leftMinutes), state: 'attention' }
    case 'maxLeft': return { planned: goal - rest(line.leftMinutes), goal, amount: rest(line.leftMinutes), state: 'ok' }
    case 'over': { const amount = Math.max(1, Math.ceil(line.overMinutes / 60)); return { planned: goal + amount, goal, amount, state: 'attention' } }
    case 'atMax': return { planned: goal, goal, amount: 0, state: 'ok' }
    case 'minMet': return { planned: Math.max(goal, wholeHours(plannedMinutes)), goal, amount: 0, state: 'ok' }
  }
}
