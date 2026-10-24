import { describe, expect, it } from 'vitest'
import { createEmptyDocument, validateDocument } from '@/core/documents'
import { computeStats } from '@/core/stats'
import { overlaps } from '@/core/time'
import type { Category } from '@/core/model'
import {
  buildOnboardingResult, CATEGORY_TEMPLATES, defaultTaskCategoryId, firstTaskTemplateId, goalFromRoutine, plannedMinutes,
  presetWeeklyMinutes, routineWeeklyMinutes, type TemplateChoice,
} from './templates'

const NOW = new Date('2026-10-24T12:00:00Z')
let counter = 0
const environment = { newId: () => `id-${++counter}`, now: NOW }
const noTask = { title: '', templateId: 'work' }

const allChoices = (): TemplateChoice[] => CATEGORY_TEMPLATES.map((template) => ({
  templateId: template.id, selected: true, name: template.id, colorKey: template.colorKey, sketch: true, goal: { ...template.goal },
  routine: template.blocks.map((block) => ({ ...block, days: [...block.days] })),
}))

function documentOf(result: ReturnType<typeof buildOnboardingResult>) {
  return validateDocument({ ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC' }), ...result })
}

describe('onboarding templates', () => {
  it('opens no goal the template week itself fails (ON1)', () => {
    const document = documentOf(buildOnboardingResult(allChoices(), noTask, environment))
    for (const row of computeStats(document).categories) {
      const name = document.categories.find((category) => category.id === row.categoryId)!.name
      expect(row.goal.kind, `${name} must not start missing or over its goal`).not.toBe('missing')
      expect(row.goal.kind, name).not.toBe('over')
    }
    // The case the expert found: Exercise gives 3 h a week, so its goal is "at least 3 h", not 4.
    expect(document.categories.find((category) => category.name === 'exercise')!.goal).toEqual({ type: 'min', hoursPerWeek: 3 })
  })

  it('never asks a new category for more hours than its edited routine provides', () => {
    const exercise = (routine: TemplateChoice['routine']) => allChoices().filter((choice) => choice.templateId === 'exercise').map((choice) => ({ ...choice, routine }))
    const goalFor = (routine: TemplateChoice['routine']) => buildOnboardingResult(exercise(routine), noTask, environment).categories[0]!.goal
    expect(goalFor([{ start: 18 * 60, end: 20 * 60, days: [1, 2, 3, 4, 5] }])).toEqual({ type: 'min', hoursPerWeek: 3 })
    expect(goalFor([{ start: 18 * 60, end: 19 * 60, days: [2] }])).toEqual({ type: 'min', hoursPerWeek: 1 })
    expect(goalFor([{ start: 18 * 60, end: 18 * 60 + 30, days: [2] }])).toEqual({ type: 'none', hoursPerWeek: 0 })
    expect(goalFromRoutine({ type: 'min', hoursPerWeek: 49 }, 0)).toEqual({ type: 'none', hoursPerWeek: 0 })
    expect(goalFromRoutine({ type: 'max', hoursPerWeek: 40 }, 0)).toEqual({ type: 'max', hoursPerWeek: 40 })
  })

  it('makes the commute there and back', () => {
    const commute = CATEGORY_TEMPLATES.find((template) => template.id === 'commute')!
    expect(commute.blocks.map((block) => [block.start, block.end])).toEqual([[7 * 60 + 30, 8 * 60], [17 * 60, 17 * 60 + 30]])
    const result = buildOnboardingResult(allChoices().filter((choice) => choice.templateId === 'commute'), noTask, environment)
    expect(result.blocks).toHaveLength(2)
    expect(routineWeeklyMinutes(commute.blocks)).toBe(5 * 60)
  })

  it('produces a valid document whose typical blocks never overlap', () => {
    const result = buildOnboardingResult(allChoices(), { title: 'Plan', templateId: 'learning' }, environment)
    const document = documentOf(result)
    for (const [index, block] of document.blocks.entries()) {
      for (const other of document.blocks.slice(index + 1)) expect(overlaps(block, other), `${block.title}/${other.title}`).toBe(false)
    }
    const sleep = computeStats(document).categories.find((row) => row.categoryId === result.categories[0]!.id)!
    expect(sleep.plannedMinutes).toBe(7 * 8 * 60)
    expect(sleep.goal.kind).toBe('ok')
  })

  it('builds the routine the person edited, not the template', () => {
    const choices = allChoices().filter((choice) => choice.templateId === 'work').map((choice) => ({ ...choice, name: ' Studio ', routine: [{ start: 10 * 60, end: 18 * 60 + 30, days: [1, 2, 3] as TemplateChoice['routine'][number]['days'] }] }))
    const result = buildOnboardingResult(choices, noTask, environment)
    expect(result.blocks).toEqual([expect.objectContaining({ title: 'Studio', start: 600, end: 1110, days: [1, 2, 3] })])
    expect(result.categories[0]).toMatchObject({ name: 'Studio' })
  })

  it('skips unselected templates, routines that are not created and tasks without a category', () => {
    const choices = allChoices().map((choice) => ({ ...choice, selected: choice.templateId === 'work', sketch: false }))
    const result = buildOnboardingResult(choices, { title: 'Write', templateId: 'sleep' }, environment)
    expect(result.categories.map((category) => category.name)).toEqual(['work'])
    expect(result.blocks).toEqual([])
    expect(result.tasks).toEqual([])
  })

  it('gives every created category a distinct colour, even when the choices repeat one', () => {
    const defaults = buildOnboardingResult(allChoices(), noTask, environment)
    expect(new Set(defaults.categories.map((category) => category.colorKey)).size).toBe(defaults.categories.length)

    const clashing = allChoices().map((choice) => ({ ...choice, colorKey: 'blue' as const }))
    const result = buildOnboardingResult(clashing, noTask, environment)
    expect(new Set(result.categories.map((category) => category.colorKey)).size).toBe(CATEGORY_TEMPLATES.length)
    expect(result.categories[0]!.colorKey).toBe('blue')
  })

  it('puts the first task in the first picked category that is not Sleep, with a default length', () => {
    const pick = (...ids: string[]) => allChoices().map((choice) => ({ ...choice, selected: ids.includes(choice.templateId) }))
    expect(firstTaskTemplateId(pick('sleep', 'work', 'exercise'))).toBe('work')
    expect(firstTaskTemplateId(pick('sleep', 'exercise'))).toBe('exercise')
    expect(firstTaskTemplateId(pick('sleep'))).toBe('')
    const result = buildOnboardingResult(pick('sleep', 'work'), { title: ' Call the bank ', templateId: firstTaskTemplateId(pick('sleep', 'work')) }, environment)
    expect(result.tasks).toEqual([expect.objectContaining({ title: 'Call the bank', durationMin: 60, categoryId: result.categories[1]!.id })])
  })

  it('defaults the task form category to the first non-Sleep category, keeping an explicit choice', () => {
    const categories: Category[] = [
      { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
      { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'c-gym', name: 'Gym', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
    ]
    expect(defaultTaskCategoryId(categories, '')).toBe('c-work')
    expect(defaultTaskCategoryId(categories, 'c-gym')).toBe('c-gym')
    expect(defaultTaskCategoryId(categories, 'gone')).toBe('c-work')
    expect(defaultTaskCategoryId([{ ...categories[0]!, name: 'Rest' }, categories[1]!], '')).toBe('c-work')
    expect(defaultTaskCategoryId(categories.slice(0, 1), '')).toBe('c-sleep')
    expect(defaultTaskCategoryId([], '')).toBe('')
  })
})

describe('onboarding week counter and reused categories', () => {
  it('offers Sleep and Work already ticked and nothing else', () => {
    expect(CATEGORY_TEMPLATES.filter((template) => template.preselected).map((template) => template.id)).toEqual(['sleep', 'work'])
  })

  it('adds up the routine of the ticked categories, as edited', () => {
    const only = (...ids: string[]) => allChoices().map((choice) => ({ ...choice, selected: ids.includes(choice.templateId) }))
    expect(plannedMinutes(only('sleep', 'work'))).toBe((56 + 40) * 60)
    expect(plannedMinutes(only())).toBe(0)
    expect(plannedMinutes(only('sleep').map((choice) => ({ ...choice, sketch: false })))).toBe(0)
    expect(plannedMinutes(only('work').map((choice) => ({ ...choice, routine: [{ start: 9 * 60, end: 12 * 60, days: [1, 2] }] })))).toBe(6 * 60)
    expect(presetWeeklyMinutes({ start: 23 * 60, end: 7 * 60, days: [0, 1] })).toBe(2 * 8 * 60)
  })

  it('reuses an existing category with the same name instead of duplicating it', () => {
    const existing: Category[] = [{ id: 'c-existing', name: 'WORK', colorKey: 'red', goal: { type: 'none', hoursPerWeek: 0 } }]
    const result = buildOnboardingResult(allChoices().filter((choice) => choice.templateId === 'work'), { title: 'Plan', templateId: 'work' }, { ...environment, existing })
    expect(result.categories).toEqual([])
    expect(result.blocks[0]!.categoryId).toBe('c-existing')
    expect(result.tasks[0]!.categoryId).toBe('c-existing')
  })

  it('renames a reused category and leaves its colour and goal alone', () => {
    const existing: Category[] = [{ id: 'c-work', name: 'Work', colorKey: 'red', customColor: '#123456', goal: { type: 'max', hoursPerWeek: 30 } }]
    const choice: TemplateChoice = { ...allChoices().find((candidate) => candidate.templateId === 'work')!, existingCategoryId: 'c-work', name: 'Studio', colorKey: 'blue', sketch: false, goal: { type: 'max', hoursPerWeek: 40 } }
    const result = buildOnboardingResult([choice], noTask, { ...environment, existing })
    expect(result.categoryUpdates).toEqual([{ id: 'c-work', patch: { name: 'Studio' } }])
  })

  it('gives a new category a colour no kept category uses when the wizard is reopened', () => {
    const existing: Category[] = [{ id: 'c-existing', name: 'Reading', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } }]
    const sleepOnly = allChoices().filter((choice) => choice.templateId === 'sleep')
    expect(sleepOnly[0]!.colorKey).toBe('purple')
    const result = buildOnboardingResult(sleepOnly, noTask, { ...environment, existing })
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0]!.colorKey).not.toBe('purple')
  })
})
