import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { PlannerDocument } from '@/core/model'
import { keepWhereTheyWere, resetPlacementMemory, useTaskPlacements } from './taskPlacement'

const document: PlannerDocument = {
  schemaVersion: 2, workspaceId: 'w', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
  settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
  categories: [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'b', categoryId: 'work', title: 'Deep work', days: [0, 1, 2, 3, 4, 5, 6], start: 540, end: 660 }],
  tasks: [{ id: 'report', title: 'Report', categoryId: 'work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
  checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
}
const at = (time: string) => new Date(`2026-10-21T${time}:00Z`)

function mountPlacements(initial: Date) {
  const now = ref(initial)
  const scope = effectScope()
  const result = scope.run(() => useTaskPlacements(() => ({ document, busy: [], now: now.value, timeZone: 'UTC', days: 7 })))!
  return { now, scope, ...result }
}
const first = (placements: { chunks: { start: string }[] }[]) => placements[0]!.chunks[0]!.start.slice(0, 16)

beforeEach(resetPlacementMemory)

describe('useTaskPlacements', () => {
  it('keeps the task where it was while the clock moves on', async () => {
    const view = mountPlacements(at('09:07'))
    expect(first(view.placements.value)).toBe('2026-10-21T09:10')
    view.now.value = at('09:20')
    await nextTick()
    expect(first(view.placements.value)).toBe('2026-10-21T09:10')
    view.scope.stop()
  })

  it('remembers the day for the next time Week is opened', () => {
    mountPlacements(at('09:07')).scope.stop()
    const reopened = mountPlacements(at('09:20'))
    expect(first(reopened.placements.value)).toBe('2026-10-21T09:10')
    reopened.scope.stop()
  })

  it('announces a task that moves on to tomorrow, and Undo keeps it in its slot for the rest of the day', async () => {
    const view = mountPlacements(at('09:07'))
    expect(view.notice.value).toBeNull()
    view.now.value = at('10:05')
    await nextTick()
    expect(first(view.placements.value)).toBe('2026-10-21T09:10')
    view.now.value = at('11:20')
    await nextTick()
    expect(first(view.placements.value)).toBe('2026-10-22T09:00')
    const notice = view.notice.value!
    expect(notice.titles).toEqual(['Report'])
    expect(notice.moved[0]).toMatchObject({ from: '2026-10-21', to: '2026-10-22' })

    keepWhereTheyWere(notice)
    view.recompute()
    expect(first(view.placements.value)).toBe('2026-10-21T09:10')
    view.scope.stop()
  })
})
