import type { PlannerDocument } from '@/core/model'
import { localDateOf } from '@/core/time'
import { localMinuteOf } from '@/features/week/localTime'

// The nightly check-in is offered from 20:00 local time; once it is done the card stays as a "done" line all day.
export const CHECKIN_FROM_MINUTE = 20 * 60

export function checkInDoneToday(document: PlannerDocument, now: Date): boolean {
  const today = localDateOf(now, document.settings.timeZone)
  return document.checkIns.some((checkIn) => checkIn.date === today)
}

export function checkInCardVisible(document: PlannerDocument, now: Date): boolean {
  return checkInDoneToday(document, now) || localMinuteOf(now, document.settings.timeZone) >= CHECKIN_FROM_MINUTE
}
