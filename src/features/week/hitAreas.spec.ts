import { describe, expect, it } from 'vitest'
import { MIN_TARGET_PX, hitAreas, subtract, type Box, type HitItem } from './hitAreas'

const column = { width: 300, height: 1152 }
const box = (key: string, top: number, bottom: number, extra: Partial<HitItem> = {}): HitItem => ({ key, top, bottom, left: 2, right: 298, ...extra })
// The rows of an item's area: [top, bottom, left, right] of each part, sorted.
const rows = (parts: Box[] | undefined) => (parts ?? []).map((part) => [part.top, part.bottom, part.left, part.right]).sort((a, b) => a[0]! - b[0]! || a[2]! - b[2]!)

describe('hit areas', () => {
  it('grows a short item to 44 px, centred on it, and gives a tall one nothing beyond its box', () => {
    const areas = hitAreas([box('short', 100, 112), box('tall', 300, 400)], column)
    expect(rows(areas.get('short'))).toEqual([[84, 100, 2, 298], [112, 128, 2, 298]])
    expect(areas.get('tall')).toEqual([])
  })

  it('grows a narrow item across, keeps every area inside the column, and covers the gaps of its lane', () => {
    const areas = hitAreas([box('narrow', 0, 12, { left: 290, right: 298 }), box('lane', 300, 400, { left: 2, right: 98, gap: 2 })], column)
    expect(rows(areas.get('narrow'))).toEqual([[0, 12, 300 - MIN_TARGET_PX, 290], [0, 12, 298, 300], [12, MIN_TARGET_PX, 300 - MIN_TARGET_PX, 300]])
    expect(rows(areas.get('lane'))).toEqual([[300, 400, 0, 2], [300, 400, 98, 100]])
  })

  // verify10: a tap 10.9 px below an 18 px task opened the routine around it.
  it('lays a task inside a routine over the routine, which keeps the rest of its box', () => {
    const areas = hitAreas([box('routine', 400, 500), box('task', 420, 438, { left: 6, right: 296, hostKey: 'routine' })], column)
    expect(rows(areas.get('task'))).toEqual([[407, 420, 6, 296], [438, 451, 6, 296]])
    expect(areas.get('routine')).toEqual([])
  })

  it('splits two neighbours at the midpoint between their boxes, so a tap goes to the nearest', () => {
    const areas = hitAreas([box('first', 420, 438, { hostKey: 'routine' }), box('second', 440, 458, { hostKey: 'routine' }), box('routine', 400, 500)], column)
    expect(rows(areas.get('first'))).toEqual([[407, 420, 2, 298], [438, 439, 2, 298]])
    expect(rows(areas.get('second'))).toEqual([[439, 440, 2, 298], [458, 471, 2, 298]])
  })

  it('never covers a neighbour\'s box: a short item next to a long one keeps to its own side', () => {
    const areas = hitAreas([box('coffee', 372, 384), box('focus', 384, 552)], column)
    expect(rows(areas.get('coffee'))).toEqual([[356, 372, 2, 298]])
  })

  // verify10: a task under the left half of a routine kept the free right half above it.
  it('gives up only the room nearer a neighbour, across that neighbour\'s own width', () => {
    const areas = hitAreas([box('sleep', 0, 284, { left: 2, right: 148 }), box('task', 284, 308)], column)
    expect(rows(areas.get('task'))).toEqual([[274, 284, 148, 298], [308, 318, 2, 298]])
  })

  it('splits side by side lanes at the midpoint between them', () => {
    const areas = hitAreas([box('left', 100, 112, { left: 2, right: 20 }), box('right', 100, 112, { left: 24, right: 42 })], column)
    expect(Math.max(...(areas.get('left') ?? []).map((part) => part.right))).toBe(22)
    expect(Math.min(...(areas.get('right') ?? []).map((part) => part.left))).toBe(22)
  })

  it('subtracts one box from another in at most four parts', () => {
    expect(subtract({ top: 0, bottom: 10, left: 0, right: 10 }, { top: 2, bottom: 8, left: 2, right: 8 })).toHaveLength(4)
    expect(subtract({ top: 0, bottom: 10, left: 0, right: 10 }, { top: 20, bottom: 30, left: 0, right: 10 })).toEqual([{ top: 0, bottom: 10, left: 0, right: 10 }])
  })
})
