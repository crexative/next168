import { formatDuration } from '@/ui/format'

// A countdown in the shared duration format ("45 min", "2 h", "1 h 30 min"), rounded up so it never shows 0.
export function formatSpan(minutes: number): string {
  return formatDuration(Math.max(1, Math.ceil(minutes)))
}
