import { describe, expect, it } from 'vitest'
import type { BlockActual, TimeBlock } from '@/core/model'
import { plannerDocument } from '@/features/week/testDocument'
import { deriveExercise, isExerciseCategory } from './exerciseFromPlan'

// Saturday 2026-10-24: two exercise blocks, plus one on Sunday only in a second plan.
const category = { id: 'gym', name: 'Exercise', colorKey: 'green' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }
const morning: TimeBlock = { id: 'am', categoryId: 'gym', title: 'Run', days: [6], start: 480, end: 540 }
const evening: TimeBlock = { id: 'pm', categoryId: 'gym', title: 'Stretch', days: [6], start: 1080, end: 1110 }
const actual = (blockId: string, start: string, end: string, status: BlockActual['status']): BlockActual => ({
  date: '2026-10-24', blockId, categoryId: 'gym', plannedStartAt: start, plannedEndAt: end, plannedMinutes: 60, status,
  ...(status === 'partial' ? { actualMinutes: 20 } : {}),
})
const ranMorning = (status: BlockActual['status']) => actual('am', '2026-10-24T08:00:00.000Z', '2026-10-24T09:00:00.000Z', status)
const stretched = (status: BlockActual['status']) => actual('pm', '2026-10-24T18:00:00.000Z', '2026-10-24T18:30:00.000Z', status)

const day = (actuals: BlockActual[], blocks = [morning, evening]) => deriveExercise(plannerDocument({ categories: [category], blocks, actuals }), '2026-10-24')

describe('deriveExercise', () => {
  it('says nothing for a plan with no exercise category', () => {
    expect(deriveExercise(plannerDocument({ blocks: [] }), '2026-10-24')).toBeUndefined()
  })

  it('is "not planned" on a day without exercise blocks in a plan that has them', () => {
    expect(day([], [{ ...morning, days: [0] }])).toBe('not-planned')
  })

  it('says nothing while every exercise block is still unmarked', () => {
    expect(day([])).toBeUndefined()
  })

  it.each(['done', 'partial'] as const)('is a yes when a block was %s, whatever happened to the others', (status) => {
    expect(day([ranMorning(status)])).toBe('yes')
    expect(day([ranMorning('skipped'), stretched(status)])).toBe('yes')
  })

  it('is a no only when every block was skipped; one still unmarked keeps it unknown', () => {
    expect(day([ranMorning('skipped'), stretched('skipped')])).toBe('no')
    expect(day([ranMorning('skipped')])).toBeUndefined()
  })

  it('ignores answers about another day’s block of the same routine', () => {
    const yesterday = actual('am', '2026-10-23T08:00:00.000Z', '2026-10-23T09:00:00.000Z', 'done')
    expect(day([yesterday])).toBeUndefined()
  })

  it('does not count the tail of an exercise block that began yesterday', () => {
    const late: TimeBlock = { id: 'late', categoryId: 'gym', title: 'Late', days: [5], start: 1380, end: 60 }
    expect(day([], [late])).toBe('not-planned')
  })
})

describe('isExerciseCategory', () => {
  it.each(['Exercise', 'ejercicio', ' Exercice ', 'Exercício', 'Bewegung'])('recognises the template name %s', (name) => {
    expect(isExerciseCategory({ name })).toBe(true)
  })
  it('recognises the icon even after the name was edited, and nothing else', () => {
    expect(isExerciseCategory({ name: 'Gym time', icon: '🏃' })).toBe(true)
    expect(isExerciseCategory({ name: 'Work', icon: '💼' })).toBe(false)
  })
})
