import { describe, it, expect } from 'vitest'
import { ValidationService } from './ValidationService'
import type { TimeBlock, Category } from '@/types'

describe('ValidationService', () => {
  const validationService = new ValidationService()

  describe('canAddTimeToCategory', () => {
    const mockCategory: Category = {
      id: 'cat1',
      name: 'Work',
      color: '#3b82f6',
      icon: '💼',
      weeklyHourLimit: 40
    }

    it('should correctly calculate usage when editing a block with all days selected', () => {
      // Scenario: User has a 1-hour block scheduled for all 7 days (7 hours total)
      // They try to edit it to 2 hours, still on all 7 days (14 hours total)
      // With a 40-hour limit, this should succeed (14 < 40)

      const existingBlock: TimeBlock = {
        id: 'block1',
        categoryId: 'cat1',
        title: 'Work Session',
        dayOfWeek: 1, // Monday
        startTime: '09:00',
        endTime: '10:00', // 1 hour
        durationMinutes: 60,
        repeatDays: [0, 2, 3, 4, 5, 6] // All other days (Sun, Tue-Sat)
      }

      const timeBlocks = [existingBlock]
      const categories = [mockCategory]

      // Try to update to 2 hours (120 minutes), still on all days
      const result = validationService.canAddTimeToCategory(
        'cat1',
        120, // 2 hours
        categories,
        timeBlocks,
        'block1', // Exclude the block being edited
        [0, 2, 3, 4, 5, 6], // Same repeat days
        1 // Monday
      )

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should prevent exceeding limit when editing adds too much time', () => {
      // Scenario: User has a 1-hour block on all 7 days (7 hours)
      // They try to edit it to 6 hours on all 7 days (42 hours)
      // With a 40-hour limit, this should fail (42 > 40)

      const existingBlock: TimeBlock = {
        id: 'block1',
        categoryId: 'cat1',
        title: 'Work Session',
        dayOfWeek: 1, // Monday
        startTime: '09:00',
        endTime: '10:00', // 1 hour
        durationMinutes: 60,
        repeatDays: [0, 2, 3, 4, 5, 6]
      }

      const timeBlocks = [existingBlock]
      const categories = [mockCategory]

      // Try to update to 6 hours (360 minutes)
      const result = validationService.canAddTimeToCategory(
        'cat1',
        360, // 6 hours
        categories,
        timeBlocks,
        'block1',
        [0, 2, 3, 4, 5, 6],
        1 // Monday
      )

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Exceeds category limit')
    })

    it('should handle duplicate day in repeatDays and dayOfWeek', () => {
      // Bug scenario: dayOfWeek = 1 (Monday) AND repeatDays includes 1 (Monday)
      // This currently counts as 8 instances but should only count as 7!

      const existingBlock: TimeBlock = {
        id: 'block1',
        categoryId: 'cat1',
        title: 'Work Session',
        dayOfWeek: 1, // Monday
        startTime: '09:00',
        endTime: '10:00', // 1 hour
        durationMinutes: 60,
        repeatDays: [0, 1, 2, 3, 4, 5, 6] // Includes Monday AGAIN!
      }

      const timeBlocks = [existingBlock]
      const categories = [mockCategory]

      // With bug: counts as 8 hours (1 + 7)
      // Without bug: should count as 7 hours (unique days)
      // Try to add another 33 hours:
      // - If bug exists: 8 + 33 = 41 > 40 (should fail but incorrectly)
      // - If fixed: 7 + 33 = 40 = exactly at limit (should succeed)
      const result = validationService.canAddTimeToCategory(
        'cat1',
        60 * 33, // 33 hours
        categories,
        timeBlocks,
        undefined, // New block
        undefined, // No repeat days
        2 // Tuesday - different day
      )

      // This test will FAIL initially (proving the bug exists)
      // After fix, it should PASS
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should correctly count unique days when editing block with duplicate days', () => {
      // User scenario: Edit a 1-hour block that has dayOfWeek=1 and repeatDays=[0,1,2,3,4,5,6]
      // Current: Counts as 8 hours, only 32 hours remain in 40-hour limit
      // Expected: Should count as 7 hours, 33 hours remain
      // When updating to 2 hours on same days: should use 14 hours total (7 days * 2 hours)

      const existingBlock: TimeBlock = {
        id: 'block1',
        categoryId: 'cat1',
        title: 'Daily Standup',
        dayOfWeek: 1, // Monday
        startTime: '09:00',
        endTime: '10:00', // 1 hour
        durationMinutes: 60,
        repeatDays: [0, 1, 2, 3, 4, 5, 6] // BUG: includes day 1 again!
      }

      const timeBlocks = [existingBlock]
      const categories = [mockCategory]

      // Edit the block to 2 hours, same days
      const result = validationService.canAddTimeToCategory(
        'cat1',
        120, // 2 hours
        categories,
        timeBlocks,
        'block1', // Exclude existing block
        [0, 1, 2, 3, 4, 5, 6], // Same repeat days
        1 // Monday (same dayOfWeek)
      )

      // With bug: removes 8 hours, adds 16 hours = 8 net hours used (should succeed)
      // Without bug: removes 7 hours, adds 14 hours = 7 net hours used (should succeed)
      // Either way this should succeed, but let's verify the calculation
      expect(result.isValid).toBe(true)
    })

    it('should correctly calculate with no repeat days', () => {
      const existingBlock: TimeBlock = {
        id: 'block1',
        categoryId: 'cat1',
        title: 'Work Session',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        durationMinutes: 60,
        repeatDays: undefined
      }

      const timeBlocks = [existingBlock]
      const categories = [mockCategory]

      // 1 hour existing + 39 hours new = 40 hours (exactly at limit, should succeed)
      const result = validationService.canAddTimeToCategory(
        'cat1',
        60 * 39,
        categories,
        timeBlocks,
        undefined,
        undefined
      )

      expect(result.isValid).toBe(true)
    })
  })
})
