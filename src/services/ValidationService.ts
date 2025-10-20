import type { TimeBlock, Category } from '@/types'
import { calculateDurationMinutes, isValidTimeFormat } from '@/utils/timeCalculator'

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export interface IValidationService {
  validateTimeBlock(
    timeBlock: Partial<TimeBlock>,
    existingBlocks: TimeBlock[],
    category?: Category
  ): ValidationResult
  validateCategory(category: Partial<Category>): ValidationResult
  canAddTimeToCategory(
    categoryId: string,
    durationMinutes: number,
    categories: Category[],
    timeBlocks: TimeBlock[],
    excludeBlockId?: string,
    repeatDays?: number[]
  ): ValidationResult
}

export class ValidationService implements IValidationService {
  validateTimeBlock(
    timeBlock: Partial<TimeBlock>,
    existingBlocks: TimeBlock[],
    category?: Category
  ): ValidationResult {
    const errors: string[] = []

    if (!timeBlock.title?.trim()) {
      errors.push('Title is required')
    }

    if (!timeBlock.categoryId) {
      errors.push('Category is required')
    }

    if (timeBlock.dayOfWeek === undefined || timeBlock.dayOfWeek < 0 || timeBlock.dayOfWeek > 6) {
      errors.push('Valid day of week is required')
    }

    if (!timeBlock.startTime || !isValidTimeFormat(timeBlock.startTime)) {
      errors.push('Valid start time is required (HH:mm format)')
    }

    if (!timeBlock.endTime || !isValidTimeFormat(timeBlock.endTime)) {
      errors.push('Valid end time is required (HH:mm format)')
    }

    if (timeBlock.startTime && timeBlock.endTime && isValidTimeFormat(timeBlock.startTime) && isValidTimeFormat(timeBlock.endTime)) {
      const duration = calculateDurationMinutes(timeBlock.startTime, timeBlock.endTime)

      if (duration <= 0) {
        errors.push('End time must be after start time')
      }

      if (duration > 24 * 60) {
        errors.push('Time block cannot exceed 24 hours')
      }

      const overlapping = existingBlocks.find((block) => {
        if (block.id === timeBlock.id) return false

        // Check if blocks overlap on any day
        const daysToCheck = new Set<number>()

        // Add the main day of the new block
        if (timeBlock.dayOfWeek !== undefined) {
          daysToCheck.add(timeBlock.dayOfWeek)
        }

        // Add all repeat days of the new block
        if (timeBlock.repeatDays && timeBlock.repeatDays.length > 0) {
          timeBlock.repeatDays.forEach(day => daysToCheck.add(day))
        }

        // Check if existing block occurs on any of these days
        let hasOverlappingDay = false
        daysToCheck.forEach(day => {
          if (block.dayOfWeek === day || (block.repeatDays && block.repeatDays.includes(day))) {
            hasOverlappingDay = true
          }
        })

        if (!hasOverlappingDay) return false

        return this.checkTimeOverlap(
          timeBlock.startTime!,
          timeBlock.endTime!,
          block.startTime,
          block.endTime
        )
      })

      if (overlapping) {
        errors.push(`Time overlaps with "${overlapping.title}"`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  validateCategory(category: Partial<Category>): ValidationResult {
    const errors: string[] = []

    if (!category.name?.trim()) {
      errors.push('Category name is required')
    }

    if (!category.color?.trim()) {
      errors.push('Category color is required')
    }

    if (category.weeklyHourLimit === undefined || category.weeklyHourLimit <= 0) {
      errors.push('Weekly hour limit must be greater than 0')
    }

    if (category.weeklyHourLimit && category.weeklyHourLimit > 168) {
      errors.push('Weekly hour limit cannot exceed 168 hours (total hours in a week)')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  canAddTimeToCategory(
    categoryId: string,
    durationMinutes: number,
    categories: Category[],
    timeBlocks: TimeBlock[],
    excludeBlockId?: string,
    repeatDays?: number[]
  ): ValidationResult {
    const errors: string[] = []

    const category = categories.find((c) => c.id === categoryId)
    if (!category) {
      errors.push('Category not found')
      return { isValid: false, errors }
    }

    const currentUsageMinutes = timeBlocks
      .filter((block) => block.categoryId === categoryId && block.id !== excludeBlockId)
      .reduce((total, block) => {
        // Count main day + all repeat days
        const multiplier = 1 + (block.repeatDays?.length || 0)
        return total + (block.durationMinutes * multiplier)
      }, 0)

    // For new block, count main day + all repeat days
    const newBlockMultiplier = 1 + (repeatDays?.length || 0)
    const totalNewBlockMinutes = durationMinutes * newBlockMultiplier

    const totalUsageMinutes = currentUsageMinutes + totalNewBlockMinutes
    const limitMinutes = category.weeklyHourLimit * 60

    if (totalUsageMinutes > limitMinutes) {
      const remainingMinutes = limitMinutes - currentUsageMinutes
      const remainingHours = (remainingMinutes / 60).toFixed(2)
      errors.push(
        `Exceeds category limit. Only ${remainingHours} hours remaining for "${category.name}"`
      )
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  private checkTimeOverlap(
    start1: string,
    end1: string,
    start2: string,
    end2: string
  ): boolean {
    const toMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number)
      return (hours ?? 0) * 60 + (minutes ?? 0)
    }

    const s1 = toMinutes(start1)
    const e1 = toMinutes(end1)
    const s2 = toMinutes(start2)
    const e2 = toMinutes(end2)

    return s1 < e2 && e1 > s2
  }
}

export const validationService = new ValidationService()
