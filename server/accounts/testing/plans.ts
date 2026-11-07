// Synthetic planner documents for the sync tests: a small valid one, and one at every array maximum of
// `plannerDocumentSchema` (src/core/model.ts) with the fields filled the way the app fills them or, worst case, with
// incompressible text up to each field's limit.
import type { PlannerDocument } from '../planCodec'

export function smallPlan(overrides: Partial<PlannerDocument> = {}): PlannerDocument {
  return {
    schemaVersion: 3,
    workspaceId: 'ws-synthetic-0001',
    revision: 1,
    generation: 0,
    updatedAt: '2026-10-20T10:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [{ id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
    blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
    ...overrides,
  }
}

function prng(seed: number): () => number {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 0x100000000
  }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '

export type Fill = 'realistic' | 'incompressible'

const uuid = (random: () => number): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => (c === 'x' ? Math.floor(random() * 16) : (Math.floor(random() * 4) + 8)).toString(16))

export interface Counts {
  categories: number
  blocks: number
  tasks: number
  checkIns: number
  actuals: number
  events: number
  calendarSources: number
  appliedIds: number
}

/** The array maxima of `plannerDocumentSchema` (src/core/model.ts:246-259). */
export const MAXIMA: Counts = { categories: 100, blocks: 1000, tasks: 5000, checkIns: 3660, actuals: 50000, events: 5000, calendarSources: 20, appliedIds: 200 }

/** A heavy but plausible plan: a year of use with a busy week. */
export const HEAVY: Counts = { categories: 20, blocks: 100, tasks: 1000, checkIns: 365, actuals: 5000, events: 500, calendarSources: 5, appliedIds: 200 }

export const planAtMaxima = (fill: Fill): PlannerDocument => planWithCounts(MAXIMA, fill)

/** `incompressible` fills each text field to its limit with random characters. */
export function planWithCounts(counts: Counts, fill: Fill): PlannerDocument {
  const random = prng(fill === 'realistic' ? 7 : 11)
  const text = (limit: number, realistic: string): string => {
    if (fill === 'realistic') return realistic
    let out = ''
    for (let i = 0; i < limit; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)]
    return out
  }
  const id = (): string => uuid(random)
  const day = (n: number): string => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString().slice(0, 10)
  const instant = (minutes: number): string => new Date(Date.UTC(2020, 0, 1) + minutes * 60_000).toISOString()
  const categories = Array.from({ length: counts.categories }, (_, i) => ({
    id: id(), name: text(60, `Category ${i}`), colorKey: 'blue' as const, icon: text(16, 'icon'), goal: { type: 'min' as const, hoursPerWeek: 8 },
  }))
  const categoryId = (i: number): string => categories[i % categories.length]!.id
  const blocks = Array.from({ length: counts.blocks }, (_, i) => ({
    id: id(), categoryId: categoryId(i), title: text(120, `Block ${i} focus session`), notes: text(500, 'Recurring routine block'), days: [0, 1, 2, 3, 4, 5, 6], start: 60, end: 120,
  }))
  return {
    schemaVersion: 3,
    workspaceId: id(),
    revision: 1_000_000,
    generation: 1000,
    updatedAt: '2026-10-20T10:00:00.000Z',
    settings: { locale: 'en-US', weekStartsOn: 1, timeZone: 'America/Argentina/ComodRivadavia', onboardingDone: true, theme: 'system' },
    categories,
    blocks,
    tasks: Array.from({ length: counts.tasks }, (_, i) => ({
      id: id(), title: text(120, `Task ${i}: write the quarterly report`), categoryId: categoryId(i), durationMin: 60, dueDate: day(i % 1000), notes: text(2000, `Notes for task ${i}`),
      priority: 2 as const, doneAt: instant(i), createdAt: instant(i),
    })),
    checkIns: Array.from({ length: counts.checkIns }, (_, i) => ({
      date: day(i), bedtime: 1380, wake: 420, workEnd: 1080, exercise: 'yes' as const, stress: 3, note: text(280, 'A calm day'),
    })),
    actuals: Array.from({ length: counts.actuals }, (_, i) => ({
      date: day(i % 3000), blockId: blocks[i % blocks.length]!.id, categoryId: categoryId(i), plannedStartAt: instant(i * 90), plannedEndAt: instant(i * 90 + 60), plannedMinutes: 60, status: 'done' as const,
    })),
    events: Array.from({ length: counts.events }, (_, i) => ({
      id: id(), title: text(120, `Event ${i}`), start: instant(i * 120), end: instant(i * 120 + 60), allDay: false, location: text(200, 'Room 4'), notes: text(2000, 'Agenda'),
      attendees: Array.from({ length: fill === 'realistic' ? 3 : 50 }, (_, a) => `person${a}.${i}@example.com`),
    })),
    calendarSources: Array.from({ length: counts.calendarSources }, (_, i) => ({
      id: id(), name: text(80, `Calendar ${i}`), kind: 'url' as const, url: `https://calendar.example.com/feed/${i}.ics`, colorKey: 'green' as const, lastSyncedAt: instant(i), lastError: text(200, ''),
    })),
    appliedProposalIds: Array.from({ length: counts.appliedIds }, () => id()),
    appliedCaptureIds: Array.from({ length: counts.appliedIds }, () => id()),
  }
}
