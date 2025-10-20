export interface IStorageService {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): void
  remove(key: string): void
  clear(): void
}

export class LocalStorageService implements IStorageService {
  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : null
    } catch (error) {
      console.error(`Error reading from localStorage: ${key}`, error)
      return null
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error(`Error writing to localStorage: ${key}`, error)
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error(`Error removing from localStorage: ${key}`, error)
    }
  }

  clear(): void {
    try {
      localStorage.clear()
    } catch (error) {
      console.error('Error clearing localStorage', error)
    }
  }
}

export const storageService = new LocalStorageService()
