import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeGoogleEvents, MAX_TITLE_LENGTH } from './googleNormalize'

// Google Calendar event resources → ExternalOccurrence (Slice 1 spec §4 "Normalisation", acceptance A6).
const WINDOW = { start: '2026-10-12', end: '2026-12-07' }
const ALLOWED_KEYS = ['sourceId', 'uid', 'recurrenceId', 'title', 'start', 'end', 'allDay', 'busy']

// What Google could send beyond the requested fields; none of it may come out.
const extra = {
  attendees: [{ email: 'ana@example.com', self: false, responseStatus: 'accepted' }, { email: 'me@example.com', self: true, responseStatus: 'accepted' }],
  description: 'Agenda: secret roadmap',
  location: 'Room 4, 12 Private Street',
  hangoutLink: 'https://meet.google.com/abc-defg-hij',
  conferenceData: { entryPoints: [{ uri: 'tel:+1-555-0100' }] },
  creator: { email: 'boss@example.com' },
  organizer: { email: 'boss@example.com' },
  htmlLink: 'https://www.google.com/calendar/event?eid=xyz',
}

const longTitle = 'Planning '.repeat(30)

const items = [
  { ...extra, id: 'offset', summary: 'Standup', start: { dateTime: '2026-10-20T09:30:00-05:00' }, end: { dateTime: '2026-10-20T10:00:00-05:00' } },
  { ...extra, id: 'zulu', summary: 'Zulu sync', start: { dateTime: '2026-10-21T14:00:00Z' }, end: { dateTime: '2026-10-21T15:00:00.000Z' } },
  { id: 'fold-early', summary: 'Night shift A', start: { dateTime: '2026-11-01T01:30:00-04:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-01T01:45:00-04:00' } },
  { id: 'fold-late', summary: 'Night shift B', start: { dateTime: '2026-11-01T01:30:00-05:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-01T01:45:00-05:00' } },
  { ...extra, id: 'holiday', summary: 'Holiday', start: { date: '2026-10-26' }, end: { date: '2026-10-28' } },
  { id: 'edge', summary: 'Edge day', start: { date: '2026-10-12' }, end: { date: '2026-10-13' } },
  { id: 'before-window', summary: 'Ends at the window start', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } },
  { id: 'padding', summary: 'In the padding only', start: { dateTime: '2026-10-11T10:00:00+09:00' }, end: { dateTime: '2026-10-11T11:00:00+09:00' } },
  { ...extra, id: 'cancelled', status: 'cancelled', summary: 'Cancelled', start: { dateTime: '2026-10-22T09:00:00Z' }, end: { dateTime: '2026-10-22T10:00:00Z' } },
  { id: 'declined', summary: 'Declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-22T11:00:00Z' }, end: { dateTime: '2026-10-22T12:00:00Z' } },
  { id: 'free', summary: 'Free time', transparency: 'transparent', start: { dateTime: '2026-10-22T13:00:00Z' }, end: { dateTime: '2026-10-22T14:00:00Z' } },
  { id: 'where', summary: 'Office', eventType: 'workingLocation', start: { date: '2026-10-23' }, end: { date: '2026-10-24' } },
  { id: 'series_20261023T150000Z', recurringEventId: 'series', summary: 'Moved 1:1', originalStartTime: { dateTime: '2026-10-23T10:00:00-05:00' }, start: { dateTime: '2026-10-23T16:00:00Z' }, end: { dateTime: '2026-10-23T16:30:00Z' } },
  { id: 'daily_20261024', recurringEventId: 'daily', summary: 'Gym day', originalStartTime: { date: '2026-10-24' }, start: { date: '2026-10-24' }, end: { date: '2026-10-25' } },
  { id: 'long', summary: longTitle, start: { dateTime: '2026-10-25T08:00:00Z' }, end: { dateTime: '2026-10-25T09:00:00Z' } },
  { id: 'untitled', start: { dateTime: '2026-10-25T10:00:00Z' }, end: { dateTime: '2026-10-25T10:30:00Z' } },
]

