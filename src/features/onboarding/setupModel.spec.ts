import { describe, expect, it } from 'vitest'
import type { DayIndex } from '@/core/model'
import { wholeHourParts } from '@/ui/format'
import {
  addOwnCategory, automaticGoal, blockToSleep, coveredMinutes, createState, deriveCommute, emptyState, ensureCategory, placeSlot,
  sleepToBlock, slotMinutes, statusOf, suggestCommute, suggestRanges, validate, weekTotals, type SetupState,
} from './setupModel'
import { block, category, documentWith, env } from './setupFixtures'

const at = (hours: number, minutes = 0) => hours * 60 + minutes
const set = (days: readonly number[]) => [...days].sort((a, b) => a - b)

describe('sleep: nights and blocks (A21)', () => {
  it('converts the explicit examples', () => {
    expect(set(sleepToBlock({ days: [0, 1, 2, 3, 4], start: at(23), end: at(7) }).days)).toEqual([0, 1, 2, 3, 4])
    const weekend = sleepToBlock({ days: [5, 6], start: at(0, 30), end: at(8, 30) })
    expect([set(weekend.days), weekend.start, weekend.end]).toEqual([[0, 6], 30, 510])
    expect(set(sleepToBlock({ days: [1, 2, 3, 4, 5], start: at(8), end: at(16) }).days)).toEqual([1, 2, 3, 4, 5])
    expect(slotMinutes({ days: [0, 1, 2, 3, 4, 5, 6], start: at(23), end: at(7) })).toBe(3360)
  })

  it('round-trips every evening bedtime on a 30-minute grid, and never shifts a daytime sleep', () => {
    const nights: DayIndex[] = [0, 2, 6]
    for (let start = 0; start < 1440; start += 30) {
      const there = sleepToBlock({ days: nights, start, end: (start + 480) % 1440 })
      expect(set(blockToSleep(there).days), `bed at ${start}`).toEqual(set(nights))
      if (start >= 360) expect(set(there.days)).toEqual(set(nights))
      else expect(set(there.days)).toEqual(set(nights.map((day) => (day + 1) % 7)))
    }
  })
})

describe('the trip to and from work or study (A15)', () => {
  const asRows = (base: Parameters<typeof deriveCommute>[0]) => deriveCommute(base).map((range) => [range.label, set(range.days), range.start, range.end])

  it('goes 30 minutes before the first range starts and comes back when it ends', () => {
    expect(asRows({ days: [1, 2, 3, 4, 5], start: at(8), end: at(17, 30) })).toEqual([
      ['there', [1, 2, 3, 4, 5], at(7, 30), at(8)], ['back', [1, 2, 3, 4, 5], at(17, 30), at(18)],
    ])
  })

  it('puts the return of a night shift on the next day, and the trip before a midnight start on the day before', () => {
    expect(asRows({ days: [1], start: at(22), end: at(6) })).toEqual([['there', [1], at(21, 30), at(22)], ['back', [2], at(6), at(6, 30)]])
    expect(asRows({ days: [1], start: at(0, 15), end: at(8) })).toEqual([['there', [0], 1425, 15], ['back', [1], at(8), at(8, 30)]])
    expect(asRows({ days: [6], start: at(22), end: at(6) })).toEqual([['there', [6], at(21, 30), at(22)], ['back', [0], at(6), at(6, 30)]])
  })

  it('has a Monday-to-Friday default when there is nothing to derive from', () => {
    expect(asRows(undefined)).toEqual([['there', [1, 2, 3, 4, 5], at(7, 30), at(8)], ['back', [1, 2, 3, 4, 5], at(17, 30), at(18)]])
  })

  it('keeps every minute inside the day for every start, length and day set', () => {
    for (let start = 0; start < 1440; start += 15) {
      for (const length of [15, 60, 480, 600, 1425]) {
        for (const days of [[0], [6], [0, 6], [1, 2, 3]] as DayIndex[][]) {
          for (const range of deriveCommute({ days, start, end: (start + length) % 1440 })) {
            expect(range.start).toBeGreaterThanOrEqual(0)
            expect(range.start).toBeLessThan(1440)
            expect(range.end).toBeGreaterThanOrEqual(0)
            expect(range.end).toBeLessThan(1440)
            expect(range.days.every((day) => day >= 0 && day <= 6)).toBe(true)
          }
        }
      }
    }
  })

  it('derives from the first work range, once, and never again after the person has seen it', () => {
    const state = emptyState()
    state.answers.workStudy = 'work'
    const work = ensureCategory(state, 'work', 'work', 'Work')
    suggestRanges(state, work)
    work.ranges.push({ ...work.ranges[0]!, key: 'second', start: at(20), end: at(22) })
    const commute = ensureCategory(state, 'commute', 'commute', 'Commute')
    state.answers.commute = 'yes'
    suggestCommute(state, commute)
    expect(commute.ranges.map((range) => [range.label, range.start])).toEqual([['there', at(8, 30)], ['back', at(17)]])
    work.ranges[0]!.start = at(6)
    suggestCommute(state, commute)
    expect(commute.ranges.map((range) => range.start)).toEqual([at(8, 30), at(17)])
  })
})

