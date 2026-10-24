import { describe, expect, it } from 'vitest'
import { goalProgress } from './goalLine'

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
