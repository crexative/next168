import { describe, expect, it } from 'vitest'
import { goalFigures, goalProgress } from './goalLine'

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

describe('goalFigures', () => {
  const figures = (goal: Parameters<typeof goalProgress>[0], plannedMinutes: number) => goalFigures(goalProgress(goal, plannedMinutes).line, plannedMinutes)

  it.each([
    { type: 'min' as const, planned: 0, expected: { plannedMinutes: 0, goalMinutes: 0, amountMinutes: 0, state: 'ok' } },
    { type: 'min' as const, planned: 60, expected: { plannedMinutes: 60, goalMinutes: 0, amountMinutes: 0, state: 'ok' } },
    { type: 'max' as const, planned: 0, expected: { plannedMinutes: 0, goalMinutes: 0, amountMinutes: 0, state: 'ok' } },
    { type: 'max' as const, planned: 30, expected: { plannedMinutes: 30, goalMinutes: 0, amountMinutes: 30, state: 'attention' } },
  ])('preserves a zero-hour $type goal with $planned planned minutes', ({ type, planned, expected }) => {
    expect(figures({ type, hoursPerWeek: 0 }, planned)).toEqual(expected)
  })

  it('keeps the exact minutes, so the row and the legend round them by the same rule', () => {
    expect(figures({ type: 'max', hoursPerWeek: 40 }, h(37.5))).toEqual({ plannedMinutes: h(37.5), goalMinutes: h(40), amountMinutes: h(2.5), state: 'ok' })
    expect(figures({ type: 'min', hoursPerWeek: 4.5 }, h(4.5))).toEqual({ plannedMinutes: h(4.5), goalMinutes: h(4.5), amountMinutes: 0, state: 'ok' })
  })

  it('reports what is missing, left or over, and one state per row', () => {
    expect(figures({ type: 'min', hoursPerWeek: 4 }, h(3.5))).toMatchObject({ amountMinutes: 30, state: 'attention' })
    expect(figures({ type: 'max', hoursPerWeek: 4 }, 320)).toMatchObject({ amountMinutes: 80, state: 'attention' })
    expect(figures({ type: 'max', hoursPerWeek: 40 }, h(40))).toMatchObject({ amountMinutes: 0, state: 'ok' })
    expect(figures({ type: 'none', hoursPerWeek: 0 }, h(3.6)).state).toBeNull()
  })
})
