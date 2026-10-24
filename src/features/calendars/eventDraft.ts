import { plannerEventSchema, type PlannerEvent } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'

export interface EventDraft {
  title: string; date: string; time: string; allDay: boolean; duration: number
  location: string; notes: string; attendees: string
}
// "09:30" <-> minutes since midnight, for the form's time-of-day fields.
export function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour! * 60 + minute! : 0
}
export function timeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
export function buildEvent(draft: EventDraft, id: string, timeZone: string): PlannerEvent {
  if (!Number.isInteger(draft.duration) || draft.duration < 1 || draft.duration > (draft.allDay ? 366 : 10080)) throw new Error('calendars.formInvalid')
  const [hour, minute] = draft.time.split(':').map(Number)
  if (!draft.allDay && (!/^\d{2}:\d{2}$/.test(draft.time) || hour! < 0 || hour! > 23 || minute! < 0 || minute! > 59)) throw new Error('calendars.formInvalid')
  const start = draft.allDay ? new Date(`${draft.date}T00:00:00Z`) : zonedInstant(draft.date, hour! * 60 + minute!, timeZone)
  const end = draft.allDay ? new Date(`${addLocalDays(draft.date, draft.duration)}T00:00:00Z`) : new Date(start.getTime() + draft.duration * 60000)
  return plannerEventSchema.parse({ id, title: draft.title, start: start.toISOString(), end: end.toISOString(), allDay: draft.allDay,
    location: draft.location || undefined, notes: draft.notes || undefined, attendees: [...new Set(draft.attendees.split(/[\s,;]+/).filter(Boolean))] })
}
export function draftFromEvent(event: PlannerEvent, timeZone: string): EventDraft {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(event.start))
  return { title: event.title, date: event.allDay ? event.start.slice(0, 10) : localDateOf(event.start, timeZone), time: parts,
    allDay: event.allDay, duration: (Date.parse(event.end) - Date.parse(event.start)) / (event.allDay ? 86400000 : 60000),
    location: event.location ?? '', notes: event.notes ?? '', attendees: event.attendees.join(', ') }
}
