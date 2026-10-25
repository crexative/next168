import type { ColorKey, DayIndex } from '@/core/model'
import { EXERCISE_ICON } from '@/features/insights/exercise'
import { SLEEP_ICON } from './templates'

export type TopicId = 'sleep' | 'work' | 'study' | 'commute' | 'exercise' | 'family' | 'friends' | 'me' | 'learning'
export type GoalKind = 'min' | 'max' | 'none'

export interface TopicRange { days: DayIndex[]; start: number; end: number }

export interface Topic {
  id: TopicId
  // The key under onboarding.templates.* that names the category.
  nameKey: string
  icon: string
  colorKey: ColorKey
  defaults: TopicRange[]
  goal: GoalKind
  // The typical lengths, in minutes, offered as end-time chips.
  lengths: number[]
}

const at = (hours: number, minutes = 0) => hours * 60 + minutes
export const EVERY_DAY: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS: DayIndex[] = [1, 2, 3, 4, 5]
export const WEEKEND: DayIndex[] = [6, 0]
const LEISURE_LENGTHS = [30, 60, 120, 180, 240]

export const TOPICS: Record<TopicId, Topic> = {
  sleep: { id: 'sleep', nameKey: 'sleep', icon: SLEEP_ICON, colorKey: 'purple', goal: 'min', lengths: [360, 420, 480, 540, 600], defaults: [{ days: EVERY_DAY, start: at(23), end: at(7) }] },
  work: { id: 'work', nameKey: 'work', icon: '💼', colorKey: 'blue', goal: 'max', lengths: [240, 360, 480, 540, 600], defaults: [{ days: WEEKDAYS, start: at(9), end: at(17) }] },
  study: { id: 'study', nameKey: 'study', icon: '🎓', colorKey: 'orange', goal: 'none', lengths: [60, 120, 180, 240, 360], defaults: [{ days: WEEKDAYS, start: at(8), end: at(12) }] },
  commute: { id: 'commute', nameKey: 'commute', icon: '🚌', colorKey: 'gray', goal: 'none', lengths: [15, 30, 45, 60, 90], defaults: [] },
  exercise: { id: 'exercise', nameKey: 'exercise', icon: EXERCISE_ICON, colorKey: 'green', goal: 'min', lengths: [30, 45, 60, 90, 120], defaults: [{ days: [1, 3, 5], start: at(18), end: at(19) }] },
  family: { id: 'family', nameKey: 'family', icon: '👨‍👩‍👧', colorKey: 'pink', goal: 'none', lengths: LEISURE_LENGTHS, defaults: [{ days: [6], start: at(10), end: at(14) }] },
  friends: { id: 'friends', nameKey: 'friends', icon: '🧑‍🤝‍🧑', colorKey: 'red', goal: 'none', lengths: LEISURE_LENGTHS, defaults: [{ days: [5], start: at(20), end: at(23) }] },
  me: { id: 'me', nameKey: 'free-time', icon: '🎈', colorKey: 'teal', goal: 'min', lengths: LEISURE_LENGTHS, defaults: [{ days: [0], start: at(15), end: at(18) }] },
  learning: { id: 'learning', nameKey: 'learning', icon: '📚', colorKey: 'yellow', goal: 'min', lengths: LEISURE_LENGTHS, defaults: [{ days: [2, 4], start: at(20), end: at(21) }] },
}

export const TOPIC_IDS = Object.keys(TOPICS) as TopicId[]
// The topics a person can pick on the "more" screen, in chip order.
export const EXTRA_TOPICS: TopicId[] = ['family', 'friends', 'me', 'learning']

// Studying next to a job is usually in the evening.
export const STUDY_WITH_WORK: TopicRange = { days: [1, 2, 3, 4], start: at(19), end: at(21) }
// What an own category (not a topic) starts as.
export const OWN_DEFAULT: TopicRange = { days: WEEKDAYS, start: at(18), end: at(19) }
export const OWN_LENGTHS = LEISURE_LENGTHS
export const OWN_COLOR: ColorKey = 'blue'

// Used when a commute has no work or study to be derived from.
export const COMMUTE_FALLBACK = { there: { start: at(7, 30), end: at(8) }, back: { start: at(17, 30), end: at(18) }, days: WEEKDAYS }
