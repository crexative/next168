import { describe, expect, it } from 'vitest'
import { goalHours, goalProgress } from './goalLine'

const h = (hours: number) => hours * 60

describe('goalProgress', () => {
  it('max goal under the cap reports what is left and puts the marker at the real goal position', () => {
    expect(goalProgress({ type: 'max', hoursPerWeek: 40 }, h(32))).toEqual({
      line: { kind: 'maxLeft', goalMinutes: h(40), leftMinutes: h(8) }, fillPercent: 80, markerPercent: 100,
    })
  })

  it('max goal over the cap reports the excess and moves the marker inside a bar scaled to the planned time', () => {
    const progress = goalProgress({ type: 'max', hoursPerWeek: 40 }, h(50))
    expect(progress.line).toEqual({ kind: 'over', goalMinutes: h(40), overMinutes: h(10) })
    expect(progress.fillPercent).toBe(100)
    expect(progress.markerPercent).toBe(80)
  })

  it('min goal reports what is missing, including the whole minimum at 0 h', () => {
    expect(goalProgress({ type: 'min', hoursPerWeek: 49 }, h(35)).line).toEqual({ kind: 'minMissing', goalMinutes: h(49), leftMinutes: h(14) })
    expect(goalProgress({ type: 'min', hoursPerWeek: 49 }, 0)).toMatchObject({ line: { kind: 'minMissing', leftMinutes: h(49) }, fillPercent: 0, markerPercent: 100 })
  })

  it('min goal is met at the minimum and above', () => {
    expect(goalProgress({ type: 'min', hoursPerWeek: 49 }, h(49)).line.kind).toBe('minMet')
    const above = goalProgress({ type: 'min', hoursPerWeek: 49 }, h(56))
    expect(above.line.kind).toBe('minMet')
    expect(above.markerPercent).toBeCloseTo(87.5)
  })

  it('no goal has no marker and shows the share of the week', () => {
    expect(goalProgress({ type: 'none', hoursPerWeek: 0 }, h(84))).toEqual({ line: { kind: 'none' }, fillPercent: 50, markerPercent: null })
  })
})

describe('goalProgress at the cap', () => {
  it('a max goal reached exactly is "at the max", not "0 min left"', () => {
    expect(goalProgress({ type: 'max', hoursPerWeek: 40 }, h(40)).line).toEqual({ kind: 'atMax', goalMinutes: h(40) })
    expect(goalProgress({ type: 'max', hoursPerWeek: 40 }, h(40) - 1).line.kind).toBe('maxLeft')
  })
})

describe('goalHours', () => {
  const hours = (goal: Parameters<typeof goalProgress>[0], plannedMinutes: number) => goalHours(goalProgress(goal, plannedMinutes).line, plannedMinutes)

  it('reads a missing minimum in whole hours that add up to the goal: 3 h 30 min of 4 h is "3 of 4 · 1 to go"', () => {
    expect(hours({ type: 'min', hoursPerWeek: 4 }, h(3.5))).toEqual({ planned: 3, goal: 4, amount: 1, state: 'attention' })
    expect(hours({ type: 'min', hoursPerWeek: 49 }, 0)).toEqual({ planned: 0, goal: 49, amount: 49, state: 'attention' })
  })

  it('rounds what is open up, so 2 h 40 min of 4 h reads "2 of 4 · 2 to go"', () => {
    expect(hours({ type: 'min', hoursPerWeek: 4 }, 160)).toEqual({ planned: 2, goal: 4, amount: 2, state: 'attention' })
    expect(hours({ type: 'max', hoursPerWeek: 4 }, 160)).toEqual({ planned: 2, goal: 4, amount: 2, state: 'ok' })
    expect(hours({ type: 'max', hoursPerWeek: 4 }, 320)).toEqual({ planned: 6, goal: 4, amount: 2, state: 'attention' })
  })

  it('never says 0 h while a part of an hour is still open', () => {
    expect(hours({ type: 'min', hoursPerWeek: 4 }, h(4) - 1)).toMatchObject({ planned: 3, amount: 1 })
    expect(hours({ type: 'max', hoursPerWeek: 4 }, h(4) - 1)).toMatchObject({ planned: 3, amount: 1, state: 'ok' })
    expect(hours({ type: 'max', hoursPerWeek: 4 }, h(4) + 1)).toMatchObject({ planned: 5, amount: 1, state: 'attention' })
  })

  it('marks a kept goal and a goal at the cap as fine, and reports the excess over a max', () => {
    expect(hours({ type: 'min', hoursPerWeek: 4 }, h(5.4))).toEqual({ planned: 5, goal: 4, amount: 0, state: 'ok' })
    expect(hours({ type: 'max', hoursPerWeek: 40 }, h(40))).toEqual({ planned: 40, goal: 40, amount: 0, state: 'ok' })
    expect(hours({ type: 'max', hoursPerWeek: 40 }, h(50))).toEqual({ planned: 50, goal: 40, amount: 10, state: 'attention' })
  })

  it('has no state for a category without a goal', () => {
    expect(hours({ type: 'none', hoursPerWeek: 0 }, h(3.6)).state).toBeNull()
  })
})
