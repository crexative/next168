import { describe, expect, it } from 'vitest'
import type { Category, Task } from '@/core/model'
import { ANY_FREE_TIME, durationChoices, draftFromTask, hasExtraOptions, isPlaceable, newDraft, resolveWhen, taskFields, whenCategories } from './taskDraft'

const category = (id: string, name: string, icon?: string): Category => ({ id, name, icon, colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
const SLEEP = category('sleep', 'Sueño', '😴')
const COMMUTE = category('commute', 'Desplazamientos', '🚌')
const WORK = category('work', 'Trabajo')
const FAMILY = category('family', 'Familia', '👨‍👩‍👧')
const task = (changes: Partial<Task> = {}): Task => ({ id: 't', title: 'Leer', durationMin: 30, priority: 2, createdAt: '2026-10-24T08:00:00.000Z', ...changes })

describe('what a task can be filed during', () => {
  it('never offers Sleep or the commute, whatever language their names are in', () => {
    expect([SLEEP, COMMUTE, WORK, FAMILY].map(isPlaceable)).toEqual([false, false, true, true])
    expect(isPlaceable(category('x', 'Sleep'))).toBe(false)
    expect(isPlaceable(category('y', 'Commute'))).toBe(false)
    expect(whenCategories([SLEEP, WORK, COMMUTE, FAMILY]).map(({ id }) => id)).toEqual(['work', 'family'])
  })

  it('keeps showing the category an old task already has, even Sleep', () => {
    expect(whenCategories([SLEEP, WORK], 'sleep').map(({ id }) => id)).toEqual(['sleep', 'work'])
  })

  it('resolves a remembered choice only while it is still offered; otherwise any free time', () => {
    const categories = [SLEEP, WORK]
    expect(resolveWhen(categories, 'work')).toBe('work')
    expect(resolveWhen(categories, 'sleep')).toBe(ANY_FREE_TIME)
    expect(resolveWhen(categories, 'deleted')).toBe(ANY_FREE_TIME)
    expect(resolveWhen(categories, '')).toBe(ANY_FREE_TIME)
  })
})

describe('the length chips', () => {
  it('are 15 min, 30 min, 1 h and 2 h, plus the length a task already has when it is none of them', () => {
    expect(durationChoices(60)).toEqual([15, 30, 60, 120])
    expect(durationChoices(45)).toEqual([15, 30, 45, 60, 120])
    expect(durationChoices(180)).toEqual([15, 30, 60, 120, 180])
  })
})

describe('turning a draft into a task and back', () => {
  it('a new draft is a to-do with no time, any free time, medium priority', () => {
    expect(newDraft()).toEqual({ title: '', durationMin: undefined, categoryId: '', dueDate: '', dueToday: false, at: '', notes: '', priority: '2' })
  })

  it('leaves out the category and the due date when none was chosen, so the stored task has neither key', () => {
    const fields = taskFields({ ...newDraft(), title: '  Comprar un regalo  ' }, '2026-10-25')
    expect(fields).toEqual({ title: 'Comprar un regalo', priority: 2 })
    expect(fields).not.toHaveProperty('categoryId')
    expect(fields).not.toHaveProperty('dueDate')
    expect(fields).not.toHaveProperty('durationMin')
    expect(taskFields({ ...newDraft('work'), title: 'x', durationMin: 60, dueDate: '2026-10-30', priority: '1' }, '2026-10-25')).toEqual({ title: 'x', durationMin: 60, priority: 1, categoryId: 'work', dueDate: '2026-10-30' })
  })

  it('a fixed time is a minute of its due date, today when no date is set; notes are kept only when written', () => {
    expect(taskFields({ ...newDraft(), title: 'Dentista', at: '09:00', dueDate: '2026-10-27' }, '2026-10-25')).toEqual({ title: 'Dentista', priority: 2, at: 540, dueDate: '2026-10-27' })
    expect(taskFields({ ...newDraft(), title: 'Dentista', at: '09:30' }, '2026-10-25')).toMatchObject({ at: 570, dueDate: '2026-10-25' })
    expect(taskFields({ ...newDraft(), title: 'x', notes: '   ' }, '2026-10-25')).not.toHaveProperty('notes')
    expect(taskFields({ ...newDraft(), title: 'x', notes: 'https://example.invalid' }, '2026-10-25')).toMatchObject({ notes: 'https://example.invalid' })
  })

  it('a draft set to "Today" is due on the date it is saved, not the date the form showed', () => {
    expect(taskFields({ ...newDraft(), title: 'x', dueDate: '2026-10-25', dueToday: true }, '2026-10-26')).toMatchObject({ dueDate: '2026-10-26' })
    expect(taskFields({ ...newDraft(), title: 'x', dueDate: '2026-10-25' }, '2026-10-26')).toMatchObject({ dueDate: '2026-10-25' })
  })

  it('reads a stored task, with no category as "any free time"', () => {
    expect(draftFromTask(task())).toEqual({ title: 'Leer', durationMin: 30, categoryId: '', dueDate: '', dueToday: false, at: '', notes: '', priority: '2' })
    expect(draftFromTask(task({ categoryId: 'work', dueDate: '2026-10-30', priority: 3, at: 545, notes: 'n' }))).toEqual({ title: 'Leer', durationMin: 30, categoryId: 'work', dueDate: '2026-10-30', dueToday: false, at: '09:05', notes: 'n', priority: '3' })
  })

  it('opens "More options" only when something beyond the defaults is already set', () => {
    expect(hasExtraOptions(newDraft())).toBe(false)
    expect(hasExtraOptions(newDraft('work'))).toBe(true)
    expect(hasExtraOptions({ ...newDraft(), dueDate: '2026-10-30' })).toBe(true)
    expect(hasExtraOptions({ ...newDraft(), priority: '1' })).toBe(true)
    expect(hasExtraOptions({ ...newDraft(), durationMin: 60 })).toBe(false)
    expect(hasExtraOptions({ ...newDraft(), durationMin: 45 })).toBe(true)
    expect(hasExtraOptions({ ...newDraft(), at: '09:00' })).toBe(true)
    expect(hasExtraOptions({ ...newDraft(), notes: 'x' })).toBe(true)
  })
})
