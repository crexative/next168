export interface SegmentSource {
  key: string
  minutes: number
}

export const BAR_CELLS = 168

// Largest-remainder allocation keeps the bar at exactly 168 cells, one per hour of the week.
// When more than 168 hours are planned (overlapping blocks) the shares are scaled down.
export function allocateCells(sources: SegmentSource[], unassignedKey: string): string[] {
  const planned = sources.filter((source) => source.minutes > 0)
  const plannedTotal = planned.reduce((sum, source) => sum + source.minutes, 0)
  const weekMinutes = BAR_CELLS * 60
  const unassigned = Math.max(0, weekMinutes - plannedTotal)
  const parts = [...planned, ...(unassigned > 0 ? [{ key: unassignedKey, minutes: unassigned }] : [])]
  const total = parts.reduce((sum, part) => sum + part.minutes, 0)
  if (total === 0) return Array.from({ length: BAR_CELLS }, () => unassignedKey)

  const shares = parts.map((part) => {
    const exact = (part.minutes / total) * BAR_CELLS
    return { key: part.key, cells: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let left = BAR_CELLS - shares.reduce((sum, share) => sum + share.cells, 0)
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (left === 0) break
    share.cells += 1
    left -= 1
  }
  return shares.flatMap((share) => Array.from({ length: share.cells }, () => share.key))
}
