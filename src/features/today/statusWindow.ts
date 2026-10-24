// The "how did it go?" question belongs to the end of an item: its last ten minutes, or any time after it ended.
export const STATUS_WINDOW_MINUTES = 10

// Half-open like every range here: an item that ends exactly now has ended. An item that has not started
// cannot be reported on, however short it is.
export function isReportable(item: { start: string; end: string }, now: Date): boolean {
  const instant = now.getTime()
  return Date.parse(item.start) <= instant && Date.parse(item.end) - instant <= STATUS_WINDOW_MINUTES * 60_000
}
