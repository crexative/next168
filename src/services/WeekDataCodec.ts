import type { WeekData } from '@/types'
import { object } from './AgendaService'
import { isValidTimeFormat, calculateDurationMinutes } from '@/utils/timeCalculator'
export function decodeWeekData(value: unknown): WeekData {
  const data = object(value)
  if (!Array.isArray(data.categories) || !Array.isArray(data.timeBlocks) || data.categories.length > 5000 || data.timeBlocks.length > 5000) throw new Error('Invalid routine backup')
  const categories = data.categories.map(value => {
    const c = object(value)
    if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || typeof c.color !== 'string' ||
      typeof c.weeklyHourLimit !== 'number' || !Number.isFinite(c.weeklyHourLimit) || c.weeklyHourLimit <= 0 || c.weeklyHourLimit > 168 ||
      (c.icon !== undefined && typeof c.icon !== 'string')) throw new Error('Invalid category')
    return { ...c }
  })
  const timeBlocks = data.timeBlocks.map(value => {
    const b = object(value)
    if (typeof b.id !== 'string' || !b.id || typeof b.title !== 'string' || !b.title.trim() ||
      !categories.some(c => c.id === b.categoryId) || typeof b.dayOfWeek !== 'number' || !Number.isInteger(b.dayOfWeek) || b.dayOfWeek < 0 || b.dayOfWeek > 6 ||
      typeof b.startTime !== 'string' || !isValidTimeFormat(b.startTime) || typeof b.endTime !== 'string' || !isValidTimeFormat(b.endTime) ||
      b.startTime === b.endTime || (b.description !== undefined && typeof b.description !== 'string') ||
      (b.repeatDays !== undefined && (!Array.isArray(b.repeatDays) || b.repeatDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)))) throw new Error('Invalid routine block')
    return { ...b, durationMinutes: calculateDurationMinutes(b.startTime, b.endTime) }
  })
  for (const entries of [categories, timeBlocks]) if (new Set(entries.map(entry => (entry as Record<string, unknown>).id)).size !== entries.length) throw new Error('Duplicate routine IDs')
  return { categories, timeBlocks } as unknown as WeekData
}
