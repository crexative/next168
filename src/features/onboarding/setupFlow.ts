import { EXTRA_TOPICS } from './setupTopics'
import { picksOf, roundExists, roundIndex, roundScreen, type ScreenId, type SetupState } from './setupModel'

// The screens a person walks through, recomputed from the answers so that going back always lands on the previous
// screen of the current sequence, whatever was changed on the way.

export const TOTAL_PARTS = 5

const CANONICAL: ScreenId[] = ['sleep', 'workStudy', 'work', 'study', 'commute', 'commuteRanges', 'exercise', 'exerciseRanges', 'more']

export function sequence(state: SetupState): ScreenId[] {
  const { answers } = state
  // Adding to a week asks only "What do you want to make time for?" and its rounds.
  const screens: ScreenId[] = state.add ? [] : ['sleep', 'workStudy']
  if (state.add) {
    screens.push(...rounds(state))
    return screens
  }
  if (answers.workStudy === 'work' || answers.workStudy === 'both') screens.push('work')
  if (answers.workStudy === 'study' || answers.workStudy === 'both') screens.push('study')
  const worksOrStudies = ['work', 'study', 'both'].includes(answers.workStudy)
  if (worksOrStudies) screens.push('commute')
  if (worksOrStudies && answers.commute === 'yes') screens.push('commuteRanges')
  screens.push('exercise')
  if (answers.exercise === 'yes') screens.push('exerciseRanges')
  screens.push(...rounds(state))
  return screens
}

// "Anything else?" asks again after each pick and its times, until the person says that is all; then the summary.
function rounds(state: SetupState): ScreenId[] {
  const screens: ScreenId[] = ['more']
  picksOf(state).forEach((key, index) => {
    if (state.categories.some((category) => category.key === key)) screens.push(`extra:${key}`)
    if (roundExists(state, index + 1)) screens.push(roundScreen(index + 1))
  })
  screens.push('summary')
  return screens
}

// A position that stays meaningful for a screen that is no longer in the sequence. Round i comes right after the
// pick before it, its pick's times right after it; the times of something no longer picked come after every round.
function rank(state: SetupState, screen: ScreenId): number {
  const canonical = CANONICAL.indexOf(screen)
  if (canonical >= 0) return canonical
  if (screen === 'summary') return Number.MAX_SAFE_INTEGER
  const base = CANONICAL.indexOf('more')
  const round = roundIndex(screen)
  if (round !== undefined) return base + 2 * round
  const picks = picksOf(state)
  const index = picks.indexOf(screen.slice('extra:'.length))
  return base + 2 * (index >= 0 ? index : picks.length) + 1
}

export function nextScreen(state: SetupState, from: ScreenId = state.screen): ScreenId {
  const here = rank(state, from)
  return sequence(state).find((screen) => rank(state, screen) > here) ?? 'summary'
}

export function previousScreen(state: SetupState, from: ScreenId = state.screen): ScreenId | undefined {
  const here = rank(state, from)
  const earlier = sequence(state).filter((screen) => rank(state, screen) < here)
  return earlier[earlier.length - 1]
}

export function partOf(screen: ScreenId): number {
  if (screen === 'sleep') return 1
  if (['workStudy', 'work', 'study', 'commute', 'commuteRanges'].includes(screen)) return 2
  if (screen === 'exercise' || screen === 'exerciseRanges') return 3
  if (screen === 'summary') return 5
  return 4
}

export function isKnownScreen(state: SetupState, screen: string): screen is ScreenId {
  if (screen === 'summary' || (CANONICAL as string[]).includes(screen)) return true
  const round = roundIndex(screen)
  if (round !== undefined) return roundExists(state, round)
  return screen.startsWith('extra:') && state.categories.some((category) => category.key === screen.slice('extra:'.length))
}

export { EXTRA_TOPICS }
