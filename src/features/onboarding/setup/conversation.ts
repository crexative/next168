import { sequence } from '../setupFlow'
import { categoryOf, commuteBase, moreSelection, statusOf, type CategoryDraft, type CategoryStatus, type RangeDraft, type ScreenId, type SetupState } from '../setupModel'
import { EXTRA_TOPICS } from '../setupTopics'

// What the conversation says: each question phrased from the answers before it, the answer bubble in plain words, and
// which earlier exchanges stay on screen. Pure functions over the draft, so every phrasing is testable without a screen.

export interface Speaker {
  t(key: string, params?: Record<string, unknown>): string
  rangeLine(category: CategoryDraft, range: RangeDraft): string
}

export interface Line { key: string; params?: Record<string, unknown> }

// The category whose ranges a screen asks about.
export function categoryFor(state: SetupState, screen: ScreenId): CategoryDraft | undefined {
  if (screen === 'sleep' || screen === 'work' || screen === 'study') return categoryOf(state, screen)
  if (screen === 'exerciseRanges') return categoryOf(state, 'exercise')
  if (screen === 'commuteRanges') return categoryOf(state, 'commute')
  return screen.startsWith('extra:') ? categoryOf(state, screen.slice('extra:'.length)) : undefined
}

export const isRangeScreen = (state: SetupState, screen: ScreenId): boolean => screen !== 'more' && screen !== 'summary' && categoryFor(state, screen) !== undefined

// The reply offered beside the answer controls, and how it is drawn: skipping the question ("Later") is a quiet text
// button, so it never competes with the answers or with Send; "No fixed time" is an answer like any other and looks like
// one. This is the one place that decides which reply is a skip and which an answer.
export type ExtraReplyKind = 'skip' | 'answer'
export interface ExtraReply { key: string; kind: ExtraReplyKind }
const EXTRA_REPLY_KIND = { skip: 'skip', noFixedTime: 'answer' } as const satisfies Record<string, ExtraReplyKind>
const SKIPPABLE: ScreenId[] = ['sleep', 'workStudy', 'commute', 'exercise', 'more']

export function extraReply(state: SetupState, screen: ScreenId): ExtraReply | undefined {
  const reply = isRangeScreen(state, screen) && screen !== 'sleep' ? 'noFixedTime' : SKIPPABLE.includes(screen) ? 'skip' : undefined
  return reply === undefined ? undefined : { key: `onboarding.guided.${reply}`, kind: EXTRA_REPLY_KIND[reply] }
}

// Where the person goes on the way: to work, to class, or either.
function destination(state: SetupState): 'work' | 'study' | 'both' | undefined {
  const { workStudy } = state.answers
  return workStudy === 'work' || workStudy === 'study' || workStudy === 'both' ? workStudy : undefined
}

export function question(state: SetupState, screen: ScreenId): Line {
  const guided = (key: string, params?: Record<string, unknown>): Line => ({ key: `onboarding.guided.${key}`, params })
  if (screen === 'summary') return { key: weekIsEmpty(state) ? 'onboarding.summary.empty' : 'onboarding.summary.bubble' }
  if (screen.startsWith('extra:')) {
    const category = categoryFor(state, screen)
    const topic = category?.topic
    return guided(topic ? `extra.${topic}` : 'extra.custom', { name: category?.name ?? '' })
  }
  const going = destination(state)
  if (screen === 'commute' && going) return guided(`commute.${going}.question`)
  if (screen === 'commuteRanges' && (going === 'work' || going === 'study')) return guided(`commuteRanges.${going}.question`)
  if (screen === 'study' && going === 'both') return guided('study.both.question')
  return guided(`${screen}.question`)
}

export function hint(state: SetupState, screen: ScreenId): Line | undefined {
  switch (screen) {
    case 'sleep': return { key: 'onboarding.guided.intro' }
    case 'work': return { key: 'onboarding.guided.work.hint' }
    case 'commute': return { key: 'onboarding.guided.commute.hint' }
    // Ida and vuelta come from the hours just given; saying so invites a change when they are off.
    case 'commuteRanges': return commuteBase(state) ? { key: 'onboarding.guided.commuteRanges.hint' } : undefined
    case 'more': return { key: 'onboarding.guided.more.hint' }
    default: return undefined
  }
}

// The days read mid-sentence elsewhere ("lunes a viernes"); an answer on its own line starts with a capital.
const sentenceCase = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1)

function rangesText(state: SetupState, screen: ScreenId, speaker: Speaker): string {
  const category = categoryFor(state, screen)
  if (!category || category.ranges.length === 0) return speaker.t('onboarding.guided.noFixedTime')
  const label = (range: RangeDraft) => (range.label === 'there' || range.label === 'back' ? speaker.t(`onboarding.guided.commuteRanges.${range.label}`)
    : range.label ? speaker.t(`onboarding.guided.sleep.${range.label}`) : '')
  return category.ranges.map((range) => (label(range) ? `${label(range)}: ${speaker.rangeLine(category, range)}` : sentenceCase(speaker.rangeLine(category, range)))).join('\n')
}

// The person's reply, as they would say it: the option they chose, the times they kept, or that they skipped it.
export function answer(state: SetupState, screen: ScreenId, speaker: Speaker): string {
  const { answers } = state
  const skipped = speaker.t('onboarding.guided.skip')
  const tri = (value: 'unanswered' | 'yes' | 'no') => (value === 'unanswered' ? skipped : speaker.t(`onboarding.guided.${value}`))
  switch (screen) {
    case 'sleep': return answers.sleep === 'unanswered' ? skipped : rangesText(state, screen, speaker)
    case 'workStudy': return answers.workStudy === 'unanswered' ? skipped : speaker.t(`onboarding.guided.workStudy.${answers.workStudy}`)
    case 'commute': return tri(answers.commute)
    case 'exercise': return tri(answers.exercise)
    case 'more': {
      if (answers.more === null) return skipped
      const names = moreSelection(state).map((key) => {
        const category = categoryOf(state, key)
        return (EXTRA_TOPICS as string[]).includes(key) ? speaker.t(`onboarding.guided.more.${key}`) : category?.name ?? ''
      }).filter((name) => name !== '')
      return names.length === 0 ? speaker.t('onboarding.guided.nothingElse') : names.join(', ')
    }
    default: return rangesText(state, screen, speaker)
  }
}

// The exchanges above the current question: every earlier screen of the current sequence. A setup opened straight at
// the summary of an existing week, with nothing answered yet, has no conversation behind it and shows none.
export function transcript(state: SetupState, opensAtSummary: boolean): ScreenId[] {
  const screens = sequence(state)
  const here = screens.indexOf(state.screen)
  const earlier = here < 0 ? [] : screens.slice(0, here)
  const { answers } = state
  const untouched = answers.sleep === 'unanswered' && answers.workStudy === 'unanswered' && answers.exercise === 'unanswered' && answers.more === null
  if (state.screen === 'summary' && opensAtSummary && untouched) return []
  return earlier
}

export interface SummaryRow { category: CategoryDraft; status: CategoryStatus }

// What the week card lists: every category that counts, every stored one, and removed ones (with their undo).
export function summaryRows(state: SetupState): SummaryRow[] {
  return state.categories.map((category) => ({ category, status: statusOf(state, category) }))
    .filter((row) => row.status !== 'inactive')
    .filter((row) => row.status === 'active' || row.category.categoryId !== undefined || row.category.removed)
}

export const weekIsEmpty = (state: SetupState): boolean => summaryRows(state).every((row) => row.status === 'removed')