const expected = [
  { sourceId: 'google:primary', uid: 'offset', title: 'Standup', start: '2026-10-20T14:30:00.000Z', end: '2026-10-20T15:00:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'zulu', title: 'Zulu sync', start: '2026-10-21T14:00:00.000Z', end: '2026-10-21T15:00:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'fold-early', title: 'Night shift A', start: '2026-11-01T05:30:00.000Z', end: '2026-11-01T05:45:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'fold-late', title: 'Night shift B', start: '2026-11-01T06:30:00.000Z', end: '2026-11-01T06:45:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'holiday', title: 'Holiday', start: '2026-10-26', end: '2026-10-28', allDay: true, busy: true },
  { sourceId: 'google:primary', uid: 'edge', title: 'Edge day', start: '2026-10-12', end: '2026-10-13', allDay: true, busy: true },
  { sourceId: 'google:primary', uid: 'free', title: 'Free time', start: '2026-10-22T13:00:00.000Z', end: '2026-10-22T14:00:00.000Z', allDay: false, busy: false },
  { sourceId: 'google:primary', uid: 'series_20261023T150000Z', recurrenceId: '2026-10-23T15:00:00.000Z', title: 'Moved 1:1', start: '2026-10-23T16:00:00.000Z', end: '2026-10-23T16:30:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'daily_20261024', recurrenceId: '2026-10-24', title: 'Gym day', start: '2026-10-24', end: '2026-10-25', allDay: true, busy: true },
  { sourceId: 'google:primary', uid: 'long', title: longTitle.slice(0, MAX_TITLE_LENGTH), start: '2026-10-25T08:00:00.000Z', end: '2026-10-25T09:00:00.000Z', allDay: false, busy: true },
  { sourceId: 'google:primary', uid: 'untitled', title: '', start: '2026-10-25T10:00:00.000Z', end: '2026-10-25T10:30:00.000Z', allDay: false, busy: true },
]

describe('normalizeGoogleEvents', () => {
  const zone = process.env.TZ
  // The browser's zone differs from the planner's: nothing may depend on it.
  beforeAll(() => { process.env.TZ = 'America/Bogota' })
  afterAll(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

  it('builds exactly the whitelisted occurrence for every kept event, in the planner zone Asia/Tokyo', () => {
    const result = normalizeGoogleEvents(items, WINDOW, 'Asia/Tokyo')
    expect(result).toEqual({ ok: true, occurrences: expected })
    if (!result.ok) return
    for (const occurrence of result.occurrences) {
      for (const key of Object.keys(occurrence)) expect(ALLOWED_KEYS).toContain(key)
      expect(occurrence.sourceId).not.toContain('@')
    }
    const text = JSON.stringify(result)
    for (const secret of ['ana@example.com', 'me@example.com', 'boss@example.com', 'secret roadmap', 'Private Street', 'meet.google.com', '555-0100', 'htmlLink']) expect(text).not.toContain(secret)
  })

  it('keeps a DST fold as two distinct instants', () => {
    const result = normalizeGoogleEvents(items.filter((item) => item.id.startsWith('fold')), WINDOW, 'America/New_York')
    expect(result.ok && result.occurrences.map((item) => item.start)).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'])
  })

  it.each([
    ['an offset-free dateTime', { id: 'floating', start: { dateTime: '2026-10-20T09:00:00', timeZone: 'America/Bogota' }, end: { dateTime: '2026-10-20T10:00:00', timeZone: 'America/Bogota' } }],
    ['an impossible date', { id: 'bad-date', start: { date: '2026-02-30x' }, end: { date: '2026-03-01' } }],
    ['a timed start with an all-day end', { id: 'mixed', start: { dateTime: '2026-10-20T09:00:00Z' }, end: { date: '2026-10-21' } }],
    ['an end before the start', { id: 'backwards', start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T09:00:00Z' } }],
    ['no id', { start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } }],
    ['an unreadable original start', { id: 'moved', originalStartTime: { dateTime: '2026-10-20T10:00:00' }, start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } }],
  ])('fails the whole refresh as `format` on %s', (_, item) => {
    expect(normalizeGoogleEvents([...items, item], WINDOW, 'UTC')).toEqual({ ok: false, code: 'format' })
  })

  it('drops cancelled, self-declined and working-location events but keeps an attendee list without the person', () => {
    const kept = normalizeGoogleEvents([
      { id: 'other-declined', attendees: [{ self: false, responseStatus: 'declined' }], start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } },
      { id: 'cancelled', status: 'cancelled', start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } },
      { id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } },
      { id: 'where', eventType: 'workingLocation', start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } },
    ], WINDOW, 'UTC')
    expect(kept.ok && kept.occurrences.map((item) => item.uid)).toEqual(['other-declined'])
  })
})
