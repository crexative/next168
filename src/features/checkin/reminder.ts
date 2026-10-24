import { localDateOf } from '@/core/time'
import { i18n } from '@/i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import { localMinuteOf } from '@/features/week/localTime'

// The nightly reminder is a local notification, opt-in and per device: nothing is requested until the user taps the
// button, and it is only available where the Notification API exists and has not been blocked.
export const REMINDER_MINUTE = 22 * 60
const KEY = 'next168-checkin-reminder'
const LAST_KEY = 'next168-checkin-reminder-last'
const TICK_MS = 30_000
// A tab that slept through 22:00 still reminds up to here, but not the next morning.
const REMINDER_WINDOW_MINUTES = 120

export type ReminderOutcome = 'enabled' | 'blocked'

function read(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Preference is optional.
  }
}

export function reminderSupported(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission !== 'denied'
}

export function reminderEnabled(): boolean {
  return read(KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export async function enableReminder(): Promise<ReminderOutcome> {
  if (typeof Notification === 'undefined') return 'blocked'
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return 'blocked'
  write(KEY, '1')
  startReminderTicker()
  return 'enabled'
}

export function disableReminder(): void {
  write(KEY, null)
}

async function show(): Promise<void> {
  const title = i18n.global.t('checkin.title')
  const options = { body: i18n.global.t('checkin.reminder.body'), tag: 'next168-checkin' }
  try {
    const notification = new Notification(title, options)
    notification.onclick = () => { window.focus(); window.location.hash = '#/checkin' }
  } catch {
    // Some mobile browsers only allow notifications through a service worker registration.
    const registration = await navigator.serviceWorker?.getRegistration()
    await registration?.showNotification(title, options)
  }
}

export function dueNow(now: Date, timeZone: string, hasCheckInToday: boolean, lastReminderDate: string | null): boolean {
  if (hasCheckInToday || lastReminderDate === localDateOf(now, timeZone)) return false
  const minute = localMinuteOf(now, timeZone)
  return minute >= REMINDER_MINUTE && minute < REMINDER_MINUTE + REMINDER_WINDOW_MINUTES
}

function tick(): void {
  if (!reminderEnabled()) return
  try {
    const document = usePlannerStore().document
    if (!document) return
    const now = new Date()
    const timeZone = document.settings.timeZone
    const today = localDateOf(now, timeZone)
    if (!dueNow(now, timeZone, document.checkIns.some((checkIn) => checkIn.date === today), read(LAST_KEY))) return
    write(LAST_KEY, today)
    void show()
  } catch {
    // The planner store is not ready yet; the next tick tries again.
  }
}

let ticker: ReturnType<typeof setInterval> | undefined

export function startReminderTicker(): void {
  if (ticker !== undefined) return
  ticker = setInterval(tick, TICK_MS)
}

export function stopReminderTicker(): void {
  clearInterval(ticker)
  ticker = undefined
}