describe('placing suggestions (A16, A17)', () => {
  const state = (): SetupState => {
    const value = emptyState()
    value.answers.workStudy = 'both'
    value.answers.more = ['learning']
    return value
  }

  it('moves learning clear of an evening class, to the first free hour', () => {
    const value = state()
    const study = ensureCategory(value, 'study', 'study', 'Study')
    suggestRanges(value, study)
    expect([set(study.ranges[0]!.days), study.ranges[0]!.start, study.ranges[0]!.end]).toEqual([[1, 2, 3, 4], at(19), at(21)])
    const learning = ensureCategory(value, 'learning', 'learning', 'Learning')
    suggestRanges(value, learning)
    expect([set(learning.ranges[0]!.days), learning.ranges[0]!.start, learning.ranges[0]!.end]).toEqual([[2, 4], at(21), at(22)])
  })

  it('looks later first, then from 06:00, in 30-minute steps', () => {
    const taken = [{ days: [1] as DayIndex[], start: at(18), end: at(23) }]
    expect(placeSlot({ days: [1], start: at(18), end: at(19) }, taken).slot).toMatchObject({ start: at(6), end: at(7) })
    expect(placeSlot({ days: [1], start: at(18), end: at(19) }, [{ days: [1], start: at(18), end: at(19, 30) }]).slot).toMatchObject({ start: at(19, 30), end: at(20, 30) })
  })

  it('never moves a range that is already accepted when another topic is suggested', () => {
    const value = state()
    const study = ensureCategory(value, 'study', 'study', 'Study')
    suggestRanges(value, study)
    study.ranges[0]!.accepted = true
    const before = structuredClone(study.ranges)
    suggestRanges(value, ensureCategory(value, 'learning', 'learning', 'Learning'))
    suggestRanges(value, addOwnCategory(value, 'Chess').category)
    expect(study.ranges).toEqual(before)
  })

  it('keeps a suggestion where it is when nothing fits, and the overlap is reported as a blocking issue', () => {
    const value = emptyState()
    value.answers.exercise = 'yes'
    const busy = ensureCategory(value, 'work', 'work', 'Work')
    value.answers.workStudy = 'work'
    busy.ranges.push({ key: 'busy', blockId: 'b-busy', days: [1, 3, 5], start: at(6), end: at(22), accepted: true, touched: false })
    busy.suggested = true
    const exercise = ensureCategory(value, 'exercise', 'exercise', 'Exercise')
    suggestRanges(value, exercise)
    expect(exercise.ranges[0]).toMatchObject({ start: at(18), end: at(19) })
    expect(validate(value, new Map()).map((issue) => issue.code)).toEqual(['overlap'])
  })

  it('"No fixed time" leaves a category with no ranges, and nothing blocks the save', () => {
    const value = emptyState()
    value.answers.exercise = 'yes'
    const exercise = ensureCategory(value, 'exercise', 'exercise', 'Exercise')
    suggestRanges(value, exercise)
    exercise.ranges = []
    expect(statusOf(value, exercise)).toBe('active')
    expect(validate(value, new Map())).toEqual([])
  })
})

describe('what the week adds up to (A20)', () => {
  const week = (...ranges: [number[], number, number][]) => {
    const value = emptyState()
    value.answers.more = ['custom:1']
    const own = ensureCategory(value, 'custom:1', undefined, 'Thing')
    ranges.forEach(([days, start, end], index) => own.ranges.push({ key: `r${index}`, blockId: `b${index}`, days: days as DayIndex[], start, end, accepted: true, touched: false }))
    return weekTotals(value)
  }
  const parts = (covered: number) => wholeHourParts([covered, 10080 - covered])

  it('counts 100 hours with 68 left', () => {
    const sleepAndWork = week([[0, 1, 2, 3, 4, 5, 6], at(23), at(7)], [[1, 2, 3, 4, 5], at(9), at(17)], [[6], at(10), at(14)])
    expect(sleepAndWork.overlapping).toBe(false)
    expect(parts(sleepAndWork.covered)).toEqual([100, 68])
  })

  it('counts exactly 168 hours with none left, and never a negative remainder', () => {
    const everything = week([[0, 1, 2, 3, 4, 5, 6], 0, at(12)], [[0, 1, 2, 3, 4, 5, 6], at(12), 0])
    expect(parts(everything.covered)).toEqual([168, 0])
  })

  it('counts overlapping time once: two blocks of 161 hours cover 161, leaving 7', () => {
    const doubled = week([[0, 1, 2, 3, 4, 5, 6], 0, at(23)], [[0, 1, 2, 3, 4, 5, 6], 0, at(23)])
    expect(doubled.summed).toBe(322 * 60)
    expect(doubled.overlapping).toBe(true)
    expect(parts(doubled.covered)).toEqual([161, 7])
    expect(coveredMinutes([{ days: [1], start: at(9), end: at(11) }, { days: [1], start: at(10), end: at(12) }])).toBe(180)
  })

  it('shows an overlapping total below 168 hours as the union, with the overlap flag', () => {
    const some = week([[1], at(9), at(17)], [[1], at(12), at(20)])
    expect(some.overlapping).toBe(true)
    expect(parts(some.covered)).toEqual([11, 157])
  })

  it('always adds up to 168 for any union size', () => {
    for (let hours = 0; hours <= 168; hours += 1) {
      const [assigned, free] = parts(hours * 60 + (hours % 2) * 30)
      expect(assigned + free).toBe(168)
    }
  })
})

