// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlannerDocument, TaskPlacement } from './model'
import { chunkIsLate } from './scheduling'
import { buildTimeline } from '@/features/today/todayTimeline'
import { taskSegmentsByDate } from '@/features/week/weekLayout'

// verify7: a 3 h task due Sunday 25 Oct (Bogotá) with only 1 h 30 min free that day is split; the Sunday pieces are on
// time and only Monday's is late. Hoy said "Tarde" and Semana "atrasada" on every piece. Lateness is per piece.
const ZONE = 'America/Bogota'
const task = { id: 'big', title: 'Informe largo', categoryId: 'work', durationMin: 180, priority: 2 as const, dueDate: '2026-10-25', createdAt: '2026-10-25T14:00:00.000Z' }
const placement: TaskPlacement = {
  taskId: 'big', overflowMinutes: 0, late: true, outsideCategory: true,
  chunks: [
    { start: '2026-10-25T15:00:00.000Z', end: '2026-10-25T15:30:00.000Z' }, // 10:00-10:30 Sunday
    { start: '2026-10-26T02:00:00.000Z', end: '2026-10-26T03:00:00.000Z' }, // 21:00-22:00 Sunday (Monday in UTC)
    { start: '2026-10-26T11:00:00.000Z', end: '2026-10-26T12:30:00.000Z' }, // 6:00-7:30 Monday
  ],
}
const document = {
  schemaVersion: 3, generation: 0, workspaceId: 'w', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'es', weekStartsOn: 1, timeZone: ZONE, onboardingDone: true, theme: 'system' },
  categories: [{ id: 'work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [], tasks: [task], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
} satisfies PlannerDocument

describe('a piece of a task is late only when it ends after the due date', () => {
  it('judges each piece against the end of the due date in the planner zone', () => {
    expect(placement.chunks.map((chunk) => chunkIsLate(task, chunk, ZONE))).toEqual([false, false, true])
    expect(chunkIsLate({ dueDate: undefined }, placement.chunks[2]!, ZONE)).toBe(false)
  })

  it('Hoy marks no Sunday piece late', () => {
    const { items } = buildTimeline({ document, today: '2026-10-25', timeZone: ZONE, external: [], placements: [placement] })
    expect(items.filter((item) => item.kind === 'task').map((item) => item.kind === 'task' && item.late)).toEqual([false, false])
  })

  it('Semana marks only the Monday piece late', () => {
    const byDate = taskSegmentsByDate([placement], document.tasks, ['2026-10-25', '2026-10-26'], ZONE)
    expect(byDate['2026-10-25']!.map((segment) => segment.late)).toEqual([false, false])
    expect(byDate['2026-10-26']!.map((segment) => segment.late)).toEqual([true])
  })
})
