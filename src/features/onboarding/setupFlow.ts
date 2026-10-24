import { EXTRA_TOPICS } from './setupTopics'
import type { ScreenId, SetupState } from './setupModel'

// The screens a person walks through, recomputed from the answers so that going back always lands on the previous
// screen of the current sequence, whatever was changed on the way.

export const TOTAL_PARTS = 5

const CANONICAL: ScreenId[] = ['sleep', 'workStudy', 'work', 'study', 'commute', 'commuteRanges', 'exercise', 'exerciseRanges', 'more']

export function sequence(state: SetupState): ScreenId[] {
  const { answers } = state
  const screens: ScreenId[] = ['sleep', 'workStudy']
  if (answers.workStudy === 'work' || answers.workStudy === 'both') screens.push('work')
  if (answers.workStudy === 'study' || answers.workStudy === 'both') screens.push('study')
  const worksOrStudies = ['work', 'study', 'both'].includes(answers.workStudy)
  if (worksOrStudies) screens.push('commute')
  if (worksOrStudies && answers.commute === 'yes') screens.push('commuteRanges')
  screens.push('exercise')
  if (answers.exercise === 'yes') screens.push('exerciseRanges')
  screens.push('more')
  for (const key of answers.more ?? []) if (state.categories.some((category) => category.key === key)) screens.push(`extra:${key}`)
  screens.push('summary')
  return screens
}

// A position that stays meaningful for a screen that is no longer in the sequence.
function rank(state: SetupState, screen: ScreenId): number {
  const canonical = CANONICAL.indexOf(screen)
  if (canonical >= 0) return canonical
  if (screen === 'summary') return Number.MAX_SAFE_INTEGER
  const index = (state.answers.more ?? []).indexOf(screen.slice('extra:'.length))
  return CANONICAL.length + Math.max(index, 0)
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
  return screen.startsWith('extra:') && state.categories.some((category) => category.key === screen.slice('extra:'.length))
}

export { EXTRA_TOPICS }
