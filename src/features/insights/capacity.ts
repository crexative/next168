import type { Category } from '@/core/model'

export const WEEK_MINUTES = 168 * 60

export interface CapacitySegment {
  categoryId: string
  minutes: number
  percent: number
}

export interface Capacity {
  segments: CapacitySegment[]
  // Planned time as shown: never more than the week, even when blocks overlap.
  plannedMinutes: number
  availableMinutes: number
  availablePercent: number
  overbooked: boolean
}

// Disk-usage model of the week: one segment per category sized by planned time, the rest is "available".
// When blocks overlap the planned total can pass 168 h; the segments are then scaled to fill the bar exactly,
// so the bar can never be overbooked.
export function buildCapacity(categories: Pick<Category, 'id'>[], plannedByCategory: Record<string, number>): Capacity {
  const planned = categories
    .map((category) => ({ categoryId: category.id, minutes: Math.max(0, plannedByCategory[category.id] ?? 0) }))
    .filter((segment) => segment.minutes > 0)
  const rawTotal = planned.reduce((sum, segment) => sum + segment.minutes, 0)
  const denominator = Math.max(rawTotal, WEEK_MINUTES)
  return {
    segments: planned.map((segment) => ({ ...segment, percent: (segment.minutes / denominator) * 100 })),
    plannedMinutes: Math.min(rawTotal, WEEK_MINUTES),
    availableMinutes: Math.max(0, WEEK_MINUTES - rawTotal),
    availablePercent: (Math.max(0, WEEK_MINUTES - rawTotal) / denominator) * 100,
    overbooked: rawTotal > WEEK_MINUTES,
  }
}
