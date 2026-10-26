import { calendarExport } from '@/core/calendarExport'
import type { PlannerEvent } from '@/core/model'

export function downloadCalendar(events: PlannerEvent[]): void {
  const url = URL.createObjectURL(new Blob([calendarExport(events, { now: () => new Date() })], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'weeklid-events.ics'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
