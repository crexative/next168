import { TOTAL_WEEK_HOURS } from '@/core/model'

export const WEEK_CELLS = TOTAL_WEEK_HOURS
export const FREE_CELL = -1

// The week's 168 hours as 168 cells: each entry is the index of the group that owns the cell, or FREE_CELL. Cells are
// handed out by largest remainder of planned hours; when routines overlap (more than 168 planned hours) every group
// is scaled by 168 h / planned total, so the cells show proportions and the caption says so.
export function cellsFor(groups: readonly { plannedMinutes: number }[]): number[] {
  const totalMinutes = groups.reduce((sum, group) => sum + Math.max(0, group.plannedMinutes), 0)
  const weekMinutes = WEEK_CELLS * 60
  const scale = totalMinutes > weekMinutes ? weekMinutes / totalMinutes : 1
  const exact = groups.map((group) => (Math.max(0, group.plannedMinutes) * scale) / 60)
  const counts = exact.map(Math.floor)
  let left = Math.round(Math.min(totalMinutes, weekMinutes) / 60) - counts.reduce((sum, count) => sum + count, 0)
  const byRemainder = exact.map((value, index) => ({ index, remainder: value - counts[index]! }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of byRemainder) {
    if (left <= 0) break
    counts[index]! += 1
    left -= 1
  }
  const cells = counts.flatMap((count, index) => Array.from({ length: count }, () => index))
  while (cells.length < WEEK_CELLS) cells.push(FREE_CELL)
  return cells.slice(0, WEEK_CELLS)
}
