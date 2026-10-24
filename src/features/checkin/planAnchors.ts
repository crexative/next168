import type { Category, PlannerDocument } from '@/core/model'
import { addLocalDays, datedOccurrences, localDateOf } from '@/core/time'
import { isSleepCategory } from '@/features/onboarding/templates'
import { localMinuteOf } from '@/features/week/localTime'

const WORK_ICON = '💼'
const WORK_NAMES = new Set(['work', 'trabajo', 'travail', 'trabalho', 'arbeit'])

// Same rule as Sleep: the template's icon, or the template's name in any supported language (names are editable, icons rarely).
export function isWorkCategory(category: Pick<Category, 'name' | 'icon'>): boolean {
  return category.icon === WORK_ICON || WORK_NAMES.has(category.name.trim().toLowerCase())
}

export interface PlanSuggestion {
  bedtime?: number
  wake?: number
  workEnd?: number
  // False only when the plan does schedule work, just not on that date; a plan without any work block says nothing about it.
  worksThatDay: boolean
}

// What the plan says about the day the user woke up on `date`: last night's sleep block and that day's work.
export function suggestFromPlan(document: PlannerDocument, date: string): PlanSuggestion {
  const timeZone = document.settings.timeZone
  const categories = new Map(document.categories.map((category) => [category.id, category]))
  const occurrences = datedOccurrences(document, addLocalDays(date, -1), 2, timeZone)
  const sleep = occurrences
    .filter((item) => {
      const category = categories.get(item.categoryId)
      return category && isSleepCategory(category) && localDateOf(new Date(Date.parse(item.end) - 1), timeZone) === date
    })
    .sort((a, b) => b.plannedMinutes - a.plannedMinutes)[0]
  const work = occurrences.filter((item) => {
    const category = categories.get(item.categoryId)
    return category && isWorkCategory(category) && localDateOf(item.start, timeZone) === date
  })
  const planHasWork = document.blocks.some((block) => {
    const category = categories.get(block.categoryId)
    return category !== undefined && isWorkCategory(category)
  })
  const lastWork = work.sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0]
  return {
    ...(sleep ? { bedtime: localMinuteOf(sleep.start, timeZone), wake: localMinuteOf(sleep.end, timeZone) } : {}),
    ...(lastWork ? { workEnd: localMinuteOf(lastWork.end, timeZone) } : {}),
    worksThatDay: work.length > 0 || !planHasWork,
  }
}
