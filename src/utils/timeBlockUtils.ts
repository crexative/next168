import type { TimeBlock } from '@/types'

/**
 * Counts the number of unique days a time block occurs on
 * Handles cases where repeatDays may include the same day as dayOfWeek
 * @param dayOfWeek The main day (0-6)
 * @param repeatDays Optional array of additional days (0-6)
 * @returns Number of unique days
 */
export function countUniqueDays(dayOfWeek: number, repeatDays?: number[]): number {
  const uniqueDays = new Set<number>()
  uniqueDays.add(dayOfWeek)

  if (repeatDays) {
    repeatDays.forEach(day => uniqueDays.add(day))
  }

  return uniqueDays.size
}

/**
 * Counts the number of unique days for a time block
 * @param block The time block
 * @returns Number of unique days
 */
export function countBlockUniqueDays(block: TimeBlock): number {
  return countUniqueDays(block.dayOfWeek, block.repeatDays)
}