describe('automatic goals', () => {
  it('floors "at least", ceils "at most", and falls back to no goal at zero', () => {
    expect(automaticGoal('min', 3 * 60 + 59)).toEqual({ type: 'min', hoursPerWeek: 3 })
    expect(automaticGoal('max', 40 * 60 + 1)).toEqual({ type: 'max', hoursPerWeek: 41 })
    expect(automaticGoal('min', 59)).toEqual({ type: 'none', hoursPerWeek: 0 })
    expect(automaticGoal('max', 0)).toEqual({ type: 'none', hoursPerWeek: 0 })
    expect(automaticGoal('none', 9999)).toEqual({ type: 'none', hoursPerWeek: 0 })
    expect(automaticGoal('max', 500 * 60)).toEqual({ type: 'max', hoursPerWeek: 168 })
  })
})

describe('pre-fill from what is stored', () => {
  it('maps categories to topics by icon, then name, keeps ids and converts sleep to nights', () => {
    const document = documentWith(
      [category('c-sleep', 'Rest', { icon: '😴' }), category('c-work', 'Work'), category('c-art', 'Painting')],
      [block('b-sleep', 'c-sleep', [1, 2], at(0, 30), at(8)), block('b-work', 'c-work', [3, 1, 2], at(9), at(17)), block('b-art', 'c-art', [6], at(10), at(12))],
    )
    const state = createState(document, env)
    expect(state.categories.map((item) => [item.key, item.categoryId, item.topic])).toEqual([['sleep', 'c-sleep', 'sleep'], ['work', 'c-work', 'work'], [expect.stringMatching(/^custom:/), 'c-art', undefined]])
    expect(state.categories[0]!.ranges[0]).toMatchObject({ blockId: 'b-sleep', days: [0, 1], accepted: true, touched: false })
    expect(state.categories[1]!.ranges[0]!.days).toEqual([3, 1, 2])
    expect(state.categories.every((item) => statusOf(state, item) === 'active')).toBe(true)
  })

  it('takes each topic at most once and leaves a renamed, iconless category as the person\'s own (A14)', () => {
    const document = documentWith([category('c-1', 'Work'), category('c-2', 'Work'), category('c-3', 'Oficina')])
    const state = createState(document, env)
    expect(state.categories.map((item) => item.topic)).toEqual(['work', undefined, undefined])
  })
})

describe('validation scope', () => {
  const stored = (items: [string, string][]) => new Map(items)

  it('does not block untouched stored content, even duplicates or overlaps, but blocks what was edited', () => {
    const document = documentWith(
      [category('a', 'Same'), category('b', 'Same')],
      [block('x', 'a', [1], at(9), at(12)), block('y', 'b', [1], at(10), at(13))],
    )
    const state = createState(document, env)
    const names = stored([['a', 'Same'], ['b', 'Same']])
    expect(validate(state, names)).toEqual([])
    state.categories[1]!.ranges[0]!.touched = true
    expect(validate(state, names).map((issue) => issue.code)).toEqual(['overlap'])
  })

  it('blocks a new range with no days, equal times, or a clash, and a new empty or duplicate name', () => {
    const state = emptyState()
    state.answers.more = ['custom:1', 'custom:2']
    const a = ensureCategory(state, 'custom:1', undefined, 'Chess')
    const b = ensureCategory(state, 'custom:2', undefined, ' chess ')
    a.ranges.push({ key: 'r1', days: [], start: 600, end: 700, accepted: false, touched: false })
    b.ranges.push({ key: 'r2', days: [1], start: 600, end: 600, accepted: false, touched: false })
    expect(validate(state, new Map()).map((issue) => issue.code).sort()).toEqual(['nameDuplicate', 'nameDuplicate', 'noDays', 'sameTime'])
    a.name = ''
    expect(validate(state, new Map()).map((issue) => issue.code)).toContain('nameRequired')
  })
})
