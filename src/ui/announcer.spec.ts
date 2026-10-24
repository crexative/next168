import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { announce, announcement, cancelAnnouncements } from './announcer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cancelAnnouncements()
  vi.useRealTimers()
})

describe('announcer', () => {
  it('reads only the latest of a burst, once it settles', () => {
    announce('Today')
    vi.advanceTimersByTime(100)
    announce('Week')
    vi.advanceTimersByTime(100)
    announce('Tasks')
    vi.advanceTimersByTime(299)
    expect(announcement.value).toBe('')
    vi.advanceTimersByTime(1 + 50)
    expect(announcement.value).toBe('Tasks')
  })

  it('re-announces an identical message by clearing the region first', () => {
    announce('Saved', 0)
    vi.advanceTimersByTime(50)
    expect(announcement.value).toBe('Saved')
    announce('Saved', 0)
    vi.advanceTimersByTime(0)
    expect(announcement.value).toBe('')
    vi.advanceTimersByTime(50)
    expect(announcement.value).toBe('Saved')
  })
})
