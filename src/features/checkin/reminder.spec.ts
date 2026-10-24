import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueNow, disableReminder, enableReminder, reminderEnabled, reminderSupported, stopReminderTicker } from './reminder'

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => FakeNotification.permission)
}

beforeEach(() => {
  window.localStorage.clear()
  FakeNotification.permission = 'default'
  FakeNotification.requestPermission.mockClear()
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => { stopReminderTicker(); vi.unstubAllGlobals() })

describe('reminder', () => {
  it('is due from 22:00 for two hours, once a day, and never after the check-in is done', () => {
    const at = (time: string) => new Date(`2026-10-21T${time}:00Z`)
    expect(dueNow(at('21:59'), 'UTC', false, null)).toBe(false)
    expect(dueNow(at('22:00'), 'UTC', false, null)).toBe(true)
    expect(dueNow(at('23:59'), 'UTC', false, null)).toBe(true)
    expect(dueNow(at('06:00'), 'UTC', false, null)).toBe(false)
    expect(dueNow(at('22:30'), 'UTC', true, null)).toBe(false)
    expect(dueNow(at('22:30'), 'UTC', false, '2026-10-21')).toBe(false)
    expect(dueNow(at('22:30'), 'UTC', false, '2026-10-20')).toBe(true)
  })

  it('asks for permission only when enabled, and stores the opt-in only when it is granted', async () => {
    expect(reminderSupported()).toBe(true)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    FakeNotification.permission = 'denied'
    expect(await enableReminder()).toBe('blocked')
    expect(reminderEnabled()).toBe(false)
    expect(reminderSupported()).toBe(false)

    FakeNotification.permission = 'granted'
    expect(await enableReminder()).toBe('enabled')
    expect(reminderEnabled()).toBe(true)
    disableReminder()
    expect(reminderEnabled()).toBe(false)
  })

  it('is unsupported without the Notification API', () => {
    vi.stubGlobal('Notification', undefined)
    expect(reminderSupported()).toBe(false)
    expect(reminderEnabled()).toBe(false)
  })
})
