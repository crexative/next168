import type { WeekData } from '@/types'

/**
 * Interface for week data repository
 * Follows the Repository Pattern and Dependency Inversion Principle (SOLID)
 * This abstraction allows swapping storage implementations (localStorage, Supabase, Firebase, etc.)
 */
export interface IWeekDataRepository {
  /**
   * Saves week data to storage
   * @param data The week data to save
   * @returns Promise resolving to true if successful, false otherwise
   */
  save(data: WeekData): Promise<boolean>

  /**
   * Loads week data from storage
   * @returns Promise resolving to the week data, or null if not found
   */
  load(): Promise<WeekData | null>

  /**
   * Clears all week data from storage
   * @returns Promise resolving to true if successful, false otherwise
   */
  clear(): Promise<boolean>

  /**
   * Checks if data exists in storage
   * @returns Promise resolving to true if data exists, false otherwise
   */
  exists(): Promise<boolean>
}
