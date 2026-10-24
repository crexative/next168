import { describe, expect, it } from 'vitest'
import { dragOffset, horizontalVelocity, projectDistance, targetIndex } from './dayPager'

describe('day pager physics', () => {
  it('measures velocity over the last 100 ms only', () => {
    expect(horizontalVelocity([{ time: 0, x: 0 }, { time: 200, x: 0 }, { time: 250, x: -50 }, { time: 300, x: -100 }])).toBe(-1000)
    expect(horizontalVelocity([{ time: 0, x: 0 }])).toBe(0)
  })

  it('advances one day when the flick projects past half a page', () => {
    expect(projectDistance(1000)).toBeCloseTo(499, 0)
    expect(targetIndex(3, -40, -800, 375, 7)).toBe(4)
    expect(targetIndex(3, 40, 800, 375, 7)).toBe(2)
    expect(targetIndex(3, -5000, -9000, 375, 7)).toBe(4)
  })

  it('snaps back after a slow short drag and never leaves the week', () => {
    expect(targetIndex(3, -60, -50, 375, 7)).toBe(3)
    expect(targetIndex(3, -200, 0, 375, 7)).toBe(4)
    expect(targetIndex(0, 200, 2000, 375, 7)).toBe(0)
    expect(targetIndex(6, -200, -2000, 375, 7)).toBe(6)
  })

  it('tracks 1:1 inside the week and resists past either end', () => {
    expect(dragOffset(-120, 3, 7, 375)).toBe(-120)
    expect(dragOffset(120, 3, 7, 375)).toBe(120)
    const pastStart = dragOffset(200, 0, 7, 375)
    expect(pastStart).toBeGreaterThan(0)
    expect(pastStart).toBeLessThan(100)
    expect(dragOffset(-200, 6, 7, 375)).toBeCloseTo(-pastStart)
    expect(dragOffset(-200, 0, 7, 375)).toBe(-200)
  })
})
