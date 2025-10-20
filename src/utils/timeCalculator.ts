import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import duration from 'dayjs/plugin/duration'

dayjs.extend(customParseFormat)
dayjs.extend(duration)

export function calculateDurationMinutes(startTime: string, endTime: string): number {
  const start = dayjs(startTime, 'HH:mm')
  const end = dayjs(endTime, 'HH:mm')

  let diff = end.diff(start, 'minute')

  if (diff < 0) {
    diff += 24 * 60
  }

  return diff
}

export function minutesToHours(minutes: number): number {
  return Number((minutes / 60).toFixed(2))
}

export function minutesToHoursAndMinutes(minutes: number): { hours: number; minutes: number } {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return { hours, minutes: remainingMinutes }
}

export function formatDuration(minutes: number): string {
  const { hours, minutes: mins } = minutesToHoursAndMinutes(minutes)

  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function isValidTimeFormat(time: string): boolean {
  return dayjs(time, 'HH:mm', true).isValid()
}

export function timeRangesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = dayjs(start1, 'HH:mm')
  const e1 = dayjs(end1, 'HH:mm')
  const s2 = dayjs(start2, 'HH:mm')
  const e2 = dayjs(end2, 'HH:mm')

  return s1.isBefore(e2) && e1.isAfter(s2)
}
