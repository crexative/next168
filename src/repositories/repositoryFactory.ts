import type { IWeekDataRepository } from './IWeekDataRepository'
import { LocalStorageRepository } from './LocalStorageRepository'

/**
 * Factory function to create the appropriate repository based on configuration
 * This follows the Factory Pattern and makes it easy to switch between implementations
 *
 * To switch to a different backend (e.g., Supabase):
 * 1. Import the new repository (e.g., SupabaseRepository)
 * 2. Update the REPOSITORY_TYPE constant or use environment variables
 * 3. Add configuration for the new repository
 */

// Configuration - can be moved to env variables
const REPOSITORY_TYPE = 'localStorage' // Options: 'localStorage', 'supabase', 'firebase'
const STORAGE_KEY = 'next168-data'

/**
 * Creates and returns the configured repository instance
 * @returns IWeekDataRepository implementation
 */
export function createWeekDataRepository(): IWeekDataRepository {
  switch (REPOSITORY_TYPE) {
    case 'localStorage':
      return new LocalStorageRepository(STORAGE_KEY)

    // Future implementations:
    // case 'supabase':
    //   return new SupabaseRepository(
    //     import.meta.env.VITE_SUPABASE_URL,
    //     import.meta.env.VITE_SUPABASE_KEY,
    //     'user-id' // Get from auth context
    //   )
    //
    // case 'firebase':
    //   return new FirebaseRepository(
    //     import.meta.env.VITE_FIREBASE_CONFIG,
    //     'user-id'
    //   )

    default:
      console.warn(`Unknown repository type: ${REPOSITORY_TYPE}, falling back to localStorage`)
      return new LocalStorageRepository(STORAGE_KEY)
  }
}

/**
 * Singleton instance of the repository
 * Use this in your store or services
 */
export const weekDataRepository = createWeekDataRepository()
