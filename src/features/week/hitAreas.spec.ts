import { describe, expect, it } from 'vitest'
import { MIN_TARGET_PX, hitAreas, sharedTargets, subtract, type Box, type PressItem } from './hitAreas'

const column = { width: 300, height: 1152 }
const box = (key: string, top: number, bottom: number, extra: Partial<PressItem> = {}): PressItem => ({ key, top, bottom, left: 2, right: 298, ...extra })
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

describe('shared targets', () => {
  const shared = (items: PressItem[]) => sharedTargets(items, hitAreas(items.filter((item) => !item.outline), column), column)

  it('leaves items that own a 44 px square alone: no chooser where every item has room', () => {
    expect(shared([box('tall', 300, 400), box('short', 100, 112), box('routine', 500, 600), box('task', 510, 528, { hostKey: 'routine' })])).toEqual([])
  })

  // verify11 C1: "Family dinner" kept 22 px around "Order groceries" in its middle.
  it('gives a routine whose task leaves it no 44 px band a shared target where it still has room', () => {
    const targets = shared([box('dinner', 500, 572), box('groceries', 520, 538, { left: 6, right: 296, hostKey: 'dinner' })])
    expect(targets).toHaveLength(1)
    expect(targets[0]!.keys.sort()).toEqual(['dinner', 'groceries'])
  })

  // verify11 C1: "Finish course module 4" had exactly the time of "Reading" (21:00–21:30): drawn as an outline, 0 px of
  // its own, every tap opened Reading.
  it('gives a task with the same time as its routine a shared target with the routine', () => {
    const targets = shared([box('reading', 1008, 1032), box('course', 1008, 1032, { hostKey: 'reading', outline: true })])
    expect(targets).toHaveLength(1)
    expect(targets[0]!.keys.sort()).toEqual(['course', 'reading'])
    expect(targets[0]!.box.bottom - targets[0]!.box.top).toBeGreaterThanOrEqual(MIN_TARGET_PX)
    expect(targets[0]!.box.right - targets[0]!.box.left).toBeGreaterThanOrEqual(MIN_TARGET_PX)
  })

  // verify11 C1: "Gym" (one hour, 48 px) kept 5–6 px once its 45-minute task took the rest.
  it('gives a routine that its task leaves less than 44 px a shared target with that task', () => {
    const gym = box('gym', 864, 912, { left: 151, right: 298 })
    const run = box('run', 876, 912, { left: 155, right: 296, hostKey: 'gym' })
    const targets = shared([gym, run])
    expect(targets).toHaveLength(1)
    expect(targets[0]!.keys.sort()).toEqual(['gym', 'run'])
  })
})
