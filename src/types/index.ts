export interface Category {
  id: string
  name: string
  color: string
  weeklyHourLimit: number
  icon?: string
}

export interface TimeBlock {
  id: string
  categoryId: string
  title: string
  description?: string
  dayOfWeek: number
  startTime: string
  endTime: string
  durationMinutes: number
}

export interface CategoryStats {
  categoryId: string
  totalHours: number
  totalMinutes: number
  percentageOfWeek: number
  percentageOfLimit: number
  remainingHours: number
}

export interface WeekData {
  categories: Category[]
  timeBlocks: TimeBlock[]
}

export const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

export const TOTAL_WEEK_HOURS = 168
