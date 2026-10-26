import { describe, expect, it } from 'vitest'
import { i18n, SUPPORTED_LOCALES } from '@/i18n'
import { sequence } from '../setupFlow'
import {
  addOwnCategory, addTyped, createAddState, emptyState, finishMore, intoKey, pick, prepareScreen, roundIndex, setAnswer, setPendingInto, setRemoved, setSleepSplit,
  MAX_PICKS, type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { block, category, documentWith, env } from '../setupFixtures'
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
  // Adding after setup: the frame, "Goes in", the summary's line and button, and what a save says.
  'onboarding.guided.add.title', 'onboarding.guided.add.goesIn', 'onboarding.guided.add.own', 'onboarding.guided.errors.destinationGone',
  'onboarding.summary.addSave', 'onboarding.summary.added', 'onboarding.summary.into', 'onboarding.summary.addFailed', 'onboarding.summary.addTitle',
  'onboarding.guided.add.yours',
  'week.editor.warnings.goalOver', 'week.editor.hours',
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
  // Adding after setup, from a week with stored categories and from an empty one, from both entries.
  const at = (hours: number) => hours * 60
  const stored = documentWith([category('c-work', 'Work', { icon: '💼' }), category('c-x', 'Chess')], [block('b-work', 'c-work', [1, 2, 3, 4, 5], at(9), at(17))])
  for (const document of [stored, documentWith()]) {
    for (const entry of ['routine', 'category'] as const) {
      const state = createAddState(document, entry, env)
      const keys = [...(entry === 'routine' && document === stored ? [intoKey('c-work')] : []), 'sleep', 'work', 'study', 'exercise', 'family']
      keys.forEach((key, index) => pick(state, index, key, env))
      if (entry === 'routine' && document === stored) setPendingInto(state, 'c-work')
      pick(state, keys.length, addTyped(state, 'Standup').key, env)
      finishMore(state, keys.length + 1)
      result.push(state)
      // Nothing picked at all: the summary has nothing to add.
      const nothing = createAddState(document, entry, env)
      finishMore(nothing, 0)
      result.push(nothing)
    }
  }
  const removed = emptyState()
  pick(removed, 0, 'family', env)
  setRemoved(removed, 'family', true)
  result.push(removed)
  return result
}

describe('every key the setup and the guided add compute exists in every language (S1-14, S2-16)', () => {
  for (const state of states()) walk(state)

  it('reaches the rounds of "Anything else?", their options and their way out', () => {
    for (const key of ['onboarding.guided.more.question', 'onboarding.guided.again.question', 'onboarding.guided.again.hint', 'onboarding.guided.again.done',
      'onboarding.guided.again.yes', 'onboarding.summary.addBubble', 'onboarding.summary.addEmpty', 'onboarding.guided.more.family', 'onboarding.guided.more.learning', 'onboarding.guided.extra.custom', 'onboarding.guided.skip',
      'onboarding.guided.add.question', 'onboarding.guided.add.hint', 'onboarding.guided.work.question', 'onboarding.guided.exerciseRanges.question',
      'onboarding.templates.sleep', 'onboarding.templates.study']) {
      expect(recorded.has(key), key).toBe(true)
    }
    expect([...recorded].filter((key) => (key as ScreenId).includes('more:'))).toEqual([])
  })

  it.each(SUPPORTED_LOCALES)('%s has each of them', (locale) => {
    const missing = [...recorded, ...ROUND_CONTROLS].filter((key) => !i18n.global.te(key, locale))
    expect(missing).toEqual([])
  })
})
