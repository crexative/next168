import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Category, TimeBlock, CategoryStats, WeekData } from '@/types'
import { TOTAL_WEEK_HOURS } from '@/types'
import { validationService } from '@/services/ValidationService'
import { storageService } from '@/services/StorageService'
import { calculateDurationMinutes, minutesToHours } from '@/utils/timeCalculator'

const STORAGE_KEY = 'next168-data'

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
        (sum, block) => sum + block.durationMinutes,
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
      (sum, block) => sum + block.durationMinutes,
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
    if (index === -1) {
      return { success: false, error: 'Category not found' }
    }

    const updatedCategory = { ...categories.value[index], ...updates }
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
      timeBlocks.value
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
    if (index === -1) {
      return { success: false, error: 'Time block not found' }
    }

    const existingBlock = timeBlocks.value[index]
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

    // Check category limit if category or duration changed
    if (updates.categoryId !== undefined || updates.startTime !== undefined || updates.endTime !== undefined) {
      const categoryValidation = validationService.canAddTimeToCategory(
        updatedBlock.categoryId,
        updatedBlock.durationMinutes,
        categories.value,
        timeBlocks.value,
        id
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
      .filter((block) => block.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }

  // Storage
  function saveToStorage(): void {
    const data: WeekData = {
      categories: categories.value,
      timeBlocks: timeBlocks.value
    }
    storageService.set(STORAGE_KEY, data)
  }

  function loadFromStorage(): void {
    const data = storageService.get<WeekData>(STORAGE_KEY)
    if (data) {
      categories.value = data.categories || []
      timeBlocks.value = data.timeBlocks || []
    } else {
      initializeSampleData()
    }
  }

  function initializeSampleData(): void {
    const sampleCategories: Category[] = [
      {
        id: generateId(),
        name: 'Work',
        color: '#3b82f6',
        weeklyHourLimit: 40,
        icon: '💼'
      },
      {
        id: generateId(),
        name: 'Exercise',
        color: '#10b981',
        weeklyHourLimit: 7,
        icon: '🏃'
      },
      {
        id: generateId(),
        name: 'Learning',
        color: '#f59e0b',
        weeklyHourLimit: 10,
        icon: '📚'
      },
      {
        id: generateId(),
        name: 'Personal Projects',
        color: '#8b5cf6',
        weeklyHourLimit: 15,
        icon: '🚀'
      }
    ]

    const sampleBlocks: TimeBlock[] = [
      {
        id: generateId(),
        categoryId: sampleCategories[0].id,
        title: 'Morning Stand-up',
        description: 'Daily team sync',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '09:30',
        durationMinutes: 30
      },
      {
        id: generateId(),
        categoryId: sampleCategories[0].id,
        title: 'Deep Work Session',
        description: 'Focus time for coding',
        dayOfWeek: 1,
        startTime: '10:00',
        endTime: '12:00',
        durationMinutes: 120
      },
      {
        id: generateId(),
        categoryId: sampleCategories[1].id,
        title: 'Morning Run',
        description: '5K run',
        dayOfWeek: 1,
        startTime: '06:30',
        endTime: '07:30',
        durationMinutes: 60
      },
      {
        id: generateId(),
        categoryId: sampleCategories[2].id,
        title: 'Online Course',
        description: 'Vue.js Advanced Patterns',
        dayOfWeek: 2,
        startTime: '19:00',
        endTime: '21:00',
        durationMinutes: 120
      }
    ]

    categories.value = sampleCategories
    timeBlocks.value = sampleBlocks
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
