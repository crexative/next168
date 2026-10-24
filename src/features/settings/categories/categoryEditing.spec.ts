import { describe, expect, it } from 'vitest'
import { createEmptyDocument, validateDocument } from '@/core/documents'
import type { PlannerDocument } from '@/core/model'
import { categoryUsage, goalFromForm, removeCategory, restoreCategory, validateCategoryForm } from './categoryEditing'

function document(): PlannerDocument {
  return validateDocument({
    ...createEmptyDocument({ now: new Date('2026-10-24T12:00:00Z'), locale: 'en', timeZone: 'UTC', idGen: () => 'ws' }),
    categories: [
      { id: 'a', name: 'A', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'b', name: 'B', colorKey: 'red', goal: { type: 'max', hoursPerWeek: 10 } },
    ],
    blocks: [{ id: 'blk', categoryId: 'a', title: 'x', days: [1], start: 60, end: 120 }],
    tasks: [{ id: 'tsk', title: 't', categoryId: 'a', durationMin: 30, priority: 2, createdAt: '2026-10-24T10:00:00Z' }],
  })
}

describe('category editing', () => {
  it('counts the blocks and tasks that reference a category', () => {
    expect(categoryUsage(document(), 'a')).toEqual({ blocks: 1, tasks: 1 })
    expect(categoryUsage(document(), 'b')).toEqual({ blocks: 0, tasks: 0 })
  })

  it('deletes an unreferenced category directly', () => {
    const draft = document()
    expect(removeCategory(draft, 'b')?.category.id).toBe('b')
    expect(draft.categories.map((category) => category.id)).toEqual(['a'])
    expect(() => validateDocument(draft)).not.toThrow()
  })

  it('refuses to delete a referenced category without a valid reassignment target', () => {
    const draft = document()
    expect(removeCategory(draft, 'a')).toBeNull()
    expect(removeCategory(draft, 'a', 'a')).toBeNull()
    expect(removeCategory(draft, 'a', 'missing')).toBeNull()
    expect(draft.categories).toHaveLength(2)
  })

  it('reassigns references on delete and restores them on undo', () => {
    const draft = document()
    const removed = removeCategory(draft, 'a', 'b')!
    expect(draft.blocks[0]!.categoryId).toBe('b')
    expect(draft.tasks[0]!.categoryId).toBe('b')
    expect(() => validateDocument(draft)).not.toThrow()
    restoreCategory(draft, removed)
    expect(draft.blocks[0]!.categoryId).toBe('a')
    expect(draft.tasks[0]!.categoryId).toBe('a')
    expect(draft.categories.map((category) => category.id).sort()).toEqual(['a', 'b'])
  })

  it('validates the form and stores zero hours for a goal-less category', () => {
    expect(validateCategoryForm({ name: ' ', colorKey: 'blue', goalType: 'none', hours: 1 })).toBe('name-required')
    expect(validateCategoryForm({ name: 'x', colorKey: 'blue', goalType: 'max', hours: 0 })).toBe('hours-range')
    expect(validateCategoryForm({ name: 'x', colorKey: 'blue', goalType: 'min', hours: 4 })).toBeNull()
    expect(goalFromForm({ name: 'x', colorKey: 'blue', goalType: 'none', hours: 9 })).toEqual({ type: 'none', hoursPerWeek: 0 })
  })
})
