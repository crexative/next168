import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '@/core/documents'
import { validateDocument } from '@/core/documents'
import { computeStats } from '@/core/stats'
import { overlaps } from '@/core/time'
import type { Category } from '@/core/model'
import { buildOnboardingResult, CATEGORY_TEMPLATES, defaultTaskCategoryId, defaultTaskTemplateId, type TemplateChoice } from './templates'

const NOW = new Date('2026-10-24T12:00:00Z')
let counter = 0
const environment = { newId: () => `id-${++counter}`, now: NOW }

const allChoices = (): TemplateChoice[] => CATEGORY_TEMPLATES.map((template) => ({
  templateId: template.id, selected: true, name: template.id, colorKey: template.colorKey, sketch: true,
}))

describe('onboarding templates', () => {
  it('uses the documented goals', () => {
    const goal = (id: string) => CATEGORY_TEMPLATES.find((template) => template.id === id)!.goal
    expect(goal('sleep')).toEqual({ type: 'min', hoursPerWeek: 49 })
    expect(goal('work')).toEqual({ type: 'max', hoursPerWeek: 40 })
    expect(goal('exercise')).toEqual({ type: 'min', hoursPerWeek: 4 })
    expect(goal('learning')).toEqual({ type: 'min', hoursPerWeek: 5 })
    expect(goal('free-time')).toEqual({ type: 'min', hoursPerWeek: 10 })
    expect(goal('family').type).toBe('none')
  })

  it('produces a valid document whose preset blocks never overlap', () => {
    const result = buildOnboardingResult(allChoices(), { title: 'Plan', templateId: 'learning', durationMin: 60 }, environment)
    const document = validateDocument({ ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC' }), ...result })
    for (const [index, block] of document.blocks.entries()) {
      for (const other of document.blocks.slice(index + 1)) expect(overlaps(block, other), `${block.title}/${other.title}`).toBe(false)
    }
    const sleep = computeStats(document).categories.find((row) => row.categoryId === result.categories[0]!.id)!
    expect(sleep.plannedMinutes).toBe(7 * 8 * 60)
    expect(sleep.goal.kind).toBe('ok')
  })

  it('skips unselected templates, sketches and tasks without a category', () => {
    const choices = allChoices().map((choice) => ({ ...choice, selected: choice.templateId === 'work', sketch: false }))
    const result = buildOnboardingResult(choices, { title: 'Write', templateId: 'sleep', durationMin: 30 }, environment)
    expect(result.categories.map((category) => category.name)).toEqual(['work'])
    expect(result.blocks).toEqual([])
    expect(result.tasks).toEqual([])
  })

  it('honours renamed and recolored choices', () => {
    const choices: TemplateChoice[] = [{ templateId: 'work', selected: true, name: ' Studio ', colorKey: 'red', sketch: true }]
    const result = buildOnboardingResult(choices, { title: '', templateId: 'work', durationMin: 60 }, environment)
    expect(result.categories[0]).toMatchObject({ name: 'Studio', colorKey: 'red' })
    expect(result.blocks[0]!.title).toBe('Studio')
  })

  it('defaults the first task to the first picked category that is not Sleep', () => {
    const pick = (...ids: string[]) => allChoices().map((choice) => ({ ...choice, selected: ids.includes(choice.templateId) }))
    expect(defaultTaskTemplateId(pick('sleep', 'work', 'exercise'), '')).toBe('work')
    expect(defaultTaskTemplateId(pick('sleep', 'work', 'exercise'), 'exercise')).toBe('exercise')
    expect(defaultTaskTemplateId(pick('sleep', 'work'), 'learning')).toBe('work')
    expect(defaultTaskTemplateId(pick('sleep'), '')).toBe('')
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
