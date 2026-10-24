import type { Category, PlannerDocument, TimeBlock } from '../model'
export const now = new Date('2026-10-24T12:00:00Z')
export const env = { now, timeZone: 'America/Bogota', locale: 'en', tutorialCompleted: false, idGen: () => 'workspace' }
export const clock = { now: () => new Date(now) }
export const category: Category = { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }
export const block: TimeBlock = { id: 'block', categoryId: 'work', title: 'Work', days: [6], start: 1320, end: 360 }
export function document(): PlannerDocument {
  return { schemaVersion: 2, workspaceId: 'workspace', revision: 0, updatedAt: now.toISOString(), settings: { locale: 'en', timeZone: 'America/Bogota', weekStartsOn: 1, onboardingDone: false, theme: 'system' }, categories: [structuredClone(category)], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [] }
}
// Same category values as weekStore.initializeSampleData, with synthetic stable ids.
export const sampleV1 = { categories: [
  { id: 'sleep', name: 'Sleep', color: '#6366f1', weeklyHourLimit: 56, icon: '😴' },
  { id: 'work', name: 'Work', color: '#3b82f6', weeklyHourLimit: 40, icon: '💼' },
  { id: 'exercise', name: 'Exercise', color: '#10b981', weeklyHourLimit: 7, icon: '🏃' },
  { id: 'learning', name: 'Learning', color: '#f59e0b', weeklyHourLimit: 10, icon: '📚' },
  { id: 'projects', name: 'Personal projects', color: '#8b5cf6', weeklyHourLimit: 15, icon: '🚀' },
], timeBlocks: [] }
