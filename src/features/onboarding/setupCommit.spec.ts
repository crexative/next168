import { describe, expect, it } from 'vitest'
import { canonicalJson } from '@/core/canonical'
import { validateDocument } from '@/core/documents'
import type { PlannerDocument } from '@/core/model'
import { CHANGED_ELSEWHERE } from '@/features/insights/entryGuard'
import { addGoalOverruns, applyAddPlan, applySetupPlan, planAddCommit, planSetupCommit, SETUP_INVALID, type SetupPlan } from './setupCommit'
import {
  addOwnCategory, addTyped, clearRanges, createAddState, createState, emptyState, ensureCategory, finishMore, intoKey, pick, prepareScreen, setPendingInto,
  setPendingName, setSleepSplit, suggestCommute, suggestRanges, touch, type SetupState,
} from './setupModel'
import { block, category, documentWith, env } from './setupFixtures'

const at = (hours: number, minutes = 0) => hours * 60 + minutes
let ids = 0
const newId = () => `n${++ids}`

function plan(state: SetupState, document: PlannerDocument): { plan: SetupPlan; empty: boolean } {
  const result = planSetupCommit(state, document, newId)
  if (result.kind !== 'plan') throw new Error(`expected a plan, got ${JSON.stringify(result)}`)
  return result
}

function apply(document: PlannerDocument, setupPlan: SetupPlan): PlannerDocument {
  const draft = structuredClone(document)
  applySetupPlan(draft, setupPlan)
  return validateDocument(draft)
}

const done = (overrides: Partial<PlannerDocument> = {}) => ({ settings: { ...documentWith().settings, onboardingDone: true }, ...overrides })

function firstRunState(): SetupState {
  const state = emptyState()
  Object.assign(state.answers, { sleep: 'yes', workStudy: 'work', commute: 'yes', exercise: 'yes', more: ['family'] })
  for (const [key, topic] of [['sleep', 'sleep'], ['work', 'work'], ['commute', 'commute'], ['exercise', 'exercise'], ['family', 'family']] as const) {
    const category = ensureCategory(state, key, topic, env.topicName(topic))
    if (topic === 'commute') suggestCommute(state, category)
    else suggestRanges(state, category)
    category.ranges.forEach((range) => { range.accepted = true })
  }
  return state
}

describe('the plan of a first setup', () => {
  it('creates categories with distinct colours, automatic goals that never fail, blocks and onboardingDone', () => {
    const empty = documentWith([], [], { settings: { ...documentWith().settings, onboardingDone: false } })
    const { plan: setupPlan } = plan(firstRunState(), empty)
    const result = apply(empty, setupPlan)
    expect(result.settings.onboardingDone).toBe(true)
    expect(result.categories.map((item) => item.name)).toEqual(['Sleep', 'Work', 'Commute', 'Exercise', 'Family'])
    expect(new Set(result.categories.map((item) => item.colorKey)).size).toBe(5)
    expect(result.categories.map((item) => item.goal)).toEqual([
      { type: 'min', hoursPerWeek: 56 }, { type: 'max', hoursPerWeek: 40 }, { type: 'none', hoursPerWeek: 0 }, { type: 'min', hoursPerWeek: 3 }, { type: 'none', hoursPerWeek: 0 },
    ])
    // Sleep is one block per day set, written as a block that starts on the evening; commute is there and back.
    expect(result.blocks.filter((item) => item.title === 'Sleep')).toEqual([expect.objectContaining({ days: [0, 1, 2, 3, 4, 5, 6], start: at(23), end: at(7) })])
    expect(result.blocks.filter((item) => item.title === 'Commute')).toHaveLength(2)
    expect(result.tasks).toEqual([])
  })

  it('gives a new category a colour no kept category uses (A37)', () => {
    const stored = documentWith([category('c-1', 'Reading', { colorKey: 'purple' })], [], done())
    const state = emptyState()
    state.answers.sleep = 'yes'
    suggestRanges(state, ensureCategory(state, 'sleep', 'sleep', 'Sleep'))
    const { plan: setupPlan } = plan(state, stored)
    expect(setupPlan.newCategories[0]!.colorKey).not.toBe('purple')
  })

  it('writes nothing for an empty setup but onboardingDone, and nothing at all when that is already true', () => {
    const fresh = documentWith([], [], { settings: { ...documentWith().settings, onboardingDone: false } })
    const skipped = plan(emptyState(), fresh)
    expect(skipped.empty).toBe(false)
    expect(apply(fresh, skipped.plan)).toMatchObject({ categories: [], blocks: [], settings: { onboardingDone: true } })
    expect(plan(emptyState(), documentWith([], [], done())).empty).toBe(true)
  })
})

