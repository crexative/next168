import { describe, expect, it } from 'vitest'
import { i18n, SUPPORTED_LOCALES } from '@/i18n'
import { sequence } from '../setupFlow'
import {
  addOwnCategory, emptyState, finishMore, pick, prepareScreen, roundIndex, setAnswer, setRemoved, setSleepSplit, MAX_PICKS,
  type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { env } from '../setupFixtures'
import { answer, extraReply, hint, question, roundReplies, type Speaker } from './conversation'

// Every key the setup computes at run time ("guided.more.<topic>", "guided.<screen>.question", the rounds' way out…)
// exists in every language. The keys are recorded through the Speaker while every reachable screen and option is
// walked, so a key that only some answers reach cannot be missed.
const recorded = new Set<string>()
const speaker: Speaker = {
  t: (key) => { recorded.add(key); return key },
  rangeLine: () => 'range',
}
const record = (line: { key: string } | undefined) => { if (line) recorded.add(line.key) }

// The round's own controls and the summary's limit, written in the templates rather than computed.
const ROUND_CONTROLS = [
  'onboarding.guided.current', 'onboarding.guided.more.other', 'onboarding.guided.more.otherLabel', 'onboarding.guided.more.otherPlaceholder',
  'onboarding.guided.more.add', 'onboarding.guided.more.duplicate', 'onboarding.guided.again.limit',
]

function walk(state: SetupState): void {
  for (const screen of sequence(state)) {
    prepareScreen(state, screen, env)
    state.screen = screen
    record(question(state, screen))
    record(hint(state, screen))
    record(extraReply(state, screen))
    answer(state, screen, speaker)
    const round = roundIndex(screen)
    if (round !== undefined) roundReplies(state, round, speaker)
  }
}

function states(): SetupState[] {
  const result: SetupState[] = []
  const workStudy: WorkStudy[] = ['unanswered', 'work', 'study', 'both', 'neither']
  const tri: Tri[] = ['unanswered', 'yes', 'no']
  for (const ws of workStudy) for (const commute of tri) for (const exercise of tri) {
    for (const ending of ['skipped', 'nothing', 'open', 'done', 'full'] as const) {
      const state = emptyState()
      Object.assign(state.answers, { sleep: 'yes', workStudy: ws, commute, exercise })
      if (ending !== 'skipped') state.answers.more = []
      if (ending === 'nothing') finishMore(state, 0)
      if (ending === 'open' || ending === 'done') {
        pick(state, 0, 'family', env)
        pick(state, 1, addOwnCategory(state, 'Guitar').category.key, env)
        pick(state, 2, 'friends', env)
        pick(state, 3, 'me', env)
        pick(state, 4, 'learning', env)
        if (ending === 'done') finishMore(state, 5)
      }
      if (ending === 'full') for (let index = 0; index < MAX_PICKS; index++) pick(state, index, addOwnCategory(state, `Thing ${index}`).category.key, env)
      result.push(state)
    }
  }
  const split = emptyState()
  setAnswer(split, 'sleep', 'yes')
  prepareScreen(split, 'sleep', env)
  setSleepSplit(split, true)
  result.push(split)
  const removed = emptyState()
  pick(removed, 0, 'family', env)
  setRemoved(removed, 'family', true)
  result.push(removed)
  return result
}

describe('every key the setup computes exists in every language (S1-14)', () => {
  for (const state of states()) walk(state)

  it('reaches the rounds of "Anything else?", their options and their way out', () => {
    for (const key of ['onboarding.guided.more.question', 'onboarding.guided.again.question', 'onboarding.guided.again.hint', 'onboarding.guided.again.done',
      'onboarding.guided.nothingElse', 'onboarding.guided.more.family', 'onboarding.guided.more.learning', 'onboarding.guided.extra.custom', 'onboarding.guided.skip']) {
      expect(recorded.has(key), key).toBe(true)
    }
    expect([...recorded].filter((key) => (key as ScreenId).includes('more:'))).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s has each of them', (locale) => {
    const missing = [...recorded, ...ROUND_CONTROLS].filter((key) => !i18n.global.te(key, locale))
    expect(missing).toEqual([])
  })
})
