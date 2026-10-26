import type { Category, PlannerDocument, TimeBlock } from '@/core/model'
import type { Measure } from './fitText'
import { graphemes } from './fitText'

export const BLOCK_SENTINEL = 'SENTINEL-BLOCK'
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

// Every field that must never reach the card carries a unique sentinel; block titles carry BLOCK_SENTINEL, the only
// ones the card may show (with names on). Categories carry an unexpected `secret` property: spreading a category
// object into the summary leaks it.
export function sentinelDocument(): PlannerDocument {
  const category = (id: string, name: string, colorKey: Category['colorKey']): Category => ({
    id, name, colorKey, goal: { type: 'max', hoursPerWeek: 40 }, secret: `SENTINEL-CATEGORY-SECRET-${id}`,
  } as Category)
  const block = (id: string, categoryId: string, title: string, days: number[], start: number, end: number): TimeBlock => ({
    id: `SENTINEL-BLOCK-ID-${id}`, categoryId, title, notes: `SENTINEL-BLOCK-NOTE-${id}`, days, start, end,
  })
  return {
    schemaVersion: 3,
    workspaceId: 'SENTINEL-WORKSPACE',
    revision: 7,
    generation: 0,
    updatedAt: '2026-10-21T10:15:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [
      category('work', 'Work', 'blue'),
      category('sleep', 'Sleep', 'purple'),
      category('gym', 'Gym', 'green'),
    ],
    blocks: [
      block('w1', 'work', `${BLOCK_SENTINEL}-W1`, [1, 2, 3, 4, 5], 540, 1020),
      block('w2', 'work', `${BLOCK_SENTINEL}-W2`, [1, 3], 1080, 1140),
      block('w3', 'work', `${BLOCK_SENTINEL}-W3`, [6], 600, 660),
      block('w4', 'work', `${BLOCK_SENTINEL}-W4`, [0], 600, 630),
      block('s1', 'sleep', `${BLOCK_SENTINEL}-S1`, EVERY_DAY, 1380, 420),
      block('g1', 'gym', `${BLOCK_SENTINEL}-G1`, [2, 4], 420, 480),
    ],
    tasks: [{ id: 'SENTINEL-TASK-ID', title: 'SENTINEL-TASK-TITLE', categoryId: 'work', durationMin: 60, priority: 1, createdAt: '2026-10-20T08:00:00.000Z', dueDate: '2026-10-22' }],
    checkIns: [{ date: '2026-10-20', bedtime: 1350, wake: 400, workEnd: 1080, exercise: 'yes', stress: 2, note: 'SENTINEL-CHECKIN-NOTE' }],
    actuals: [{ date: '2026-10-20', blockId: 'SENTINEL-BLOCK-ID-g1', categoryId: 'gym', plannedStartAt: '2026-10-20T07:00:00.000Z', plannedEndAt: '2026-10-20T08:00:00.000Z', plannedMinutes: 60, status: 'done' }],
    events: [{
      id: 'SENTINEL-EVENT-ID', title: 'SENTINEL-EVENT-TITLE', start: '2026-10-22T14:00:00.000Z', end: '2026-10-22T15:00:00.000Z',
      allDay: false, location: 'SENTINEL-EVENT-LOCATION', notes: 'SENTINEL-EVENT-NOTES', attendees: ['sentinel-attendee@example.invalid'],
    }],
    calendarSources: [{ id: 'SENTINEL-SOURCE-ID', name: 'SENTINEL-SOURCE-NAME', kind: 'url', url: 'https://sentinel.example.invalid/cal.ics', colorKey: 'teal' }],
    appliedProposalIds: ['SENTINEL-PROPOSAL'],
    appliedCaptureIds: [],
  }
}

export function plannedDocument(categories: Category[], blocks: TimeBlock[]): PlannerDocument {
  return { ...sentinelDocument(), categories, blocks, tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [] }
}

const plainCategory = (id: string, name: string, colorKey: Category['colorKey'] = 'blue', extra: Partial<Category> = {}): Category => ({
  id, name, colorKey, goal: { type: 'none', hoursPerWeek: 0 }, ...extra,
})

// Routines that add up to 465 planned hours in the 168-hour week.
export function overlapDocument(): PlannerDocument {
  return plannedDocument(
    [plainCategory('a', 'Alpha', 'blue'), plainCategory('b', 'Beta', 'green'), plainCategory('c', 'Gamma', 'orange'), plainCategory('d', 'Delta', 'pink')],
    [
      { id: 'a', categoryId: 'a', title: `${BLOCK_SENTINEL}-A`, days: EVERY_DAY, start: 0, end: 1380 },
      { id: 'b', categoryId: 'b', title: `${BLOCK_SENTINEL}-B`, days: EVERY_DAY, start: 0, end: 1380 },
      { id: 'c', categoryId: 'c', title: `${BLOCK_SENTINEL}-C`, days: EVERY_DAY, start: 0, end: 1200 },
      { id: 'd', categoryId: 'd', title: `${BLOCK_SENTINEL}-D`, days: [1], start: 0, end: 180 },
    ],
  )
}

// n categories with one block each, of decreasing length (3 h down), on separate hours of the week.
export function manyCategoriesDocument(count: number, name: (index: number) => string = (index) => `Category ${index + 1}`): PlannerDocument {
  const keys: Category['colorKey'][] = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow', 'red', 'gray']
  const categories = Array.from({ length: count }, (_, index) => plainCategory(`c${index}`, name(index), keys[index % keys.length]))
  const blocks = categories.map((category, index) => ({
    id: `b${index}`, categoryId: category.id, title: `${BLOCK_SENTINEL}-${index}`, days: [index % 7], start: (index % 6) * 240, end: (index % 6) * 240 + 60 + (count - index) * 3,
  }))
  return plannedDocument(categories, blocks)
}

export function singleCategoryDocument(extra: Partial<Category> = {}, name = 'Sleep'): PlannerDocument {
  return plannedDocument([plainCategory('only', name, 'purple', extra)], [{ id: 'only', categoryId: 'only', title: `${BLOCK_SENTINEL}-ONLY`, days: EVERY_DAY, start: 1380, end: 420 }])
}

// A pessimistic measurer: every grapheme as wide as the widest glyph (one em), whatever the font.
export const widestGlyphMeasure: Measure = (text, font) => graphemes(text).length * font.size
