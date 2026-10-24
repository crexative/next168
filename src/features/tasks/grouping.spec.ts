import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '@/core/documents'
import { scheduleTasks } from '@/core/scheduler'
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
