import { describe, expect, it } from 'vitest'
import type { DayIndex } from '@/core/model'
import { wholeHourParts } from '@/ui/format'
import {
  addOwnCategory, addToStored, addTyped, keepSeparate, nameKey, appendFromSummary, automaticGoal, createAddState, intoKey, rangeProblem, setPendingInto, setPendingName, blockToSleep, categoryOf, coveredMinutes, createState, deriveCommute, emptyState, ensureCategory,
  finishMore, MAX_PICKS, pick, placeSlot, roundOptions, setRemoved, sleepToBlock, slotMinutes, statusOf, suggestCommute, suggestRanges, touch,
  validate, weekTotals, type RangeDraft, type SetupState,
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
      const [assigned = 0, free = 0] = parts(hours * 60 + (hours % 2) * 30)
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

// Round-6 verification (D6): moving exercise from 6:00 to 6:30 kept the end at 7:00 and shrank it to 30 min; moving the
// commute start past its end turned it into an overnight range.
describe('moving a start time', () => {
  const range = (start: number, end: number, extra: Partial<RangeDraft> = {}): RangeDraft => ({ key: 'r', days: [1, 3, 5], start, end, accepted: true, touched: false, ...extra })

  it('keeps the length: exercise 6:00–7:00 moved to 6:30 ends at 7:30', () => {
    const exercise = range(at(6), at(7))
    touch(exercise, { start: at(6, 30) })
    expect([exercise.start, exercise.end]).toEqual([at(6, 30), at(7, 30)])
  })

  it('never turns a daytime range overnight: the trip 8:30–9:00 moved to 9:30 ends at 10:00', () => {
    const trip = range(at(8, 30), at(9))
    touch(trip, { start: at(9, 30) })
    expect([trip.start, trip.end]).toEqual([at(9, 30), at(10)])
  })

  it('leaves an end the person picked, while the start stays before it', () => {
    const work = range(at(9), at(17))
    touch(work, { end: at(18) })
    touch(work, { start: at(10) })
    expect([work.start, work.end]).toEqual([at(10), at(18)])
  })

  it('moves a picked end too when the start passes it, rather than crossing midnight', () => {
    const trip = range(at(8, 30), at(9))
    touch(trip, { end: at(9, 15) })
    touch(trip, { start: at(9, 30) })
    expect([trip.start, trip.end]).toEqual([at(9, 30), at(10, 15)])
  })

  it('stops a daytime range at midnight instead of spilling into the next day', () => {
    const evening = range(at(22), at(23, 30))
    touch(evening, { start: at(23) })
    expect([evening.start, evening.end]).toEqual([at(23), 0])
  })

  it('a range stopped at midnight stays a daytime range on the next start edits', () => {
    const evening = range(at(22), at(23, 30))
    touch(evening, { start: at(23) })
    touch(evening, { start: at(23, 30) })
    expect([evening.start, evening.end]).toEqual([at(23, 30), 0])
    touch(evening, { start: at(21) })
    expect([evening.start, evening.end]).toEqual([at(21), at(21, 30)])
    const picked = range(at(20), at(21))
    touch(picked, { end: 0 })
    touch(picked, { start: at(23, 30) })
    expect([picked.start, picked.end]).toEqual([at(23, 30), 0])
  })

  it('a midnight end the person picked stays when the start moves earlier', () => {
    const late = range(at(20), at(22))
    touch(late, { end: 0 })
    touch(late, { start: at(19) })
    expect([late.start, late.end]).toEqual([at(19), 0])
  })

  it('lets sleep, and a range that already crossed midnight, go on into the next day', () => {
    const sleep = range(at(23), at(7))
    touch(sleep, { start: at(23, 30) }, true)
    expect([sleep.start, sleep.end]).toEqual([at(23, 30), at(7, 30)])
    const nightShift = range(at(22), at(6))
    touch(nightShift, { start: at(23) })
    expect([nightShift.start, nightShift.end]).toEqual([at(23), at(7)])
  })

  it('an end the person picks before the start is theirs to make', () => {
    const late = range(at(20), at(22))
    touch(late, { end: at(1) })
    expect([late.start, late.end]).toEqual([at(20), at(1)])
  })
})

describe('"Anything else?": one pick per round (S1-4, S1-5, S1-6, S1-7, S1-9)', () => {
  const own = (state: SetupState, name: string) => addOwnCategory(state, name).category.key

  it('appends at the round after the last pick and opens the next one; replaces below it and keeps the rest', () => {
    const state = emptyState()
    expect(pick(state, 0, 'family', env)).toBe(true)
    expect(state.answers).toMatchObject({ more: ['family'], moreDone: false })
    expect(pick(state, 1, 'friends', env)).toBe(true)
    finishMore(state, 2)
    expect(pick(state, 0, 'learning', env)).toBe(true)
    expect(state.answers).toMatchObject({ more: ['learning', 'friends'], moreDone: true })
    // Picking at the round answered "No, that's all" adds another pick and leaves the round after it open.
    expect(pick(state, 2, 'me', env)).toBe(true)
    expect(state.answers).toMatchObject({ more: ['learning', 'friends', 'me'], moreDone: false })
    expect(pick(state, 4, 'family', env)).toBe(false)
  })

  it('reaffirms a round\'s own answer without changing anything, and refuses a key picked in another round (N8)', () => {
    const state = emptyState()
    pick(state, 0, 'family', env)
    pick(state, 1, 'friends', env)
    const before = JSON.stringify(state)
    expect(pick(state, 0, 'family', env)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    expect(pick(state, 1, 'family', env)).toBe(false)
    expect(pick(state, 2, 'friends', env)).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('"No, that\'s all" drops the later picks, which keep their edited times when picked again (S1-5)', () => {
    const state = emptyState()
    pick(state, 0, 'family', env)
    suggestRanges(state, categoryOf(state, 'family')!)
    touch(categoryOf(state, 'family')!.ranges[0]!, { end: at(15) })
    pick(state, 0, 'friends', env)
    expect(statusOf(state, categoryOf(state, 'family')!)).toBe('inactive')
    pick(state, 1, 'family', env)
    expect(categoryOf(state, 'family')!.ranges[0]!.end).toBe(at(15))
    finishMore(state, 1)
    expect(state.answers).toMatchObject({ more: ['friends'], moreDone: true })
    expect(statusOf(state, categoryOf(state, 'family')!)).toBe('inactive')
  })

  it('offers the extras and the person\'s own, minus every pick but the round\'s own answer, removed picks included (S1-6)', () => {
    const state = emptyState()
    const chess = own(state, 'Chess')
    own(state, '  ')
    pick(state, 0, 'family', env)
    pick(state, 1, chess, env)
    expect(roundOptions(state, 0)).toEqual(['family', 'friends', 'me', 'learning'])
    expect(roundOptions(state, 2)).toEqual(['friends', 'me', 'learning'])
    setRemoved(state, 'family', true)
    expect(roundOptions(state, 2)).toEqual(['friends', 'me', 'learning'])
    expect(pick(state, 2, 'family', env)).toBe(false)
    setRemoved(state, 'family', false)
    expect(statusOf(state, categoryOf(state, 'family')!)).toBe('active')
  })

  it('never offers or picks a stored extra or own category, which stays in the week whatever the rounds say (S1-7)', () => {
    const document = documentWith([category('c-family', 'Family', { icon: '👨‍👩‍👧' }), category('c-chess', 'Chess')], [block('b-family', 'c-family', [6], at(10), at(14))])
    const state = createState(document, env)
    expect(roundOptions(state, 0)).toEqual(['friends', 'me', 'learning'])
    expect(pick(state, 0, 'family', env)).toBe(false)
    expect(pick(state, 0, 'custom:1', env)).toBe(false)
    pick(state, 0, 'friends', env)
    finishMore(state, 1)
    expect(state.categories.map((item) => statusOf(state, item))).toEqual(['active', 'active', 'active'])
    finishMore(state, 0)
    expect(state.categories.filter((item) => item.categoryId).map((item) => statusOf(state, item))).toEqual(['active', 'active'])
  })

  it('stops adding at MAX_PICKS, from a round and from the summary (S1-9)', () => {
    const state = emptyState()
    for (let index = 0; index < MAX_PICKS; index++) expect(pick(state, index, own(state, `Thing ${index}`), env)).toBe(true)
    expect(pick(state, MAX_PICKS, own(state, 'One more'), env)).toBe(false)
    expect(appendFromSummary(state, '')).toBe(false)
    expect(state.answers.more).toHaveLength(MAX_PICKS)
    // Replacing a pick is still possible at the limit.
    expect(pick(state, 0, 'family', env)).toBe(true)
  })

  it('"Add something else" in the summary picks a new item of the person\'s own after the others', () => {
    const state = emptyState()
    const added = appendFromSummary(state, '')
    expect(added).not.toBe(false)
    expect(state.answers).toMatchObject({ more: [(added as { key: string }).key], moreDone: true })
    pick(state, 1, 'family', env)
    expect(state.answers.more).toEqual([(added as { key: string }).key, 'family'])
  })
})

describe('adding after setup (S2-1, S2-3, S2-6, S2-14)', () => {
  const document = () => documentWith(
    [category('c-sleep', 'Sleep', { icon: '😴' }), category('c-work', 'Work', { icon: '💼' }), category('c-r1', 'Reading'), category('c-r2', 'reading ')],
    [block('b-work', 'c-work', [1, 2, 3, 4, 5], at(9), at(17)), block('b-sat', 'c-r1', [6], at(6), at(22))],
  )

  it('offers the topics the week lacks, then its stored categories when adding a routine; Settings offers no stored one', () => {
    expect(roundOptions(createAddState(document(), 'routine', env), 0)).toEqual(
      ['study', 'exercise', 'family', 'friends', 'me', 'learning', 'into:c-sleep', 'into:c-work', 'into:c-r1', 'into:c-r2'])
    expect(roundOptions(createAddState(document(), 'category', env), 0)).toEqual(['study', 'exercise', 'family', 'friends', 'me', 'learning'])
  })

  it('counts what is picked, whatever the setup answers would say, and holds no stored category', () => {
    const state = createAddState(document(), 'routine', env)
    pick(state, 0, 'exercise', env)
    state.answers.exercise = 'no'
    expect(statusOf(state, categoryOf(state, 'exercise')!)).toBe('active')
    expect(state.categories.every((item) => item.categoryId === undefined)).toBe(true)
    pick(state, 0, intoKey('c-work'), env)
    expect(categoryOf(state, intoKey('c-work'))).toMatchObject({ into: 'c-work', name: 'Work' })
    expect(statusOf(state, categoryOf(state, 'exercise')!)).toBe('inactive')
  })

  it('pre-selects "Goes in" only for exactly one stored category of that name, and only until the person chooses (N4)', () => {
    const state = createAddState(document(), 'routine', env)
    setPendingName(state, ' work')
    expect(state.pending).toEqual({ name: ' work', into: 'c-work' })
    setPendingName(state, 'Reading')
    expect(state.pending).toEqual({ name: 'Reading' })
    setPendingName(state, 'Work')
    setPendingInto(state, undefined)
    setPendingName(state, 'Work ')
    expect(state.pending).toEqual({ name: 'Work ', intoTouched: true })
    const own = addTyped(state, 'Work')
    expect(own.into).toBeUndefined()
    setPendingInto(state, 'c-sleep')
    expect(addTyped(state, 'Nap').into).toBe('c-sleep')
    const settings = createAddState(document(), 'category', env)
    setPendingName(settings, 'Work')
    expect(settings.pending).toEqual({ name: 'Work', into: 'c-work' })
  })

  it('never duplicates a stored activity silently, whatever the case, accents or spaces (P0-4)', () => {
    const accented = documentWith([category('c-work', 'Work'), category('c-edu', 'Educación')])
    expect(nameKey(' EDUCACION  ')).toBe(nameKey('Educación'))
    const state = createAddState(accented, 'category', env)
    setPendingName(state, 'educacion ')
    expect(state.pending).toMatchObject({ into: 'c-edu' })
    expect(addTyped(state, 'educacion ')).toMatchObject({ into: 'c-edu' })
    // The summary path: a free-standing draft with a stored name blocks the save until the person decides.
    const free = createAddState(accented, 'category', env)
    const draft = ensureCategory(free, 'custom:9', undefined, 'EDUCACIÓN')
    free.answers.more = ['custom:9']
    expect(validate(free, new Map()).map((issue) => issue.code)).toContain('nameDuplicate')
    keepSeparate(draft)
    expect(validate(free, new Map()).map((issue) => issue.code)).not.toContain('nameDuplicate')
    addToStored(draft, 'c-edu')
    expect(draft).toMatchObject({ into: 'c-edu' })
    expect(validate(free, new Map()).map((issue) => issue.code)).not.toContain('nameDuplicate')
  })

  it('places suggestions clear of stored blocks, and names the stored one a range clashes with', () => {
    const state = createAddState(document(), 'routine', env)
    pick(state, 0, 'family', env)
    const family = categoryOf(state, 'family')!
    suggestRanges(state, family)
    expect(rangeProblem(state, family, family.ranges[0]!)).toMatchObject({ code: 'overlap', with: { categoryKey: 'c-r1', name: 'Reading' } })
    pick(state, 1, 'exercise', env)
    const exercise = categoryOf(state, 'exercise')!
    suggestRanges(state, exercise)
    expect(rangeProblem(state, exercise, exercise.ranges[0]!)).toBeUndefined()
  })
})
