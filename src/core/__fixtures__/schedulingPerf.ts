import type { BusyInterval, PlannerDocument, Task, TimeBlock } from '../model'

// Deterministic planners for the scheduler's performance and equivalence checks (P0 spec §2, `bench2.ts`):
// exactly 30 % of tasks in Work, 25 % with a due date, durations 15/30/60/15, now = Mon 2026-10-26 08:02 in Bogotá.
// "typical" has 3 routines and 40 busy intervals; "dense" has 10 routines and 150 busy intervals.
// Relative imports only, so the e2e suite can build the same planners.

export const PERF_TIME_ZONE = 'America/Bogota'
export const PERF_NOW = new Date('2026-10-26T13:02:00Z')
export const PERF_SIZES = [50, 200, 1000] as const
export type PerfScenarioName = 'typical' | 'dense'

const DUE_DATES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30', '2026-11-02']

export function perfTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${String(i).padStart(4, '0')}`,
    title: `Task ${i}`,
    durationMin: [15, 30, 60, 15][i % 4]!,
    priority: ((i % 3) + 1) as 1 | 2 | 3,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    ...(i % 10 < 3 ? { categoryId: 'work' } : {}),
    ...(i % 4 === 0 ? { dueDate: DUE_DATES[(i / 4) % DUE_DATES.length]! } : {}),
  }))
}

export const typicalBlocks: TimeBlock[] = [
  { id: 'deep', categoryId: 'work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 660 },
  { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
  { id: 'gym', categoryId: 'gym', title: 'Gym', days: [1, 3, 5], start: 1080, end: 1140 },
]

export const denseBlocks: TimeBlock[] = [
  ...typicalBlocks,
  { id: 'work-am', categoryId: 'work', title: 'Work AM', days: [1, 2, 3, 4, 5], start: 660, end: 780 },
  { id: 'work-pm', categoryId: 'work', title: 'Work PM', days: [1, 2, 3, 4, 5], start: 840, end: 1020 },
  { id: 'lunch', categoryId: 'sleep', title: 'Lunch', days: [0, 1, 2, 3, 4, 5, 6], start: 780, end: 840 },
  { id: 'commute-am', categoryId: 'gym', title: 'Commute', days: [1, 2, 3, 4, 5], start: 480, end: 540 },
  { id: 'study', categoryId: 'gym', title: 'Study', days: [2, 4], start: 1140, end: 1260 },
  { id: 'family', categoryId: 'sleep', title: 'Family', days: [0, 6], start: 600, end: 960 },
  { id: 'weekend-work', categoryId: 'work', title: 'Side project', days: [6], start: 480, end: 600 },
]

// Busy intervals spread evenly over the week from now, 30/45/60 minutes long, starting off the five-minute grid.
export function perfBusy(count: number, now: Date = PERF_NOW): BusyInterval[] {
  return Array.from({ length: count }, (_, i) => {
    const start = now.getTime() + Math.floor((i * 7 * 24 * 60) / count) * 60_000 + 7 * 60_000
    return { start: new Date(start).toISOString(), end: new Date(start + (30 + (i % 3) * 15) * 60_000).toISOString() }
  })
}

export const PERF_SCENARIOS: Record<PerfScenarioName, { blocks: TimeBlock[]; busyCount: number }> = {
  typical: { blocks: typicalBlocks, busyCount: 40 },
  dense: { blocks: denseBlocks, busyCount: 150 },
}

export function perfPlanner(blocks: TimeBlock[], tasks: Task[], timeZone: string = PERF_TIME_ZONE): PlannerDocument {
  return {
    schemaVersion: 3, generation: 0, workspaceId: 'workspace-perf', revision: 0, updatedAt: '2026-10-20T00:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone, onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
      { id: 'sleep', name: 'Sleep', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'gym', name: 'Exercise', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 2 } },
    ],
    blocks, tasks, checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
  }
}

export interface PerfCase {
  name: string
  document: PlannerDocument
  busy: BusyInterval[]
  now: Date
  timeZone: string
}

export function perfCase(scenario: PerfScenarioName, size: number): PerfCase {
  const { blocks, busyCount } = PERF_SCENARIOS[scenario]
  return { name: `${scenario}-${size}`, document: perfPlanner(blocks, perfTasks(size)), busy: perfBusy(busyCount), now: PERF_NOW, timeZone: PERF_TIME_ZONE }
}

export const perfCases = (): PerfCase[] =>
  (['typical', 'dense'] as const).flatMap((scenario) => PERF_SIZES.map((size) => perfCase(scenario, size)))
