import type { BlockActual, CheckIn, Goal, PlannerDocument } from './model'
import { addLocalDays, occurrences, zonedInstant } from './time'

export type GoalStatus = { kind: 'over' | 'missing' | 'ok' | 'none'; minutes: number }
export function goalStatus(goal: Goal, plannedMinutes: number): GoalStatus {
  const difference = plannedMinutes - goal.hoursPerWeek * 60
  if (goal.type === 'none') return { kind: 'none', minutes: 0 }
  if (goal.type === 'max' && difference > 0) return { kind: 'over', minutes: difference }
  if (goal.type === 'min' && difference < 0) return { kind: 'missing', minutes: -difference }
  return { kind: 'ok', minutes: 0 }
}
export function plannedMinutesByCategory(document: PlannerDocument): Record<string, number> {
  const totals = new Map(document.categories.map((category) => [category.id, 0]))
  for (const block of document.blocks) {
    const minutes = occurrences(block).reduce((sum, interval) => sum + interval.end - interval.start, 0)
    totals.set(block.categoryId, (totals.get(block.categoryId) ?? 0) + minutes)
  }
  return Object.fromEntries(totals)
}
export function computeStats(document: PlannerDocument) {
  const totals = plannedMinutesByCategory(document)
  const plannedMinutes = Object.values(totals).reduce((sum, minutes) => sum + minutes, 0)
  return {
    plannedMinutes, unassignedHours: Math.max(0, 168 - plannedMinutes / 60),
    categories: document.categories.map((category) => ({ categoryId: category.id, plannedMinutes: totals[category.id]!, goal: goalStatus(category.goal, totals[category.id]!) })),
  }
}
export function planVsActual(actuals: BlockActual[]): Record<string, { plannedMinutes: number; actualMinutes: number }> {
  const totals = new Map<string, { plannedMinutes: number; actualMinutes: number }>()
  for (const actual of actuals) {
    const category = totals.get(actual.categoryId) ?? { plannedMinutes: 0, actualMinutes: 0 }
    category.plannedMinutes += actual.plannedMinutes
    category.actualMinutes += actual.status === 'done' ? actual.plannedMinutes : actual.status === 'partial' ? actual.actualMinutes! : 0
    totals.set(actual.categoryId, category)
  }
  return Object.fromEntries(totals)
}
export type MeasureState = 'good' | 'amber' | 'bad' | null
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

// A check-in records the waking date; bedtime may belong to its preceding night.
// Omitting timeZone requests nominal minutes; pass the document zone for elapsed sleep.
export function sevenDayMeasures(checkIns: CheckIn[], throughDate: string, exerciseTarget: number, timeZone?: string) {
  const byDate = new Map(checkIns.map((checkIn) => [checkIn.date, checkIn]))
  const sleeps: number[] = [], stresses: number[] = []
  let exerciseCount = 0, lateWorkNights = 0
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(throughDate, index - 6)
    const checkIn = byDate.get(date)
    let sleep: MeasureState = null, exercise: MeasureState = null, lateWork: MeasureState = null, stress: MeasureState = null
    if (checkIn?.bedtime !== undefined && checkIn.wake !== undefined) {
      const bedtimeDate = addLocalDays(date, checkIn.bedtime > checkIn.wake ? -1 : 0)
      const minutes = timeZone
        ? (zonedInstant(date, checkIn.wake, timeZone).getTime() - zonedInstant(bedtimeDate, checkIn.bedtime, timeZone).getTime()) / 60000
        : (checkIn.wake - checkIn.bedtime + 1440) % 1440
      sleeps.push(minutes)
      sleep = minutes >= 420 && minutes <= 540 ? 'good' : minutes >= 360 && minutes <= 600 ? 'amber' : 'bad'
    }
    if (checkIn?.exercise !== undefined) {
      exercise = checkIn.exercise === 'yes' ? 'good' : checkIn.exercise === 'no' ? 'bad' : 'amber'
      if (checkIn.exercise === 'yes') exerciseCount++
    }
    if (checkIn?.workEnd !== undefined) {
      const late = checkIn.workEnd >= 1260 || checkIn.workEnd < 300
      lateWork = late ? 'bad' : 'good'
      if (late) lateWorkNights++
    }
    if (checkIn?.stress !== undefined) {
      stresses.push(checkIn.stress)
      stress = checkIn.stress <= 2 ? 'good' : checkIn.stress === 3 ? 'amber' : 'bad'
    }
    return { date, sleep, exercise, lateWork, stress }
  })
  return { averageSleepMinutes: average(sleeps), exerciseCount, exerciseTarget, lateWorkNights, averageStress: average(stresses), days }
}
