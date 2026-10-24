import type { DatedOccurrence } from './time'

export interface Interval { start: number; end: number }

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const merged: Interval[] = []
  for (const interval of intervals.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
    else if (interval.end > interval.start) merged.push({ ...interval })
  }
  return merged
}

export function subtract(interval: Interval, busy: Interval[]): Interval[] {
  let free = [interval]
  for (const occupied of busy) {
    free = free.flatMap((window) => {
      if (occupied.start >= window.end || occupied.end <= window.start) return [window]
      const parts: Interval[] = []
      if (occupied.start > window.start) parts.push({ start: window.start, end: occupied.start })
      if (occupied.end < window.end) parts.push({ start: occupied.end, end: window.end })
      return parts
    })
  }
  return free
}

// Where a task may go within `range`: the blocks of its category, or - for a task with no category - every moment
// that no routine block covers ("any free time"). Calendar events and other tasks are subtracted by the caller.
export function taskWindows(occurrences: readonly DatedOccurrence[], categoryId: string | undefined, range: Interval): Interval[] {
  const clipped = (item: DatedOccurrence): Interval => ({ start: Math.max(range.start, Date.parse(item.start)), end: Math.min(range.end, Date.parse(item.end)) })
  if (categoryId !== undefined) return mergeIntervals(occurrences.filter((item) => item.categoryId === categoryId).map(clipped))
  return subtract(range, mergeIntervals(occurrences.map(clipped)))
}