describe('re-entry keeps what is stored (A12, A13, A14, A38)', () => {
  const stored = () => documentWith(
    [category('c-sleep', 'Sleep', { icon: '😴' }), category('c-work', 'Work', { icon: '💼' }), category('c-office', 'Oficina')],
    [
      block('b-sleep', 'c-sleep', [6, 5, 4, 3, 2, 1, 0], at(23), at(7), { title: 'Sleep' }),
      block('b-work', 'c-work', [3, 1, 2, 4, 5], at(9), at(17), { title: 'Work', notes: 'Keep this' }),
      block('b-sync', 'c-work', [3], at(17), at(18), { title: 'Weekly sync', notes: 'Room 4' }),
      block('b-office', 'c-office', [1], at(8), at(9), { title: 'Oficina' }),
    ],
    { ...done(), tasks: [{ id: 't1', title: 'Report', categoryId: 'c-work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }] },
  )

  it('plans nothing when nothing changed, even with unsorted stored days (A12)', () => {
    const state = createState(stored(), env)
    expect(plan(state, stored()).empty).toBe(true)
  })

  it('changes one end time in place: same ids, notes and custom title kept, task untouched, revision-free diff (A14)', () => {
    const document = stored()
    const state = createState(document, env)
    const work = state.categories.find((item) => item.topic === 'work')!
    Object.assign(work.ranges[0]!, { end: at(16, 30), touched: true })
    const { plan: setupPlan, empty } = plan(state, document)
    expect(empty).toBe(false)
    expect(setupPlan).toMatchObject({ newCategories: [], newBlocks: [], blockDeletes: [], categoryDeletes: [], renames: [], blockUpdates: [{ id: 'b-work', end: at(16, 30), start: at(9), days: [1, 2, 3, 4, 5] }] })
    const result = apply(document, setupPlan)
    expect(result.blocks.find((item) => item.id === 'b-work')).toMatchObject({ notes: 'Keep this', title: 'Work', end: at(16, 30) })
    expect(result.blocks.find((item) => item.id === 'b-sync')).toEqual(document.blocks.find((item) => item.id === 'b-sync'))
    expect(result.tasks).toEqual(document.tasks)
    expect(result.categories.map((item) => item.id)).toEqual(['c-sleep', 'c-work', 'c-office'])
  })

  it('answering "Work" when only "Oficina" exists adds a second, visible category and leaves Oficina alone', () => {
    const document = documentWith([category('c-office', 'Oficina')], [block('b-office', 'c-office', [1], at(8), at(9), { title: 'Oficina' })], done())
    const state = createState(document, env)
    state.answers.workStudy = 'work'
    suggestRanges(state, ensureCategory(state, 'work', 'work', 'Work'))
    expect(state.categories.map((item) => item.name)).toEqual(['Oficina', 'Work'])
    const result = apply(document, plan(state, document).plan)
    expect(result.categories.map((item) => item.name)).toEqual(['Oficina', 'Work'])
    expect(result.blocks.find((item) => item.id === 'b-office')).toEqual(document.blocks[0])
  })

  it('renames a category: blocks titled with the old name follow, custom titles and notes stay (A38)', () => {
    const document = stored()
    const state = createState(document, env)
    state.categories.find((item) => item.topic === 'work')!.name = 'Oficina 2'
    const result = apply(document, plan(state, document).plan)
    expect(result.categories.find((item) => item.id === 'c-work')).toMatchObject({ name: 'Oficina 2', icon: '💼' })
    expect(result.blocks.find((item) => item.id === 'b-work')).toMatchObject({ title: 'Oficina 2', notes: 'Keep this' })
    expect(result.blocks.find((item) => item.id === 'b-sync')).toMatchObject({ title: 'Weekly sync', notes: 'Room 4' })
  })

  it('removes a range\'s block when the range is removed', () => {
    const document = stored()
    const state = createState(document, env)
    const work = state.categories.find((item) => item.topic === 'work')!
    work.ranges = work.ranges.filter((range) => range.blockId !== 'b-sync')
    expect(plan(state, document).plan.blockDeletes).toEqual(['b-sync'])
  })
})

describe('valid legacy content stays valid (A13)', () => {
  it('opens and saves unchanged with no write, then edits one range and leaves everything else byte-identical', () => {
    const categories = Array.from({ length: 31 }, (_, index) => category(`c${index}`, index < 2 ? 'Twin' : `Thing ${index}`))
    const blocks = [
      ...Array.from({ length: 11 }, (_, index) => block(`many${index}`, 'c2', [1], at(index), at(index) + 30)),
      ...categories.slice(3).map((item, index) => block(`b-${item.id}`, item.id, [2], index * 40, index * 40 + 30)),
    ]
    const document = documentWith(categories, blocks, done())
    const state = createState(document, env)
    expect(plan(state, document).empty).toBe(true)
    Object.assign(state.categories[5]!.ranges[0]!, { end: state.categories[5]!.ranges[0]!.start + 35, touched: true })
    const { plan: setupPlan } = plan(state, document)
    expect(setupPlan.blockUpdates).toHaveLength(1)
    const result = apply(document, setupPlan)
    const untouched = (item: { id: string }) => item.id !== state.categories[5]!.ranges[0]!.blockId
    expect(canonicalJson(result.categories)).toBe(canonicalJson(document.categories))
    expect(canonicalJson(result.blocks.filter(untouched))).toBe(canonicalJson(document.blocks.filter(untouched)))
    expect(result.categories).toHaveLength(31)
  })

  it('refuses a result over the model limits with a message instead of a failed write', () => {
    const categories = Array.from({ length: 100 }, (_, index) => category(`c${index}`, `Thing ${index}`))
    const document = documentWith(categories, [], done())
    const state = createState(document, env)
    state.answers.exercise = 'yes'
    suggestRanges(state, ensureCategory(state, 'exercise', 'exercise', 'Exercise'))
    expect(planSetupCommit(state, document, newId).kind).toBe('tooLarge')
  })
})

describe('removing (A22)', () => {
  const stored = () => documentWith(
    [category('c-family', 'Family', { icon: '👨‍👩‍👧' }), category('c-gym', 'Exercise', { icon: '🏃' })],
    [block('b-family', 'c-family', [6], at(10), at(14)), block('b-gym', 'c-gym', [1], at(18), at(19))],
    { ...done(), tasks: [{ id: 't1', title: 'Run', categoryId: 'c-gym', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }] },
  )

  it('deletes a category without tasks together with its blocks', () => {
    const document = stored()
    const state = createState(document, env)
    state.categories.find((item) => item.topic === 'family')!.removed = true
    const result = apply(document, plan(state, document).plan)
    expect(result.categories.map((item) => item.id)).toEqual(['c-gym'])
    expect(result.blocks.map((item) => item.id)).toEqual(['b-gym'])
  })

  it('keeps a category with tasks and drops only its blocks when the answer is "no"', () => {
    const document = stored()
    const state = createState(document, env)
    state.answers.exercise = 'no'
    const { plan: setupPlan } = plan(state, document)
    expect(setupPlan.keptForTasks).toEqual(['c-gym'])
    const result = apply(document, setupPlan)
    expect(result.categories.map((item) => item.id)).toEqual(['c-family', 'c-gym'])
    expect(result.blocks.map((item) => item.id)).toEqual(['b-family'])
    expect(result.tasks).toEqual(document.tasks)
  })

  it('aborts the whole commit when a category cannot be removed cleanly', () => {
    const document = stored()
    const forced: SetupPlan = { newCategories: [], renames: [], newBlocks: [], blockUpdates: [], blockDeletes: [], categoryDeletes: ['c-gym'], keptForTasks: [], onboardingDone: false }
    expect(() => applySetupPlan(structuredClone(document), forced)).toThrow(SETUP_INVALID)
  })
})

describe('the plan\'s blocking checks', () => {
  it('returns the issues instead of a plan', () => {
    const state = emptyState()
    state.answers.more = ['custom:1']
    addOwnCategory(state, 'Chess')
    state.categories[0]!.ranges.push({ key: 'r', days: [], start: 60, end: 120, accepted: false, touched: false })
    state.answers.more = [state.categories[0]!.key]
    const result = planSetupCommit(state, documentWith(), newId)
    expect(result).toMatchObject({ kind: 'invalid', issues: [{ code: 'noDays' }] })
  })

  it('writes a split sleep as two blocks', () => {
    const state = emptyState()
    state.answers.sleep = 'yes'
    suggestRanges(state, ensureCategory(state, 'sleep', 'sleep', 'Sleep'))
    setSleepSplit(state, true)
    const result = apply(documentWith(), plan(state, documentWith()).plan)
    expect(result.blocks.map((item) => [item.days, item.start, item.end])).toEqual([[[0, 1, 2, 3, 4], at(23), at(7)], [[0, 6], 0, at(8)]])
  })
})

describe('stored extras and own categories outside the rounds (S1-7)', () => {
  const document = () => documentWith(
    [category('c-family', 'Family', { icon: '👨‍👩‍👧' }), category('c-chess', 'Ajedrez')],
    [block('b-fam', 'c-family', [6], at(10), at(14), { title: 'Family' }), block('b-chess', 'c-chess', [2], at(18), at(19), { title: 'Ajedrez' })],
    done(),
  )

  it('keeps both when the rounds pick something else and end with "Nothing else"', () => {
    const state = createState(document(), env)
    pick(state, 0, 'friends', env)
    prepareScreen(state, 'extra:friends', env)
    finishMore(state, 1)
    const { plan: setupPlan } = plan(state, document())
    expect(setupPlan).toMatchObject({ blockDeletes: [], categoryDeletes: [], blockUpdates: [], newCategories: [expect.objectContaining({ name: 'Friends' })] })
    const empty = createState(document(), env)
    finishMore(empty, 0)
    expect(plan(empty, document()).empty).toBe(true)
  })

  it('writes exactly one block update for an explicit edit in the summary', () => {
    const state = createState(document(), env)
    finishMore(state, 0)
    touch(state.categories.find((item) => item.key === 'family')!.ranges[0]!, { end: at(15) })
    expect(plan(state, document()).plan).toMatchObject({ blockUpdates: [{ id: 'b-fam', end: at(15) }], blockDeletes: [], categoryDeletes: [], newBlocks: [], newCategories: [] })
  })
})

describe('adding after setup writes additions only (S2-8, S2-9)', () => {
  const stored = () => documentWith(
    [category('c-sleep', 'Sleep', { icon: '😴', colorKey: 'purple' }), category('c-work', 'Work', { icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } })],
    [block('b-sleep', 'c-sleep', [0, 1, 2, 3, 4, 5, 6], at(23), at(7), { title: 'Sleep' }), block('b-work', 'c-work', [1, 2, 3, 4, 5], at(9), at(17), { title: 'Work', notes: 'Keep' })],
    { ...done(), tasks: [{ id: 't1', title: 'Report', categoryId: 'c-work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }] },
  )
  const addPlan = (state: SetupState, document = stored()) => {
    const result = planAddCommit(state, document, newId)
    if (result.kind !== 'plan') throw new Error(JSON.stringify(result))
    return result.plan
  }
  const adds = (state: SetupState, key: string) => {
    pick(state, state.answers.more?.length ?? 0, key, env)
    prepareScreen(state, `extra:${key}`, env)
  }

  it.each([
    ['time for a stored category', (state: SetupState) => adds(state, intoKey('c-work'))],
    ['"No fixed time" on time for a stored category', (state: SetupState) => { adds(state, intoKey('c-work')); clearRanges(state.categories[0]!) }],
    ['a new Sleep split into weeknights and weekend', (state: SetupState) => { const empty = createAddState(documentWith([], [], done()), 'routine', env); Object.assign(state, empty); adds(state, 'sleep'); setSleepSplit(state, true) }],
    ['something of one\'s own going into Work', (state: SetupState) => { setPendingName(state, 'Standup'); setPendingInto(state, 'c-work'); adds(state, addTyped(state, 'Standup').key) }],
    ['a new topic and something of one\'s own', (state: SetupState) => { adds(state, 'exercise'); adds(state, addTyped(state, 'Guitar').key) }],
  ])('%s: only new categories and blocks, stored records byte-equal', (_name, build) => {
    const document = stored()
    const state = createAddState(document, 'routine', env)
    build(state)
    const plan = addPlan(state, document)
    expect(Object.keys(plan).sort()).toEqual(['newBlocks', 'newCategories'])
    const draft = structuredClone(document)
    applyAddPlan(draft, plan)
    const result = validateDocument(draft)
    expect(canonicalJson(result.categories.slice(0, 2))).toBe(canonicalJson(document.categories))
    expect(canonicalJson(result.blocks.filter((item) => document.blocks.some((old) => old.id === item.id)))).toBe(canonicalJson(document.blocks))
    expect(result.tasks).toEqual(document.tasks)
    expect(result.settings).toEqual(document.settings)
  })

  it('writes the split sleep as two blocks of a new Sleep category', () => {
    const document = documentWith([], [], done())
    const state = createAddState(document, 'category', env)
    adds(state, 'sleep')
    setSleepSplit(state, true)
    const plan = addPlan(state, document)
    expect(plan.newCategories).toEqual([expect.objectContaining({ name: 'Sleep', icon: '😴' })])
    expect(plan.newBlocks.map((item) => [item.days, item.start, item.end])).toEqual([[[0, 1, 2, 3, 4], at(23), at(7)], [[0, 6], 0, at(8)]])
  })

  it('refuses a destination that is not in the document, and the commit refuses one deleted after the plan', () => {
    const document = stored()
    const state = createAddState(document, 'routine', env)
    adds(state, intoKey('c-work'))
    const gone = { ...document, categories: document.categories.filter((item) => item.id !== 'c-work'), blocks: document.blocks.filter((item) => item.categoryId !== 'c-work'), tasks: [] }
    expect(planAddCommit(state, gone, newId)).toMatchObject({ kind: 'invalid', issues: [{ code: 'destinationGone' }] })
    const plan = addPlan(state, document)
    expect(() => applyAddPlan(structuredClone(gone), plan)).toThrow(CHANGED_ELSEWHERE)
  })

  it('gives a new category its topic colour when unused, else the first unused one', () => {
    const document = documentWith([category('c-x', 'X', { colorKey: 'pink' })], [], done())
    const state = createAddState(document, 'category', env)
    adds(state, 'family')
    adds(state, 'friends')
    expect(addPlan(state, document).newCategories.map((item) => item.colorKey)).toEqual(['blue', 'red'])
  })

  it('adds up what goes into a stored "at most" goal over every new range', () => {
    const document = stored()
    const state = createAddState(document, 'routine', env)
    adds(state, intoKey('c-work'))
    expect(addGoalOverruns(state, document).get('c-work')).toBe(5 * 60)
    setPendingName(state, 'Standup')
    setPendingInto(state, 'c-work')
    adds(state, addTyped(state, 'Standup').key)
    expect(addGoalOverruns(state, document).get('c-work')).toBe(10 * 60)
  })
})
