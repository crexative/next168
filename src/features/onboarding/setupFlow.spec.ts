import { describe, expect, it } from 'vitest'
import { isKnownScreen, nextScreen, partOf, previousScreen, sequence } from './setupFlow'
import { addOwnCategory, emptyState, ensureCategory, MAX_PICKS, setAnswer, type ScreenId, type SetupState, type Tri, type WorkStudy } from './setupModel'
import { env } from './setupFixtures'

const WORK_STUDY: WorkStudy[] = ['unanswered', 'work', 'study', 'both', 'neither']
const TRI: Tri[] = ['unanswered', 'yes', 'no']

function stateWith(workStudy: WorkStudy, commute: Tri, exercise: Tri, extras: 'none' | 'one' | 'two' | 'customs' | 'done'): SetupState {
  const state = emptyState()
  Object.assign(state.answers, { workStudy, commute, exercise })
  if (extras === 'none') return state
  ensureCategory(state, 'family', 'family', env.topicName('family'))
  if (extras === 'one') state.answers.more = ['family']
  if (extras === 'two') { ensureCategory(state, 'learning', 'learning', 'Learning'); state.answers.more = ['family', 'learning'] }
  if (extras === 'done') Object.assign(state.answers, { more: ['family'], moreDone: true })
  if (extras === 'customs') {
    const first = addOwnCategory(state, 'English class').category
    const second = addOwnCategory(state, 'Chess').category
    state.answers.more = ['family', first.key, second.key]
  }
  return state
}

// Written out separately from the implementation, from the table of screens in the design.
function expected(state: SetupState): ScreenId[] {
  const { workStudy, commute, exercise, more } = state.answers
  const screens: ScreenId[] = ['sleep', 'workStudy']
  if (workStudy === 'work' || workStudy === 'both') screens.push('work')
  if (workStudy === 'study' || workStudy === 'both') screens.push('study')
  if (['work', 'study', 'both'].includes(workStudy)) {
    screens.push('commute')
    if (commute === 'yes') screens.push('commuteRanges')
  }
  screens.push('exercise')
  if (exercise === 'yes') screens.push('exerciseRanges')
  // Each pick: its times, then "Anything else?" again (answered by the next pick, by "No, that's all", or still open).
  screens.push('more')
  for (const [index, key] of (more ?? []).entries()) screens.push(`extra:${key}`, `more:${index + 1}` as ScreenId)
  screens.push('summary')
  return screens
}

describe('the screen sequence (A1)', () => {
  const combos = WORK_STUDY.flatMap((ws) => TRI.flatMap((commute) => TRI.flatMap((exercise) => (['none', 'one', 'two', 'customs', 'done'] as const).map((extras) => [ws, commute, exercise, extras] as const))))

  it.each(combos)('workStudy %s, commute %s, exercise %s, extras %s', (ws, commute, exercise, extras) => {
    const state = stateWith(ws, commute, exercise, extras)
    const screens = sequence(state)
    expect(screens).toEqual(expected(state))
    // Forward and back walk the same list, one screen at a time, and the last screen is the summary.
    for (const [index, screen] of screens.entries()) {
      expect(nextScreen(state, screen)).toBe(screens[index + 1] ?? 'summary')
      expect(previousScreen(state, screen)).toBe(screens[index - 1])
    }
    expect(partOf('sleep')).toBe(1)
    expect(partOf('summary')).toBe(5)
  })

  it('numbers the parts: questions about sleep, work and study with the trip, exercise, everything else, the summary', () => {
    const parts = (['sleep', 'workStudy', 'work', 'study', 'commute', 'commuteRanges', 'exercise', 'exerciseRanges', 'more', 'extra:family', 'summary'] as const).map(partOf)
    expect(parts).toEqual([1, 2, 2, 2, 2, 2, 3, 3, 4, 4, 5])
  })

  it('keeps later answers when an earlier one changes, and Atrás follows the current sequence', () => {
    const state = stateWith('both', 'yes', 'yes', 'one')
    state.screen = 'commuteRanges'
    expect(previousScreen(state)).toBe('commute')
    expect(sequence(state)).toContain('study')
    // The person goes back and says "neither": work, study and the trip leave the sequence, their answers stay.
    setAnswer(state, 'workStudy', 'neither')
    expect(sequence(state)).toEqual(['sleep', 'workStudy', 'exercise', 'exerciseRanges', 'more', 'extra:family', 'more:1', 'summary'])
    expect(state.answers.commute).toBe('yes')
    // From a screen that vanished, Atrás and Siguiente still land on the neighbours in the new sequence.
    expect(previousScreen(state, 'commuteRanges')).toBe('workStudy')
    expect(nextScreen(state, 'commuteRanges')).toBe('exercise')
    // And saying "both" again brings every dormant screen back with its answer.
    setAnswer(state, 'workStudy', 'both')
    expect(sequence(state)).toEqual(expected(state))
    expect(state.answers).toMatchObject({ commute: 'yes', exercise: 'yes' })
    expect(sequence(state)).toContain('commuteRanges')
  })
})

describe('the rounds of "Anything else?"', () => {
  function picked(count: number): SetupState {
    const state = emptyState()
    state.answers.more = Array.from({ length: count }, (_, index) => addOwnCategory(state, `Thing ${index}`).category.key)
    return state
  }

  it('leaves no round open after MAX_PICKS picks, and a legacy draft with more keeps a round for each of them', () => {
    expect(sequence(picked(MAX_PICKS - 1)).at(-2)).toBe(`more:${MAX_PICKS - 1}`)
    const full = sequence(picked(MAX_PICKS))
    expect(full.at(-2)).toBe(`extra:custom:${MAX_PICKS}`)
    expect(full.filter((screen) => screen.startsWith('more'))).toHaveLength(MAX_PICKS)
    const legacy = picked(MAX_PICKS + 1)
    expect(sequence(legacy).filter((screen) => screen.startsWith('extra:'))).toHaveLength(MAX_PICKS + 1)
    expect(isKnownScreen(legacy, `more:${MAX_PICKS}`)).toBe(true)
    expect(isKnownScreen(legacy, `more:${MAX_PICKS + 1}`)).toBe(false)
  })

  it('knows a round only while it exists, and never "more:0"', () => {
    const state = picked(2)
    expect(['more', 'more:1', 'more:2', 'more:3', 'more:0', 'more:01'].map((screen) => isKnownScreen(state, screen))).toEqual([true, true, true, false, false, false])
  })

  it('goes from the times of something no longer picked to the summary, after every round', () => {
    const state = picked(1)
    ensureCategory(state, 'learning', 'learning', 'Learning')
    expect(nextScreen(state, 'extra:learning')).toBe('summary')
    expect(previousScreen(state, 'extra:learning')).toBe('more:1')
  })
})
