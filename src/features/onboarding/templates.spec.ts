import { describe, expect, it } from 'vitest'
import type { Category } from '@/core/model'
import { defaultTaskCategoryId, isSleepCategory } from './templates'

describe('the task form\'s default category', () => {
  const categories: Category[] = [
    { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
    { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
    { id: 'c-gym', name: 'Gym', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
  ]

  it('is the first non-Sleep category, keeping an explicit choice', () => {
    expect(defaultTaskCategoryId(categories, '')).toBe('c-work')
    expect(defaultTaskCategoryId(categories, 'c-gym')).toBe('c-gym')
    expect(defaultTaskCategoryId(categories, 'gone')).toBe('c-work')
    expect(defaultTaskCategoryId([{ ...categories[0]!, name: 'Rest' }, categories[1]!], '')).toBe('c-work')
    expect(defaultTaskCategoryId(categories.slice(0, 1), '')).toBe('c-sleep')
    expect(defaultTaskCategoryId([], '')).toBe('')
  })

  it('knows Sleep by its icon or its name', () => {
    expect(isSleepCategory({ name: 'Rest', icon: '😴' })).toBe(true)
    expect(isSleepCategory({ name: ' sleep ' })).toBe(true)
    expect(isSleepCategory({ name: 'Work' })).toBe(false)
  })
})
