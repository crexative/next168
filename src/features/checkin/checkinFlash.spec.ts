import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeSavedFlag, justSaved, markCheckInSaved } from './checkinFlash'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.runAllTimers(); vi.useRealTimers() })

describe('check-in saved flag', () => {
  it('stays up for four seconds and then falls back to the plain “done” line', () => {
    expect(justSaved.value).toBe(false)
    markCheckInSaved()
    expect([consumeSavedFlag(), justSaved.value]).toEqual([true, true])
    vi.advanceTimersByTime(3999)
    expect(justSaved.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(justSaved.value).toBe(false)
  })

  it('a second save restarts the four seconds instead of inheriting the first timer', () => {
    markCheckInSaved()
    vi.advanceTimersByTime(3000)
    markCheckInSaved()
    vi.advanceTimersByTime(2000)
    expect(justSaved.value).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(justSaved.value).toBe(false)
  })
})
