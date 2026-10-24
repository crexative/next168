import type { Category, ColorKey, DayIndex, Goal, Task, TimeBlock } from '@/core/model'
import { distinctColorKeys } from '@/features/insights/categoryColor'
import { EXERCISE_ICON } from '@/features/insights/exercise'

export interface BlockPreset {
  start: number
  end: number
  days: DayIndex[]
}

export interface CategoryTemplate {
  id: string
  icon: string
  colorKey: ColorKey
  goal: Category['goal']
  // The typical routine: one entry per repeating slot, each editable on its own in the wizard.
  blocks: BlockPreset[]
  // Offered already ticked: nearly every week has them, and one tap less is the common path.
  preselected?: boolean
}

export const SLEEP_ICON = '😴'
const EVERY_DAY: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS: DayIndex[] = [1, 2, 3, 4, 5]
const at = (hours: number, minutes = 0) => hours * 60 + minutes

// Every goal here is met by the template's own blocks (checked by a test): the first Resumen visit must not open
// on a goal the default week already fails.
export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { id: 'sleep', icon: SLEEP_ICON, colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 }, blocks: [{ start: at(23), end: at(7), days: EVERY_DAY }], preselected: true },
  { id: 'work', icon: '💼', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 }, blocks: [{ start: at(9), end: at(17), days: WEEKDAYS }], preselected: true },
  { id: 'exercise', icon: EXERCISE_ICON, colorKey: 'green', goal: { type: 'min', hoursPerWeek: 3 }, blocks: [{ start: at(18), end: at(19), days: [1, 3, 5] }] },
  { id: 'learning', icon: '📚', colorKey: 'orange', goal: { type: 'min', hoursPerWeek: 2 }, blocks: [{ start: at(20), end: at(21), days: [2, 4] }] },
  { id: 'family', icon: '👨‍👩‍👧', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 }, blocks: [{ start: at(10), end: at(14), days: [6] }] },
  { id: 'free-time', icon: '🎈', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 3 }, blocks: [{ start: at(15), end: at(18), days: [0] }] },
  // There and back: the second block starts when the workday ends.
  { id: 'commute', icon: '🚌', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 }, blocks: [{ start: at(7, 30), end: at(8), days: WEEKDAYS }, { start: at(17), end: at(17, 30), days: WEEKDAYS }] },
]

export interface TemplateChoice {
  templateId: string
  existingCategoryId?: string
  selected: boolean
  name: string
  colorKey: ColorKey
  // Whether the wizard creates the routine below: false for a category that already has blocks of its own.
  sketch: boolean
  goal: Category['goal']
  routine: BlockPreset[]
}

export const WEEK_MINUTES = 168 * 60

// The weekly minutes a block covers (a block that crosses midnight counts its whole length).
export function presetWeeklyMinutes(preset: BlockPreset): number {
  const length = preset.end > preset.start ? preset.end - preset.start : 24 * 60 - preset.start + preset.end
  return length * preset.days.length
}

export function routineWeeklyMinutes(routine: readonly BlockPreset[]): number {
  return routine.reduce((sum, block) => sum + presetWeeklyMinutes(block), 0)
}

export function templateOf(templateId: string): CategoryTemplate | undefined {
  return CATEGORY_TEMPLATES.find((template) => template.id === templateId)
}

// What the wizard's current picks add up to, so the week's 168 hours stay visible while choosing.
export function plannedMinutes(choices: TemplateChoice[]): number {
  return choices.filter((choice) => choice.selected && choice.sketch).reduce((sum, choice) => sum + routineWeeklyMinutes(choice.routine), 0)
}

// A new category's goal never asks for more than its own routine provides: "at least" is capped at the whole hours the
// routine covers (and dropped when it covers less than one), so a freshly built week never starts out failing a goal.
export function goalFromRoutine(goal: Goal, routineMinutes: number): Goal {
  if (goal.type !== 'min') return { ...goal }
  const hours = Math.min(goal.hoursPerWeek, Math.floor(routineMinutes / 60))
  return hours >= 1 ? { type: 'min', hoursPerWeek: hours } : { type: 'none', hoursPerWeek: 0 }
}

// One field, one default length: the first task is a title; its length and details are set later in Tasks.
export const FIRST_TASK_MINUTES = 60

