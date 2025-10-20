import type { WeekData } from '@/types'
import type { IWeekDataRepository } from './IWeekDataRepository'

/**
 * LocalStorage implementation of IWeekDataRepository
 * Follows Single Responsibility Principle - only handles localStorage operations
 */
export class LocalStorageRepository implements IWeekDataRepository {
  private readonly storageKey: string

  constructor(storageKey: string) {
    this.storageKey = storageKey
  }

  async save(data: WeekData): Promise<boolean> {
    try {
      const json = JSON.stringify(data)
      localStorage.setItem(this.storageKey, json)
      return true
    } catch (error) {
      console.error('[LocalStorageRepository] Error saving data:', error)
      return false
    }
  }

  async load(): Promise<WeekData | null> {
    try {
      const json = localStorage.getItem(this.storageKey)
      if (!json) {
        return null
      }
      return JSON.parse(json) as WeekData
    } catch (error) {
      console.error('[LocalStorageRepository] Error loading data:', error)
      return null
    }
  }

  async clear(): Promise<boolean> {
    try {
      localStorage.removeItem(this.storageKey)
      return true
    } catch (error) {
      console.error('[LocalStorageRepository] Error clearing data:', error)
      return false
    }
  }

  async exists(): Promise<boolean> {
    try {
      const json = localStorage.getItem(this.storageKey)
      return json !== null
    } catch (error) {
      console.error('[LocalStorageRepository] Error checking existence:', error)
      return false
    }
  }
}
