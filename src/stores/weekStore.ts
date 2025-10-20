import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Category, TimeBlock, CategoryStats, WeekData } from '@/types'
import { TOTAL_WEEK_HOURS } from '@/types'
import { validationService } from '@/services/ValidationService'
import { weekDataRepository } from '@/repositories/repositoryFactory'
import { calculateDurationMinutes, minutesToHours } from '@/utils/timeCalculator'
import { countBlockUniqueDays } from '@/utils/timeBlockUtils'
import { i18n } from '@/i18n'

export const useWeekStore = defineStore('week', () => {
  // State
  const categories = ref<Category[]>([])
  const timeBlocks = ref<TimeBlock[]>([])

  // Computed
  const categoryStats = computed<CategoryStats[]>(() => {
    return categories.value.map((category) => {
      const categoryBlocks = timeBlocks.value.filter(
        (block) => block.categoryId === category.id
      )
      const totalMinutes = categoryBlocks.reduce(
        (sum, block) => {
          // Count unique days (handles duplicate days in repeatDays)
          const uniqueDays = countBlockUniqueDays(block)
          return sum + (block.durationMinutes * uniqueDays)
        },
        0
      )
      const totalHours = minutesToHours(totalMinutes)
      const limitMinutes = category.weeklyHourLimit * 60
      const percentageOfLimit = limitMinutes > 0 ? (totalMinutes / limitMinutes) * 100 : 0
      const percentageOfWeek = (totalHours / TOTAL_WEEK_HOURS) * 100
      const remainingHours = category.weeklyHourLimit - totalHours

      return {
        categoryId: category.id,
        totalHours,
        totalMinutes,
        percentageOfWeek,
        percentageOfLimit,
        remainingHours
      }
    })
  })

  const totalScheduledHours = computed<number>(() => {
    const totalMinutes = timeBlocks.value.reduce(
      (sum, block) => {
        // Count unique days (handles duplicate days in repeatDays)
        const uniqueDays = countBlockUniqueDays(block)
        return sum + (block.durationMinutes * uniqueDays)
      },
      0
    )
    return minutesToHours(totalMinutes)
  })

  const unscheduledHours = computed<number>(() => {
    return TOTAL_WEEK_HOURS - totalScheduledHours.value
  })

  // Actions - Categories
  function addCategory(category: Omit<Category, 'id'>): { success: boolean; error?: string } {
    const validation = validationService.validateCategory(category)
    if (!validation.isValid) {
      return { success: false, error: validation.errors.join(', ') }
    }

    const newCategory: Category = {
      ...category,
      id: generateId()
    }

    categories.value.push(newCategory)
    saveToStorage()
    return { success: true }
  }

  function updateCategory(
    id: string,
    updates: Partial<Omit<Category, 'id'>>
  ): { success: boolean; error?: string } {
    const index = categories.value.findIndex((c) => c.id === id)
    const existingCategory = categories.value[index]
    if (index === -1 || !existingCategory) {
      return { success: false, error: 'Category not found' }
    }

    const updatedCategory = { ...existingCategory, ...updates }
    const validation = validationService.validateCategory(updatedCategory)
    if (!validation.isValid) {
      return { success: false, error: validation.errors.join(', ') }
    }

    // Check if reducing the limit would violate existing time blocks
    if (updates.weeklyHourLimit !== undefined) {
      const categoryBlocks = timeBlocks.value.filter((block) => block.categoryId === id)
      const totalMinutes = categoryBlocks.reduce((sum, block) => sum + block.durationMinutes, 0)
      const totalHours = minutesToHours(totalMinutes)

      if (totalHours > updates.weeklyHourLimit) {
        return {
          success: false,
          error: `Cannot reduce limit below current usage (${totalHours.toFixed(2)} hours scheduled)`
        }
      }
    }

    categories.value[index] = updatedCategory
    saveToStorage()
    return { success: true }
  }

  function deleteCategory(id: string): { success: boolean; error?: string } {
    const categoryBlocks = timeBlocks.value.filter((block) => block.categoryId === id)
    if (categoryBlocks.length > 0) {
      return {
        success: false,
        error: `Cannot delete category with ${categoryBlocks.length} scheduled time blocks`
      }
    }

    categories.value = categories.value.filter((c) => c.id !== id)
    saveToStorage()
    return { success: true }
  }

  function getCategoryById(id: string): Category | undefined {
    return categories.value.find((c) => c.id === id)
  }

  // Actions - Time Blocks
  function addTimeBlock(
    block: Omit<TimeBlock, 'id' | 'durationMinutes'>
  ): { success: boolean; error?: string } {
    const durationMinutes = calculateDurationMinutes(block.startTime, block.endTime)

    const newBlock: TimeBlock = {
      ...block,
      id: generateId(),
      durationMinutes
    }

    // Validate the time block
    const blockValidation = validationService.validateTimeBlock(newBlock, timeBlocks.value)
    if (!blockValidation.isValid) {
      return { success: false, error: blockValidation.errors.join(', ') }
    }

    // Check category limit
    const categoryValidation = validationService.canAddTimeToCategory(
      block.categoryId,
      durationMinutes,
      categories.value,
      timeBlocks.value,
      undefined,
      block.repeatDays,
      block.dayOfWeek
    )
    if (!categoryValidation.isValid) {
      return { success: false, error: categoryValidation.errors.join(', ') }
    }

    timeBlocks.value.push(newBlock)
    saveToStorage()
    return { success: true }
  }

  function updateTimeBlock(
    id: string,
    updates: Partial<Omit<TimeBlock, 'id' | 'durationMinutes'>>
  ): { success: boolean; error?: string } {
    const index = timeBlocks.value.findIndex((b) => b.id === id)
    const existingBlock = timeBlocks.value[index]
    if (index === -1 || !existingBlock) {
      return { success: false, error: 'Time block not found' }
    }

    const updatedBlock = { ...existingBlock, ...updates }

    // Recalculate duration if times changed
    if (updates.startTime !== undefined || updates.endTime !== undefined) {
      updatedBlock.durationMinutes = calculateDurationMinutes(
        updatedBlock.startTime,
        updatedBlock.endTime
      )
    }

    // Validate the updated time block
    const blockValidation = validationService.validateTimeBlock(updatedBlock, timeBlocks.value)
    if (!blockValidation.isValid) {
      return { success: false, error: blockValidation.errors.join(', ') }
    }

    // Check category limit if category, duration, or repeatDays changed
    if (updates.categoryId !== undefined || updates.startTime !== undefined || updates.endTime !== undefined || updates.repeatDays !== undefined) {
      const categoryValidation = validationService.canAddTimeToCategory(
        updatedBlock.categoryId,
        updatedBlock.durationMinutes,
        categories.value,
        timeBlocks.value,
        id,
        updatedBlock.repeatDays,
        updatedBlock.dayOfWeek
      )
      if (!categoryValidation.isValid) {
        return { success: false, error: categoryValidation.errors.join(', ') }
      }
    }

    timeBlocks.value[index] = updatedBlock
    saveToStorage()
    return { success: true }
  }

  function deleteTimeBlock(id: string): { success: boolean; error?: string } {
    timeBlocks.value = timeBlocks.value.filter((b) => b.id !== id)
    saveToStorage()
    return { success: true }
  }

  function getTimeBlocksForDay(dayOfWeek: number): TimeBlock[] {
    return timeBlocks.value
      .filter((block) => {
        // Include block if it's on this day OR if repeatDays includes this day
        return block.dayOfWeek === dayOfWeek || (block.repeatDays && block.repeatDays.includes(dayOfWeek))
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  // Storage
  async function saveToStorage(): Promise<void> {
    const data: WeekData = {
      categories: categories.value,
      timeBlocks: timeBlocks.value
    }
    const success = await weekDataRepository.save(data)
    if (!success) {
      console.error('[WeekStore] Failed to save data')
    }
  }

  async function loadFromStorage(): Promise<void> {
    const data = await weekDataRepository.load()
    if (data) {
      categories.value = data.categories || []
      timeBlocks.value = data.timeBlocks || []
    } else {
      initializeSampleData()
    }
  }

  function initializeSampleData(): void {
    const t = i18n.global.t

    const sampleCategories: Category[] = [
      {
        id: generateId(),
        name: t('defaultCategories.sleep'),
        color: '#6366f1',
        weeklyHourLimit: 56,
        icon: '😴'
      },
      {
        id: generateId(),
        name: t('defaultCategories.work'),
        color: '#3b82f6',
        weeklyHourLimit: 40,
        icon: '💼'
      },
      {
        id: generateId(),
        name: t('defaultCategories.exercise'),
        color: '#10b981',
        weeklyHourLimit: 7,
        icon: '🏃'
      },
      {
        id: generateId(),
        name: t('defaultCategories.learning'),
        color: '#f59e0b',
        weeklyHourLimit: 10,
        icon: '📚'
      },
      {
        id: generateId(),
        name: t('defaultCategories.personalProjects'),
        color: '#8b5cf6',
        weeklyHourLimit: 15,
        icon: '🚀'
      }
    ]

    categories.value = sampleCategories
    timeBlocks.value = []
    saveToStorage()
  }

  // Utility
  function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // Initialize on store creation
  loadFromStorage()

  return {
    // State
    categories,
    timeBlocks,
    // Computed
    categoryStats,
    totalScheduledHours,
    unscheduledHours,
    // Actions
    addCategory,
    updateCategory,
    deleteCategory,
    getCategoryById,
    addTimeBlock,
    updateTimeBlock,
    deleteTimeBlock,
    getTimeBlocksForDay,
    loadFromStorage,
    saveToStorage
  }
})
