import { describe, expect, it } from 'vitest'
import { icsImport } from './icsImport'
const fixtures = import.meta.glob<string>('./__fixtures__/ics/*.ics', { query: '?raw', import: 'default', eager: true })
const fixture = (name: string) => fixtures[`./__fixtures__/ics/${name}.ics`]!
const range = { start: '2026-10-19', end: '2026-10-26' }
const parse = (name: string, timeZone = 'America/Bogota') => icsImport(fixture(name), 'source', range, timeZone)
const calendar = (lines: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${lines}\r\nEND:VCALENDAR\r\n`
const event = (lines: string) => `BEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\n${lines}\r\nEND:VEVENT`
describe('ICS range expansion', () => {
  it('expands a Google recurrence, EXDATE, free time and a moved exception', () => {
    const events = parse('google')
    expect(events.map(e => e.start)).toEqual(['2026-10-19T14:00:00.000Z', '2026-10-23T16:00:00.000Z'])
    expect(events.map(e => e.busy)).toEqual([true, false])
    expect(events[1]?.recurrenceId).toBe('2026-10-23T09:00:00')
    expect(icsImport(fixture('google'), 'source', { start: '2026-11-02', end: '2026-11-09' }, 'America/Bogota')).toHaveLength(3)
  })
  it('maps Outlook Windows zones to IANA', () => {
    expect(parse('outlook')[0]?.start).toBe('2026-10-20T13:00:00.000Z')
  })
  it('retains iCloud all-day local dates and exclusive ends regardless of viewer zone', () => {
    expect(parse('icloud', 'Pacific/Auckland')).toEqual([expect.objectContaining({ start: '2026-10-21', end: '2026-10-23', allDay: true, busy: true })])
  })
  it('keeps Madrid wall time over the October DST transition', () => {
    const events = parse('dst', 'Europe/Madrid')
    expect(events).toHaveLength(7)
    expect(events[0]?.start).toBe('2026-10-19T07:00:00.000Z')
    expect(events[6]?.start).toBe('2026-10-25T08:00:00.000Z')
  })
  it('honours embedded VTIMEZONE before IANA', () => {
    expect(parse('embedded')[0]?.start).toBe('2026-10-20T06:00:00.000Z')
  })
  it('omits cancelled instances including exceptions without DTSTART', () => {
    expect(parse('cancelled').map(e => e.start)).toEqual(['2026-10-19T09:00:00.000Z', '2026-10-21T09:00:00.000Z'])
  })
  it('interprets floating times in the requested user zone and includes spanning events', () => {
    const text = calendar('BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261018T230000\r\nDTEND:20261019T010000\r\nEND:VEVENT')
    expect(icsImport(text, 'source', range, 'America/Bogota')[0]?.start).toBe('2026-10-19T04:00:00.000Z')
  })
  it('rejects unsupported frequencies and unknown zones with explicit error codes', () => {
    for (const freq of ['MINUTELY', 'SECONDLY']) expect(() => icsImport(calendar(event(`RRULE:FREQ=${freq}`)), 's', range, 'UTC')).toThrow('frequency')
    expect(() => icsImport(fixture('outlook').replace(/Eastern Standard Time/g, 'Unknown Zone'), 's', range, 'UTC')).toThrow('timezone')
  })
  it('caps UTF-8 bytes, total emitted occurrences and total candidate iterations per source', () => {
    expect(() => icsImport('é'.repeat(3 * 1024 * 1024), 's', range, 'UTC')).toThrow('size')
    const manyEvents = Array.from({ length: 5001 }, (_, index) => event('').replace('UID:test', `UID:event-${index}`)).join('\r\n')
    expect(() => icsImport(calendar(manyEvents), 's', range, 'UTC')).toThrow('occurrences')
    expect(() => icsImport(calendar(event('RRULE:FREQ=HOURLY')).replace(/20261019/g, '20000101'), 's', range, 'UTC')).toThrow('iterations')
  })
  it('rejects malformed calendars, reversed ranges and nonpositive event intervals', () => {
    expect(() => icsImport('not a calendar', 's', range, 'UTC')).toThrow()
    expect(() => icsImport(fixture('google'), 's', { start: range.end, end: range.start }, 'UTC')).toThrow('range')
    expect(() => icsImport(calendar(event('').replace('T100000', 'T080000')), 's', range, 'UTC')).toThrow('interval')
  })
})

describe('recurrence edge cases', () => {
  it('deduplicates DTSTART/RRULE/RDATE and excludes EXDATE for non-RRULE sets', () => {
    const text = calendar(event('RRULE:FREQ=DAILY;COUNT=2\r\nRDATE:20261020T090000Z,20261022T090000Z\r\nEXDATE:20261020T090000Z'))
    expect(icsImport(text, 's', range, 'UTC').map(e => e.start)).toEqual(['2026-10-19T09:00:00.000Z', '2026-10-22T09:00:00.000Z'])
  })
  it('retains detached exceptions moved into the range from outside it', () => {
    const text = calendar(event('RRULE:FREQ=DAILY;COUNT=2') + '\r\nBEGIN:VEVENT\r\nUID:test\r\nRECURRENCE-ID:20261020T090000Z\r\nDTSTART:20261026T090000Z\r\nDTEND:20261026T100000Z\r\nSUMMARY:Moved\r\nEND:VEVENT')
    expect(icsImport(text, 's', { start: '2026-10-26', end: '2026-11-02' }, 'UTC')).toEqual([expect.objectContaining({ title: 'Moved', recurrenceId: '2026-10-20T09:00:00Z' })])
  })
  it('does not attach exceptions to unrelated UIDs', () => {
    const text = calendar(event('RRULE:FREQ=DAILY;COUNT=2') + '\r\nBEGIN:VEVENT\r\nUID:other\r\nRECURRENCE-ID:20261020T090000Z\r\nDTSTART:20261020T120000Z\r\nDTEND:20261020T130000Z\r\nEND:VEVENT')
    expect(icsImport(text, 's', range, 'UTC')).toHaveLength(3)
  })
  it('honours UTC UNTIL with IANA zones and keeps a default all-day end', () => {
    const timed = calendar('BEGIN:VEVENT\r\nUID:until\r\nDTSTART;TZID=Europe/Madrid:20261024T090000\r\nDTEND;TZID=Europe/Madrid:20261024T100000\r\nRRULE:FREQ=DAILY;UNTIL=20261025T080000Z\r\nEND:VEVENT')
    expect(icsImport(timed, 's', range, 'UTC')).toHaveLength(2)
    const allDay = calendar('BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261020\r\nEND:VEVENT')
    expect(icsImport(allDay, 's', range, 'UTC')[0]?.end).toBe('2026-10-21')
  })
  it('honours THISANDFUTURE shifts after a recurrence override', () => {
    const text = calendar(event('RRULE:FREQ=DAILY;COUNT=3') + '\r\nBEGIN:VEVENT\r\nUID:test\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261020T090000Z\r\nDTSTART:20261020T110000Z\r\nDTEND:20261020T120000Z\r\nSUMMARY:Shifted\r\nEND:VEVENT')
    expect(icsImport(text, 's', range, 'UTC').map(e => e.start)).toEqual(['2026-10-19T09:00:00.000Z', '2026-10-20T11:00:00.000Z', '2026-10-21T11:00:00.000Z'])
  })
})

it('bounds hidden iterator work for an impossible contracting recurrence', () => {
  const text = calendar(event('RRULE:FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30'))
  expect(() => icsImport(text, 's', range, 'UTC')).toThrow('iterations')
})

it('expands RDATE periods with their own end or duration', () => {
  const text = calendar(event('RDATE;VALUE=PERIOD:20261021T090000Z/20261021T110000Z,20261022T090000Z/PT3H'))
  expect(icsImport(text, 's', range, 'UTC').map(e => [e.start, e.end])).toEqual([
    ['2026-10-19T09:00:00.000Z', '2026-10-19T10:00:00.000Z'],
    ['2026-10-21T09:00:00.000Z', '2026-10-21T11:00:00.000Z'],
    ['2026-10-22T09:00:00.000Z', '2026-10-22T12:00:00.000Z'],
  ])
})

it('charges long calendar-step intervals against the same source work budget', () => {
  const text = calendar(event('RRULE:FREQ=DAILY;INTERVAL=50000;BYMONTH=2;BYMONTHDAY=30'))
  expect(() => icsImport(text, 's', range, 'UTC')).toThrow('iterations')
})
