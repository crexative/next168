import { createEmptyDocument } from '@/core/documents'
import type { Category, PlannerDocument, TimeBlock } from '@/core/model'
import type { SetupEnv } from './setupModel'
import type { TopicId } from './setupTopics'

// Shared by the setup specs: a document builder and the English topic names.
const NAMES: Record<TopicId, string> = {
  sleep: 'Sleep', work: 'Work', study: 'Study', commute: 'Commute', exercise: 'Exercise', family: 'Family', friends: 'Friends', me: 'Time for you', learning: 'Learning',
}
export const env: SetupEnv = { topicName: (topic) => NAMES[topic] }

let counter = 0
export const newId = () => `new-${++counter}`

export function documentWith(categories: Category[] = [], blocks: TimeBlock[] = [], overrides: Partial<PlannerDocument> = {}): PlannerDocument {
  return {
    ...createEmptyDocument({ now: new Date('2026-10-26T15:15:00Z'), locale: 'en', timeZone: 'UTC', idGen: () => 'workspace-1' }),
    revision: 3, categories, blocks, ...overrides,
  }
}

export const category = (id: string, name: string, extra: Partial<Category> = {}): Category => ({ id, name, colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 }, ...extra })
export const block = (id: string, categoryId: string, days: number[], start: number, end: number, extra: Partial<TimeBlock> = {}): TimeBlock =>
  ({ id, categoryId, title: 'T', days: days as TimeBlock['days'], start, end, ...extra })
