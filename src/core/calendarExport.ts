import { plannerEventSchema, type Clock, type PlannerEvent } from './model'

const utcStamp = (value: string | Date) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const dateStamp = (value: string) => value.slice(0, 10).replace(/-/g, '')
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')

function validateEvent(raw: PlannerEvent): PlannerEvent {
  const event = plannerEventSchema.parse(raw)
  if (event.allDay && dateStamp(event.end) <= dateStamp(event.start)) throw new Error('event.invalidAllDayRange')
  return event
}

function foldLine(line: string): string {
  const encoder = new TextEncoder()
  let output = '', octets = 0
  for (const character of line) {
    const width = encoder.encode(character).length
    if (octets + width > 75) { output += '\r\n '; octets = 1 }
    output += character; octets += width
  }
  return output
}

export function calendarExport(events: PlannerEvent[], clock: Clock): string {
  const stamp = utcStamp(clock.now())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Next168//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const raw of events) {
    const event = validateEvent(raw)
    lines.push('BEGIN:VEVENT', `UID:${encodeURIComponent(event.id)}@next168.app`, `DTSTAMP:${stamp}`)
    if (event.allDay) lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.start)}`, `DTEND;VALUE=DATE:${dateStamp(event.end)}`)
    else lines.push(`DTSTART:${utcStamp(event.start)}`, `DTEND:${utcStamp(event.end)}`)
    lines.push(`SUMMARY:${escapeText(event.title)}`)
    if (event.location !== undefined) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.notes !== undefined) lines.push(`DESCRIPTION:${escapeText(event.notes)}`)
    for (const attendee of event.attendees) lines.push(`ATTENDEE:mailto:${attendee}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function googleCalendarUrl(raw: PlannerEvent): string {
  const event = validateEvent(raw)
  // Template parameters: https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events
  const url = new URL('https://calendar.google.com/calendar/r/eventedit')
  const date = event.allDay ? dateStamp : utcStamp
  url.search = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates: `${date(event.start)}/${date(event.end)}`,
    details: event.notes ?? '', location: event.location ?? '', add: event.attendees.join(',') }).toString()
  return url.toString()
}

export function outlookCalendarUrl(raw: PlannerEvent): string {
  const event = validateEvent(raw)
  // Compose parameters: https://learn.microsoft.com/en-us/answers/questions/5492579/outlook-deeplink-url-not-working
  // These are web compose links, not a supported API; actual account import is an owner acceptance check (§7).
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose')
  url.search = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: event.title,
    startdt: event.allDay ? event.start.slice(0, 10) : new Date(event.start).toISOString(),
    enddt: event.allDay ? event.end.slice(0, 10) : new Date(event.end).toISOString(),
    allday: String(event.allDay), body: event.notes ?? '', location: event.location ?? '', to: event.attendees.join(';') }).toString()
  return url.toString()
}
