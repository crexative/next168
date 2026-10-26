import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '@/core/documents'
import { scheduleTasks } from '@/core/scheduler'
import { fitTasks } from '@/core/scheduling'
import type { PlannerDocument, Task } from '@/core/model'
import { planTasks, recentDone } from './grouping'

const NOW = new Date('2026-10-26T08:00:00Z') // Monday

function documentWith(tasks: Task[]): PlannerDocument {
  const base = createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'ws' })
  return {
    ...base,
    categories: [{ id: 'study', name: 'Study', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
    blocks: [{ id: 'b1', categoryId: 'study', title: 'Study', days: [2], start: 19 * 60, end: 20 * 60 }],
    tasks,
  }
}

const task = (id: string, durationMin: number, extra: Partial<Task> = {}): Task => ({
  id, title: id, categoryId: 'study', durationMin, priority: 2, createdAt: '2026-10-25T10:00:00Z', ...extra,
})

describe('planTasks', () => {
  it('keeps a task placed in fragments as one entry that lists every fragment', () => {
    const document = documentWith([task('review', 60)])
    document.blocks = [{ id: 'b1', categoryId: 'study', title: 'Study', days: [2], start: 9 * 60, end: 11 * 60 }]
    const busy = [{ start: '2026-10-27T09:46:00Z', end: '2026-10-27T10:46:00Z' }]
    const plan = planTasks(document, scheduleTasks({ document, busy, now: NOW, timeZone: 'UTC' }))
    const entries = plan.days.flatMap((day) => day.entries)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.chunks.map((chunk) => [chunk.start.slice(11, 16), chunk.end.slice(11, 16)])).toEqual([['09:00', '09:46'], ['10:46', '11:00']])
    expect(entries[0]!.chunk).toBe(entries[0]!.chunks[0])
  })

  it('groups chunks by local day and reports one hour of overflow for a two hour task', () => {
    const document = documentWith([task('essay', 120)])
    const plan = planTasks(document, scheduleTasks({ document, busy: [], now: NOW, timeZone: 'UTC' }))
    expect(plan.days.map((day) => day.date)).toEqual(['2026-10-27'])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]!.placement.overflowMinutes).toBe(60)
    expect(plan.unplaced).toEqual([])
  })

  it('lists tasks without any slot as unplaced and ignores completed ones', () => {
    const document = documentWith([task('a', 30, { categoryId: 'study', dueDate: '2026-10-26' }), task('done', 30, { doneAt: '2026-10-26T07:00:00Z' })])
    document.blocks = []
    const plan = planTasks(document, scheduleTasks({ document, busy: [], now: NOW, timeZone: 'UTC' }))
    expect(plan.unplaced.map((entry) => entry.id)).toEqual(['a'])
    expect(plan.days).toEqual([])
  })

  it('keeps the eight most recently completed tasks', () => {
    const done = Array.from({ length: 10 }, (_, index) => task(`t${index}`, 15, { doneAt: `2026-10-2${index}T10:00:00Z` }))
    const recent = recentDone([...done, task('open', 15)])
    expect(recent).toHaveLength(8)
    expect(recent[0]!.id).toBe('t9')
  })
})

describe('planTasks sections (Vencidas · days · Más adelante · Sin fecha)', () => {
  const todo = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, priority: 2, createdAt: '2026-10-25T10:00:00Z', ...extra })

  it('files every open task in exactly one section, so a new task is never hidden', () => {
    const document = documentWith([
      todo('old-bill', { dueDate: '2026-10-20' }),
      todo('call-mum'),
      todo('newest', { createdAt: '2026-10-26T07:00:00Z' }),
      todo('today-todo', { dueDate: '2026-10-26' }),
      todo('friday', { dueDate: '2026-10-30' }),
      todo('next-month', { dueDate: '2026-11-20' }),
      todo('dentist', { dueDate: '2026-10-27', at: 540 }),
      task('essay', 60, { categoryId: undefined }),
    ])
    document.blocks = []
    const plan = planTasks(document, fitTasks({ document, busy: [], now: NOW, timeZone: 'UTC' }), '2026-10-26')
    expect(plan.overdue.map((item) => item.id)).toEqual(['old-bill'])
    expect(plan.undated.map((item) => item.id)).toEqual(['newest', 'call-mum'])
    expect(plan.later.map((item) => item.id)).toEqual(['next-month'])
    expect(plan.days.map((day) => [day.date, day.entries.map((entry) => entry.task.id)])).toEqual([
      ['2026-10-26', ['essay', 'today-todo']],
      ['2026-10-27', ['dentist']],
      ['2026-10-30', ['friday']],
    ])
    expect(plan.days[1]!.entries[0]!.at).toBe('2026-10-27T09:00:00.000Z')
    const filed = [...plan.overdue, ...plan.undated, ...plan.later, ...plan.unplaced, ...plan.days.flatMap((day) => day.entries.map((entry) => entry.task))]
    expect(filed.map((item) => item.id).sort()).toEqual(document.tasks.map((item) => item.id).sort())
  })
})
