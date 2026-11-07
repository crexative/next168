// The "how did it go?" question belongs to the end of an item: its last ten minutes, or any time after it ended.
export const STATUS_WINDOW_MINUTES = 10

// The Now card keeps asking this long after a block ended while nothing else is current. 30 is a hypothesis with
// a measure and a review date (docs/design/today-screen.md §5.2).
export const ENDING_WINDOW_MINUTES = 30

// Half-open like every range here: an item that ends exactly now has ended. An item that has not started
// cannot be reported on, however short it is.
export function isReportable(item: { start: string; end: string }, now: Date): boolean {
  const instant = now.getTime()
  return Date.parse(item.start) <= instant && Date.parse(item.end) - instant <= STATUS_WINDOW_MINUTES * 60_000
}

// Ended, but not longer ago than the Ending window: the Now card may still ask about it.
export function endedRecently(item: { end: string }, now: Date): boolean {
  const sinceEnd = now.getTime() - Date.parse(item.end)
  return sinceEnd >= 0 && sinceEnd < ENDING_WINDOW_MINUTES * 60_000
}
