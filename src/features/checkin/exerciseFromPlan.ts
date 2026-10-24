import type { Category, CheckIn, PlannerDocument } from '@/core/model'
import { datedOccurrences, localDateOf } from '@/core/time'
import { actualFor } from '@/features/today/actuals'
import { EXERCISE_ICON } from '@/features/insights/exercise'

// Same rule as Sleep and Work: the template's icon, or the template's name in any supported language.
const EXERCISE_NAMES = new Set(['exercise', 'ejercicio', 'exercice', 'exercício', 'exercicio', 'bewegung'])

export function isExerciseCategory(category: Pick<Category, 'name' | 'icon'>): boolean {
  return category.icon === EXERCISE_ICON || EXERCISE_NAMES.has(category.name.trim().toLowerCase())
}

export function tracksExercise(document: PlannerDocument): boolean {
  const exerciseIds = new Set(document.categories.filter(isExerciseCategory).map((category) => category.id))
  return document.blocks.some((block) => exerciseIds.has(block.categoryId))
}

// "Did you exercise?" is answered by the timeline, not asked a second time: the exercise blocks of `date` say it.
// A done or partly done block is a yes; every block skipped is a no; a day with no exercise block, in a plan
// that has them, is "not planned". Anything still unmarked is unknown, so nothing is stated.
export function deriveExercise(document: PlannerDocument, date: string): CheckIn['exercise'] | undefined {
  const timeZone = document.settings.timeZone
  const exerciseIds = new Set(document.categories.filter(isExerciseCategory).map((category) => category.id))
  if (exerciseIds.size === 0) return undefined
  const blocks = datedOccurrences(document, date, 1, timeZone)
    .filter((occurrence) => exerciseIds.has(occurrence.categoryId) && localDateOf(occurrence.start, timeZone) === date)
  if (blocks.length === 0) return tracksExercise(document) ? 'not-planned' : undefined
  const statuses = blocks.map((occurrence) => actualFor(document.actuals, occurrence)?.status)
  if (statuses.some((status) => status === 'done' || status === 'partial')) return 'yes'
  return statuses.every((status) => status === 'skipped') ? 'no' : undefined
}
