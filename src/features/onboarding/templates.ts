import type { Category, ColorKey, DayIndex, Task, TimeBlock } from '@/core/model'
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
  preset: BlockPreset
  // Offered already ticked: nearly every week has them, and one tap less is the common path.
  preselected?: boolean
}

const SLEEP_ICON = '😴'
const EVERY_DAY: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS: DayIndex[] = [1, 2, 3, 4, 5]
const at = (hours: number, minutes = 0) => hours * 60 + minutes

export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { id: 'sleep', icon: SLEEP_ICON, colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 }, preset: { start: at(23), end: at(7), days: EVERY_DAY }, preselected: true },
  { id: 'work', icon: '💼', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 }, preset: { start: at(9), end: at(17), days: WEEKDAYS }, preselected: true },
  { id: 'exercise', icon: EXERCISE_ICON, colorKey: 'green', goal: { type: 'min', hoursPerWeek: 4 }, preset: { start: at(18), end: at(19), days: [1, 3, 5] } },
  { id: 'learning', icon: '📚', colorKey: 'orange', goal: { type: 'min', hoursPerWeek: 5 }, preset: { start: at(20), end: at(21), days: [2, 4] } },
  { id: 'family', icon: '👨‍👩‍👧', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 }, preset: { start: at(10), end: at(14), days: [6] } },
  { id: 'free-time', icon: '🎈', colorKey: 'teal', goal: { type: 'min', hoursPerWeek: 10 }, preset: { start: at(15), end: at(18), days: [0] } },
  { id: 'commute', icon: '🚌', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 }, preset: { start: at(7, 30), end: at(8), days: WEEKDAYS } },
]

export interface TemplateChoice {
  templateId: string
  selected: boolean
  name: string
  colorKey: ColorKey
  sketch: boolean
  goal: Category['goal']
}

export const WEEK_MINUTES = 168 * 60

// The weekly minutes a template's typical block covers (a block that crosses midnight counts its whole length).
export function presetWeeklyMinutes(preset: BlockPreset): number {
  const length = preset.end > preset.start ? preset.end - preset.start : 24 * 60 - preset.start + preset.end
  return length * preset.days.length
}

export function templateOf(templateId: string): CategoryTemplate {
  return CATEGORY_TEMPLATES.find((template) => template.id === templateId)!
}

// What the wizard's current picks add up to, so the week's 168 hours stay visible while choosing.
export function plannedMinutes(choices: TemplateChoice[]): number {
  return choices
    .filter((choice) => choice.selected && choice.sketch)
    .reduce((sum, choice) => sum + presetWeeklyMinutes(templateOf(choice.templateId).preset), 0)
}

// A goal is fine when it has no hours or hours the category editor would accept (0.5–168).
export function goalHoursValid(goal: Category['goal']): boolean {
  return goal.type === 'none' || (Number.isFinite(goal.hoursPerWeek) && goal.hoursPerWeek >= 0.5 && goal.hoursPerWeek <= 168)
}

export interface FirstTaskChoice {
  title: string
  templateId: string
  durationMin: number
}

export interface OnboardingResult {
  categories: Category[]
  blocks: TimeBlock[]
  tasks: Task[]
}

// A first task defaults to the first picked category that is not Sleep (a task inside the sleep block is never useful);
// an explicit choice among the picked categories is kept, and nothing is chosen when only Sleep is picked.
export function defaultTaskTemplateId(choices: TemplateChoice[], current: string): string {
  const picked = choices.filter((choice) => choice.selected)
  return picked.some((choice) => choice.templateId === current) ? current : firstNonSleep(picked, (choice) => choice.templateId === 'sleep')?.templateId ?? ''
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
  const reused = (choice: TemplateChoice) => existingByName.get(choice.name.trim().toLowerCase())
  const categoryIds = new Map(picked.map((choice) => [choice.templateId, reused(choice)?.id ?? environment.newId()]))
  const templates = new Map(CATEGORY_TEMPLATES.map((template) => [template.id, template]))

  const categories = picked.filter((choice) => !reused(choice)).map((choice): Category => {
    const template = templates.get(choice.templateId)!
    return { id: categoryIds.get(choice.templateId)!, name: choice.name.trim(), colorKey: choice.colorKey, icon: template.icon, goal: goalHoursValid(choice.goal) ? { ...choice.goal, hoursPerWeek: choice.goal.type === 'none' ? 0 : choice.goal.hoursPerWeek } : template.goal }
  })
  const blocks = picked.filter((choice) => choice.sketch).map((choice): TimeBlock => {
    const { preset } = templates.get(choice.templateId)!
    return { id: environment.newId(), categoryId: categoryIds.get(choice.templateId)!, title: choice.name.trim(), days: [...preset.days], start: preset.start, end: preset.end }
  })
  const taskCategory = categoryIds.get(firstTask.templateId)
  const tasks: Task[] = firstTask.title.trim() && taskCategory
    ? [{ id: environment.newId(), title: firstTask.title.trim(), categoryId: taskCategory, durationMin: firstTask.durationMin, priority: 2, createdAt: environment.now.toISOString() }]
    : []
  return { categories, blocks, tasks }
}
