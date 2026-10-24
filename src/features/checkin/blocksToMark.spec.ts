import { describe, expect, it } from 'vitest'
import { plannerDocument } from '@/features/week/testDocument'
import { blocksToMark } from './blocksToMark'

const at = (value: string) => new Date(value)
const SINCE = Date.parse('2026-10-20T00:00:00Z')
// Wednesday 2026-10-21: Deep work 09:00–11:00, a late block 22:00–24:00, Sleep 22:00–06:00 every night.
const document = plannerDocument({
  blocks: [
    { id: 'deep', categoryId: 'work', title: 'Deep work', days: [3], start: 540, end: 660 },
    { id: 'late', categoryId: 'work', title: 'Late', days: [3], start: 1320, end: 0 },
    { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'nap', categoryId: 'sleep', title: 'Nap', days: [3], start: 780, end: 840 },
    { id: 'shift', categoryId: 'work', title: 'Night shift', days: [2], start: 1380, end: 60 },
  ],
  categories: [
    { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'none', hoursPerWeek: 0 } },
  ],
})
const titles = (now: string, ...since: [number | undefined] | []) => blocksToMark(document, '2026-10-21', at(now), since.length ? since[0] : SINCE).map((item) => item.title)

describe('blocksToMark', () => {
  it('lists finished blocks of the day, never a Sleep block (the sentences above cover it) or the tail of a block that began yesterday', () => {
    expect(titles('2026-10-21T20:00:00Z')).toEqual(['Deep work'])
  })

  it('leaves out a block that has not reached its last ten minutes', () => {
    expect(titles('2026-10-21T10:45:00Z')).toEqual([])
    expect(titles('2026-10-21T10:50:00Z')).toEqual(['Deep work'])
  })

  it('includes a block ending exactly at midnight once its window opens (half-open day)', () => {
    expect(titles('2026-10-21T23:49:00Z')).toEqual(['Deep work'])
    expect(titles('2026-10-21T23:50:00Z')).toEqual(['Deep work', 'Late'])
  })

  it('asks nothing before the plan was seen, and nothing about blocks that began earlier', () => {
    expect(titles('2026-10-21T20:00:00Z', undefined)).toEqual([])
    expect(titles('2026-10-21T20:00:00Z', Date.parse('2026-10-21T10:00:00Z'))).toEqual([])
  })

  it('works in the planner’s own zone: a block counts at its local time, not at its UTC time', () => {
    const bogota = { ...document, settings: { ...document.settings, timeZone: 'America/Bogota' } }
    // 2026-10-21 12:00 in Bogotá is 17:00Z; the block ended at 11:00 local.
    expect(blocksToMark(bogota, '2026-10-21', at('2026-10-21T17:00:00Z'), SINCE).map((item) => item.title)).toEqual(['Deep work'])
    expect(blocksToMark(bogota, '2026-10-21', at('2026-10-21T14:00:00Z'), SINCE).map((item) => item.title)).toEqual([])
  })
})
