import { decodeWeekData } from '@/services/WeekDataCodec'
import type { WeekData } from '@/types'
import type { IWeekDataRepository } from './IWeekDataRepository'

/**
 * LocalStorage implementation of IWeekDataRepository
 * Follows Single Responsibility Principle - only handles localStorage operations
 */
export class LocalStorageRepository implements IWeekDataRepository {
  private readonly storageKey: string
  private observed: string | null | undefined

  constructor(storageKey: string) {
    this.storageKey = storageKey
  }

  async save(data: WeekData): Promise<boolean> {
    try {
      const json = JSON.stringify(decodeWeekData(data))
      const previous = localStorage.getItem(this.storageKey)
      if (this.observed === undefined || previous !== this.observed) throw new Error('Routine changed in another tab; reload before saving')
      if (previous !== null) {
        decodeWeekData(JSON.parse(previous))
        localStorage.setItem(`${this.storageKey}-backup`, previous)
      }
      localStorage.setItem(this.storageKey, json)
      this.observed = json
      return true
    } catch (error) {
      console.error('[LocalStorageRepository] Error saving data:', error)
      return false
    }
  }

  async load(): Promise<WeekData | null> {
    try {
      const json = localStorage.getItem(this.storageKey)
      this.observed = json
      if (json === null) {
        return null
      }
      return decodeWeekData(JSON.parse(json))
    } catch {
      throw new Error('Routine data could not be read. Existing storage is preserved.')
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
