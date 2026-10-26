import type { PlannerDocument } from '@/core/model'

// A realistic Wednesday 2026-10-21 10:15 UTC: five categories, a routine with an overnight block, open and done
// tasks, and events in, before and after the week.
export const NOW = new Date('2026-10-21T10:15:00Z')

export function realisticWeek(overrides: Partial<PlannerDocument> = {}): PlannerDocument {
  return {
    schemaVersion: 3, generation: 0, workspaceId: 'ws-realistic', revision: 7, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
      { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
      { id: 'c-exercise', name: 'Exercise', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 3 } },
      { id: 'c-study', name: 'Learning and side projects', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'c-home', name: 'Home and errands', colorKey: 'teal', goal: { type: 'max', hoursPerWeek: 8 } },
    ],
    blocks: [
      { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 780 },
      { id: 'b-meet', categoryId: 'c-work', title: 'Team sync', days: [3], start: 840, end: 900 },
      { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
      { id: 'b-gym', categoryId: 'c-exercise', title: 'Gym', days: [2, 4], start: 1080, end: 1140 },
      { id: 'b-run', categoryId: 'c-exercise', title: 'Long run', days: [6], start: 480, end: 570 },
      { id: 'b-study', categoryId: 'c-study', title: 'Evening course', days: [1, 3], start: 1170, end: 1260 },
      { id: 'b-chores', categoryId: 'c-home', title: 'Groceries and cleaning', days: [6], start: 600, end: 720 },
    ],
    tasks: [
      { id: 't-report', title: 'Write the quarterly report', categoryId: 'c-work', durationMin: 90, priority: 1, dueDate: '2026-10-23', createdAt: '2026-10-20T08:00:00.000Z' },
      { id: 't-form', title: 'Hand in tax form', categoryId: 'c-home', durationMin: 60, priority: 2, dueDate: '2026-10-21', createdAt: '2026-10-20T08:00:00.000Z' },
      { id: 't-run', title: 'Plan the long run route', categoryId: 'c-exercise', durationMin: 30, priority: 3, createdAt: '2026-10-20T08:00:00.000Z' },
      { id: 't-read', title: 'Read chapter 4', categoryId: 'c-study', durationMin: 45, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' },
      { id: 't-done', title: 'Book the dentist', categoryId: 'c-home', durationMin: 15, priority: 2, doneAt: '2026-10-20T09:00:00.000Z', createdAt: '2026-10-19T08:00:00.000Z' },
    ],
    checkIns: [], actuals: [],
    events: [
      { id: 'e-review', title: 'Design review', start: '2026-10-22T14:00:00.000Z', end: '2026-10-22T15:00:00.000Z', allDay: false, attendees: [] },
      { id: 'e-dinner', title: 'Dinner with Ana', start: '2026-10-23T19:30:00.000Z', end: '2026-10-23T21:00:00.000Z', allDay: false, location: 'Casa Lola', attendees: [] },
      { id: 'e-dentist', title: 'Dentist', start: '2026-10-24T09:00:00.000Z', end: '2026-10-24T09:45:00.000Z', allDay: false, attendees: [] },
      { id: 'e-trip', title: 'Weekend trip', start: '2026-10-24T00:00:00.000Z', end: '2026-10-26T00:00:00.000Z', allDay: true, attendees: [] },
      { id: 'e-last-week', title: 'Last week’s party', start: '2026-10-17T20:00:00.000Z', end: '2026-10-18T22:00:00.000Z', allDay: false, attendees: [] },
      { id: 'e-next-week', title: 'Next week’s offsite', start: '2026-10-27T09:00:00.000Z', end: '2026-10-27T17:00:00.000Z', allDay: false, attendees: [] },
    ],
    calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
    ...overrides,
  }
}
