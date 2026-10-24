import type { PlannerDocument } from '@/core/model'
import { addLocalDays, localDateOf } from '@/core/time'
import { localMinuteOf } from '@/features/week/localTime'

// The nightly check-in is offered from 20:00 local time; once it is done the card stays as a "done" line all day.
export const CHECKIN_FROM_MINUTE = 20 * 60

// Until 04:00 the night still belongs to the day before: a check-in at 00:30 closes yesterday, not the day that
// has barely started. The check-in has no date field, so this is the one rule for which day it closes.
export const DAY_CLOSES_AT_MINUTE = 4 * 60

export function checkInDateFor(now: Date, timeZone: string): string {
  const today = localDateOf(now, timeZone)
  return localMinuteOf(now, timeZone) < DAY_CLOSES_AT_MINUTE ? addLocalDays(today, -1) : today
}

export function checkInDoneToday(document: PlannerDocument, now: Date): boolean {
  const day = checkInDateFor(now, document.settings.timeZone)
  return document.checkIns.some((checkIn) => checkIn.date === day)
}

// From 20:00 until the day closes at 04:00, and all day once it is done.
export function checkInCardVisible(document: PlannerDocument, now: Date): boolean {
  const minute = localMinuteOf(now, document.settings.timeZone)
  return checkInDoneToday(document, now) || minute >= CHECKIN_FROM_MINUTE || minute < DAY_CLOSES_AT_MINUTE
}
