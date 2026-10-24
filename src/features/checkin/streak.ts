import type { CheckIn } from '@/core/model'
import { addLocalDays } from '@/core/time'

// Consecutive days with a check-in, counted back from `today`. A day without one ends the streak.
export function checkInStreak(checkIns: Pick<CheckIn, 'date'>[], today: string): number {
  const dates = new Set(checkIns.map((checkIn) => checkIn.date))
  let count = 0
  for (let date = today; dates.has(date); date = addLocalDays(date, -1)) count += 1
  return count
}
