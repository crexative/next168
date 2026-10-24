import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import { buildEvent, draftFromEvent } from './eventDraft'
import { calendarExport, googleCalendarUrl, outlookCalendarUrl } from '@/core/calendarExport'
import { icsImport } from '@/core/icsImport'
const draft = { title: 'Design & review, café', date: '2026-10-20', time: '09:30', allDay: false, duration: 60, location: 'Room 2', notes: 'First\nSecond', attendees: 'one@example.invalid; two@example.invalid' }
describe('meeting creation and export', () => {
  it('converts local form times, validates attendees and round-trips an editable event', () => {
    const event = buildEvent(draft, 'meeting', 'America/Bogota')
    expect(event.start).toBe('2026-10-20T14:30:00.000Z')
    expect(event.attendees).toEqual(['one@example.invalid', 'two@example.invalid'])
    expect(buildEvent(draftFromEvent(event, 'America/Bogota'), event.id, 'America/Bogota')).toEqual(event)
    expect(() => buildEvent({ ...draft, attendees: 'bad email' }, 'meeting', 'UTC')).toThrow()
    expect(() => buildEvent({ ...draft, duration: 0 }, 'meeting', 'UTC')).toThrow()
  })
  it('round-trips exported title/time/attendees with ical.js separately from the importer', () => {
    const event = buildEvent(draft, 'meeting', 'America/Bogota')
    const raw = calendarExport([event], { now: () => new Date('2026-10-19T00:00:00Z') })
    const parsed = new ICAL.Event(new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent')!)
    expect(parsed.summary).toBe(event.title)
    expect(parsed.startDate.toJSDate().toISOString()).toBe(event.start)
    expect(parsed.endDate.toJSDate().toISOString()).toBe(event.end)
    expect(parsed.attendees.map(property => property.getFirstValue())).toEqual(event.attendees.map(email => `mailto:${email}`))
    expect(icsImport(raw, 'download', { start: '2026-10-19', end: '2026-10-26' }, 'UTC')[0]).toMatchObject({ title: event.title, start: event.start, end: event.end })
    const google = new URL(googleCalendarUrl(event)), outlook = new URL(outlookCalendarUrl(event))
    expect(google.searchParams.get('text')).toBe(event.title)
    expect(google.searchParams.get('dates')).toBe('20261020T143000Z/20261020T153000Z')
    expect(google.searchParams.get('add')).toBe(event.attendees.join(','))
    expect(outlook.searchParams.get('subject')).toBe(event.title)
    expect(outlook.searchParams.get('startdt')).toBe(event.start)
    expect(outlook.searchParams.get('to')).toBe(event.attendees.join(';'))
  })
  it('uses exclusive dates for all-day events without applying viewer offsets', () => {
    const event = buildEvent({ ...draft, allDay: true, duration: 2 }, 'holiday', 'Pacific/Auckland')
    expect(event.start).toBe('2026-10-20T00:00:00.000Z')
    expect(event.end).toBe('2026-10-22T00:00:00.000Z')
    expect(draftFromEvent(event, 'Pacific/Auckland').duration).toBe(2)
  })
})
