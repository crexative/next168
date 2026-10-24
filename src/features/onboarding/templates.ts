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
}

const EVERY_DAY: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS: DayIndex[] = [1, 2, 3, 4, 5]
const at = (hours: number, minutes = 0) => hours * 60 + minutes

export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { id: 'sleep', icon: '😴', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 }, preset: { start: at(23), end: at(7), days: EVERY_DAY } },
  { id: 'work', icon: '💼', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 }, preset: { start: at(9), end: at(17), days: WEEKDAYS } },
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

export function buildOnboardingResult(
  choices: TemplateChoice[],
  firstTask: FirstTaskChoice,
  environment: { newId: () => string; now: Date },
): OnboardingResult {
  const picked = choices.filter((choice) => choice.selected && choice.name.trim() !== '')
  const categoryIds = new Map(picked.map((choice) => [choice.templateId, environment.newId()]))
  const templates = new Map(CATEGORY_TEMPLATES.map((template) => [template.id, template]))

  const categories = picked.map((choice): Category => {
    const template = templates.get(choice.templateId)!
    return { id: categoryIds.get(choice.templateId)!, name: choice.name.trim(), colorKey: choice.colorKey, icon: template.icon, goal: template.goal }
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
