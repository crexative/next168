import { describe, expect, it } from 'vitest'
import { plannerDocumentSchema, proposalInputSchema, timeBlockSchema } from './model'

const emptyDocument = {
  schemaVersion: 2,
  workspaceId: 'w1',
  revision: 0,
  updatedAt: '2026-10-24T05:00:00.000Z',
  settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: false, theme: 'system' },
  categories: [{ id: 'sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } }],
  blocks: [{ id: 'b1', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 22 * 60, end: 6 * 60 }],
  tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [],
}

describe('planner document contract', () => {
  it('accepts a minimal v2 document with an overnight block', () => {
    expect(plannerDocumentSchema.safeParse(emptyDocument).success).toBe(true)
  })

  it('rejects zero-length blocks and duplicate days', () => {
    expect(timeBlockSchema.safeParse({ ...emptyDocument.blocks[0], end: 22 * 60 }).success).toBe(false)
    expect(timeBlockSchema.safeParse({ ...emptyDocument.blocks[0], days: [1, 1] }).success).toBe(false)
  })

  it('rejects unknown proposal operations', () => {
    const result = proposalInputSchema.safeParse({ contractVersion: '1.0', baseRevision: 0, summary: '', ops: [{ op: 'apply_changes' }] })
    expect(result.success).toBe(false)
  })
})
