import { describe, expect, it } from 'vitest'
import { releaseVelocity, rubberBand, shouldDismiss } from './sheetMotion'

describe('sheet gestures', () => {
  it('dismisses a fast downward flick even from a small offset', () => {
    expect(shouldDismiss(20, 800, 500)).toBe(true)
  })

  it('snaps back a slow release under 40 % of the height', () => {
    expect(shouldDismiss(150, 100, 500)).toBe(false)
  })

  it('dismisses a slow release past 40 % of the height', () => {
    expect(shouldDismiss(260, 100, 500)).toBe(true)
  })

  it('does not dismiss on an upward flick', () => {
    expect(shouldDismiss(0, -900, 500)).toBe(false)
  })

  it('measures velocity over the last 100 ms in px/s', () => {
    const samples = [{ time: 0, y: 0 }, { time: 400, y: 10 }, { time: 450, y: 30 }, { time: 500, y: 60 }]
    expect(releaseVelocity(samples)).toBeCloseTo(((60 - 10) / 100) * 1000 * 1, -2)
  })

  it('returns zero velocity for a single sample', () => {
    expect(releaseVelocity([{ time: 0, y: 5 }])).toBe(0)
  })

  it('applies resistance only above the resting position and never exceeds the dimension', () => {
    expect(rubberBand(120, 500)).toBe(120)
    expect(rubberBand(-100, 500)).toBeGreaterThan(-100)
    expect(rubberBand(-100, 500)).toBeLessThan(0)
    expect(rubberBand(-100000, 500)).toBeGreaterThan(-500)
  })
})
