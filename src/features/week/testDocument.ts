import type { PlannerDocument, TimeBlock } from '@/core/model'

export function plannerDocument(overrides: Partial<PlannerDocument> = {}): PlannerDocument {
  return {
    schemaVersion: 2, workspaceId: 'workspace', revision: 0, updatedAt: '2026-10-20T00:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
      { id: 'sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'gym', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 2 } },
    ],
    blocks: [],
    tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
    ...overrides,
  }
}

export const deepWork: TimeBlock = { id: 'deep', categoryId: 'work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 }
export const sleep: TimeBlock = { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 }