export interface FirstTaskChoice {
  title: string
  templateId: string
}

export interface OnboardingResult {
  categories: Category[]
  categoryUpdates: { id: string; patch: Partial<Pick<Category, 'name'>> }[]
  blocks: TimeBlock[]
  tasks: Task[]
}

// The first task goes into the first picked category that is not Sleep (a task inside the sleep block is never useful);
// nothing is chosen when only Sleep is picked.
export function firstTaskTemplateId(choices: TemplateChoice[]): string {
  return firstNonSleep(choices.filter((choice) => choice.selected), (choice) => choice.templateId === 'sleep')?.templateId ?? ''
}

// The one rule behind every "default category for a task": the first category that is not Sleep.
export function firstNonSleep<T>(items: T[], isSleep: (item: T) => boolean): T | undefined {
  return items.find((item) => !isSleep(item))
}

// A stored category is Sleep when it keeps the Sleep template's icon or is named Sleep (names are editable, icons rarely).
export function isSleepCategory(category: Pick<Category, 'name' | 'icon'>): boolean {
  return category.icon === SLEEP_ICON || category.name.trim().toLowerCase() === 'sleep'
}

// The task form's category: an existing choice is kept; otherwise the first non-Sleep category, and Sleep only when it is all there is.
export function defaultTaskCategoryId(categories: Category[], current: string): string {
  if (categories.some((category) => category.id === current)) return current
  return (firstNonSleep(categories, isSleepCategory) ?? categories[0])?.id ?? ''
}

export function buildOnboardingResult(
  choices: TemplateChoice[],
  firstTask: FirstTaskChoice,
  environment: { newId: () => string; now: Date; existing?: Category[] },
): OnboardingResult {
  const picked = choices.filter((choice) => choice.selected && choice.name.trim() !== '')
  // Reopening the wizard on a workspace that already has categories must not duplicate them: a pick with the
  // name of an existing category is that category.
  const existingByName = new Map((environment.existing ?? []).map((category) => [category.name.trim().toLowerCase(), category]))
  const existingById = new Map((environment.existing ?? []).map((category) => [category.id, category]))
  const reused = (choice: TemplateChoice) => choice.existingCategoryId
    ? existingById.get(choice.existingCategoryId)
    : existingByName.get(choice.name.trim().toLowerCase())
  const categoryIds = new Map(picked.map((choice) => [choice.templateId, reused(choice)?.id ?? environment.newId()]))
  const templates = new Map(CATEGORY_TEMPLATES.map((template) => [template.id, template]))
  const routineOf = (choice: TemplateChoice) => choice.sketch && templates.has(choice.templateId) ? choice.routine : []

  // New categories get distinct colours, also from the categories a reopened wizard keeps.
  const created = picked.filter((choice) => !reused(choice))
  const colorKeys = distinctColorKeys(created.map((choice) => choice.colorKey), (environment.existing ?? []).map((category) => category.colorKey))
  const categories = created.map((choice, index): Category => {
    const template = templates.get(choice.templateId)!
    return { id: categoryIds.get(choice.templateId)!, name: choice.name.trim(), colorKey: colorKeys[index]!, icon: template.icon, goal: goalFromRoutine(template.goal, routineWeeklyMinutes(routineOf(choice))) }
  })
  // A reused category keeps its colour and goal; the wizard only offers it a new name.
  const categoryUpdates: OnboardingResult['categoryUpdates'] = []
  for (const choice of picked) {
    const existing = reused(choice)
    if (existing && choice.name.trim() !== existing.name) categoryUpdates.push({ id: existing.id, patch: { name: choice.name.trim() } })
  }
  const blocks = picked.flatMap((choice) => routineOf(choice).map((slot): TimeBlock => (
    { id: environment.newId(), categoryId: categoryIds.get(choice.templateId)!, title: choice.name.trim(), days: [...slot.days], start: slot.start, end: slot.end }
  )))
  const taskCategory = categoryIds.get(firstTask.templateId)
  const tasks: Task[] = firstTask.title.trim() && taskCategory
    ? [{ id: environment.newId(), title: firstTask.title.trim(), categoryId: taskCategory, durationMin: FIRST_TASK_MINUTES, priority: 2, createdAt: environment.now.toISOString() }]
    : []
  return { categories, categoryUpdates, blocks, tasks }
}
