import { describe, expect, it } from 'vitest'
import type { Task } from '@/core/model'
import { plannerDocument } from '@/features/week/testDocument'
import { snapshotOf } from '@/features/insights/entryGuard'
import { completeTask, reopenTask } from './taskCompletion'

const task: Task = { id: 't', title: 'Call', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T00:00:00.000Z' }
const AT = new Date('2026-10-21T10:15:00Z')

describe('task completion', () => {
  it('stamps doneAt once and hands back a snapshot of the entry it left behind', () => {
    const draft = plannerDocument({ tasks: [{ ...task }] })
    const snapshot = completeTask(draft, 't', AT)
    expect(draft.tasks[0]!.doneAt).toBe(AT.toISOString())
    expect(snapshot).toBe(snapshotOf(draft.tasks[0]))
  })

  it('does nothing for a task that is already done or missing', () => {
    const draft = plannerDocument({ tasks: [{ ...task, doneAt: '2026-10-21T08:00:00.000Z' }] })
    expect(completeTask(draft, 't', AT)).toBeUndefined()
    expect(draft.tasks[0]!.doneAt).toBe('2026-10-21T08:00:00.000Z')
    expect(completeTask(draft, 'missing', AT)).toBeUndefined()
  })

  it('reopens only the entry the undo was made for', () => {
    const draft = plannerDocument({ tasks: [{ ...task }] })
    const snapshot = completeTask(draft, 't', AT)
    draft.tasks[0]!.title = 'Renamed elsewhere'
    expect(() => reopenTask(draft, { id: 't' }, snapshot)).toThrow('changed-elsewhere')
    expect(draft.tasks[0]!.doneAt).toBe(AT.toISOString())
    draft.tasks[0]!.title = 'Call'
    reopenTask(draft, { id: 't' }, snapshot)
    expect(draft.tasks[0]!.doneAt).toBeUndefined()
  })
})
