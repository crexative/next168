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
    expect(() => parse('pathological')).toThrow('iterations')
  })
  it('rejects malformed calendars, reversed ranges and nonpositive event intervals', () => {
    expect(() => icsImport('not a calendar', 's', range, 'UTC')).toThrow()
    expect(() => icsImport(fixture('google'), 's', { start: range.end, end: range.start }, 'UTC')).toThrow('range')
    expect(() => icsImport(calendar(event('').replace('T100000', 'T080000')), 's', range, 'UTC')).toThrow('interval')
  })
})

describe('recurrence edge cases', () => {
  it.each(['America/Bogota', 'Pacific/Auckland'])('seeks all-day DAILY/WEEKLY COUNT series in %s', timeZone => {
    const events = parse('all-day-seek', timeZone)
    expect(events.filter(event => event.uid === 'daily-count@example.invalid').map(event => [event.start, event.end])).toEqual(
      Array.from({ length: 7 }, (_, day) => [`2026-10-${19 + day}`, `2026-10-${20 + day}`]),
    )
    expect(events.filter(event => event.uid === 'weekly-count@example.invalid')).toEqual([
      expect.objectContaining({ start: '2026-10-19', end: '2026-10-20', allDay: true }),
    ])
  })
  it.each(['America/Bogota', 'Pacific/Auckland'])('honours inclusive DATE UNTIL after DAILY/WEEKLY seeks in %s', timeZone => {
    const events = parse('all-day-seek', timeZone)
    expect(events.filter(event => event.uid === 'daily-until@example.invalid').map(event => event.start)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21',
    ])
    expect(events.filter(event => event.uid === 'weekly-until@example.invalid').map(event => event.start)).toEqual(['2026-10-19'])
    expect(icsImport(fixture('all-day-seek'), 's', { start: '2026-10-26', end: '2026-11-02' }, timeZone)
      .filter(event => event.uid.includes('until'))).toEqual([])
  })
  it('seeks ancient all-day DAILY/WEEKLY series without replaying their history', () => {
    const text = fixture('all-day-seek').replace(/2026010[15]/g, '19000101').replace(/;COUNT=\d+/g, '')
    const events = icsImport(text, 's', range, 'America/Bogota')
    expect(events.filter(event => event.uid === 'daily-count@example.invalid').map(event => event.start)).toEqual(
      Array.from({ length: 7 }, (_, day) => `2026-10-${19 + day}`),
    )
    expect(events.filter(event => event.uid === 'weekly-count@example.invalid').map(event => event.start)).toEqual(['2026-10-19'])
    expect(events.filter(event => event.uid === 'daily-until@example.invalid').map(event => event.start)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21',
    ])
    expect(events.filter(event => event.uid === 'weekly-until@example.invalid').map(event => event.start)).toEqual(['2026-10-19'])
  })
  it.each([
    ['DAILY', 'COUNT=294', ['2026-10-19', '2026-10-20', '2026-10-21']],
    ['WEEKLY', 'COUNT=42', ['2026-10-19']],
    ['DAILY', 'INTERVAL=2;COUNT=148', ['2026-10-20', '2026-10-22']],
    ['WEEKLY', 'INTERVAL=2;COUNT=22', ['2026-10-26']],
  ])('keeps all-day %s %s phase and COUNT exhaustion after a seek', (frequency, limit, expected) => {
    const text = fixture('all-day-seek').replace(new RegExp(`FREQ=${frequency};COUNT=\\d+`), `FREQ=${frequency};${limit}`)
    const events = icsImport(text, 's', { start: range.start, end: '2026-11-09' }, 'America/Bogota')
    expect(events.filter(event => event.uid === `${frequency.toLowerCase()}-count@example.invalid`).map(event => event.start)).toEqual(expected)
  })
  it('bounds total historical replay across non-seekable series in one source', () => {
    expect(parse('historical-monthly')).toEqual([])
    const master = fixture('historical-monthly').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)![0]
    const text = calendar(Array.from({ length: 16 }, (_, index) => master.replace('UID:historical', `UID:historical-${index}`)).join('\n'))
    expect(() => icsImport(text, 's', range, 'UTC')).toThrow('iterations')
  })
  it.each([
    ['HOURLY;INTERVAL=6;COUNT=1167', [3, 9, 15, 21].map(hour => `2026-10-19T${String(hour).padStart(2, '0')}:00:00.000Z`)],
    ['DAILY;COUNT=294', [19, 20, 21].map(day => `2026-10-${day}T09:00:00.000Z`)],
    ['DAILY;INTERVAL=2;COUNT=148', [20, 22].map(day => `2026-10-${day}T09:00:00.000Z`)],
    ['WEEKLY;COUNT=43', ['2026-10-22T09:00:00.000Z']],
    ['WEEKLY;INTERVAL=2;COUNT=22', ['2026-10-22T09:00:00.000Z']],
    ['HOURLY;INTERVAL=6;UNTIL=20261019T210000Z', [3, 9, 15, 21].map(hour => `2026-10-19T${String(hour).padStart(2, '0')}:00:00.000Z`)],
    ['DAILY;UNTIL=20261021T090000Z', [19, 20, 21].map(day => `2026-10-${day}T09:00:00.000Z`)],
    ['WEEKLY;UNTIL=20261022T090000Z', ['2026-10-22T09:00:00.000Z']],
    ['HOURLY;COUNT=2', []],
    ['DAILY;COUNT=2', []],
    ['WEEKLY;COUNT=2', []],
  ])('preserves timed seek phase and termination for %s', (rule, expected) => {
    const text = fixture('timed-seek').replace('FREQ=DAILY;COUNT=294', `FREQ=${rule}`)
    expect(icsImport(text, 's', { start: range.start, end: '2026-11-09' }, 'UTC').map(event => event.start)).toEqual(expected)
  })
  it('expands several long-running series within the requested week without replaying seekable history', () => {
    const events = parse('long-running')
    const starts = (uid: string) => events.filter(event => event.uid === `${uid}@example.invalid`).map(event => event.start)
    expect(starts('weekly')).toEqual(['2026-10-19T14:00:00.000Z'])
    expect(starts('weekly-friday')).toEqual(['2026-10-23T16:00:00.000Z'])
    expect(starts('fortnightly')).toEqual([])
    expect(starts('daily')).toEqual(Array.from({ length: 7 }, (_, day) => `2026-10-${19 + day}T17:00:00.000Z`))
    expect(starts('daily-count')).toEqual(Array.from({ length: 7 }, (_, day) => `2026-10-${19 + day}T18:00:00.000Z`))
    expect(starts('daily-interval')).toEqual([19, 21, 23, 25].map(day => `2026-10-${day}T19:00:00.000Z`))
    expect(starts('weekly-count')).toEqual([19, 21, 23].map(day => `2026-10-${day}T08:00:00.000Z`))
    expect(starts('expired-count')).toEqual([])
    expect(starts('expired-until')).toEqual([])
  })
  it('preserves weekly BYDAY and INTERVAL phase after seeking to another week', () => {
    const events = icsImport(fixture('long-running'), 's', { start: '2026-10-26', end: '2026-11-02' }, 'America/Bogota')
    expect(events.filter(event => event.uid === 'fortnightly@example.invalid').map(event => event.start)).toEqual([
      '2026-10-26T15:00:00.000Z', '2026-10-28T15:00:00.000Z', '2026-10-30T15:00:00.000Z',
    ])
  })
  it('does not restart COUNT after skipping historical occurrences', () => {
    const events = icsImport(fixture('long-running').replace('COUNT=3000', 'COUNT=2851'), 's', range, 'America/Bogota')
    expect(events.filter(event => event.uid === 'daily-count@example.invalid').map(event => event.start)).toEqual([
      '2026-10-19T18:00:00.000Z', '2026-10-20T18:00:00.000Z', '2026-10-21T18:00:00.000Z',
    ])
  })
  it('seeks ancient hourly series even with a large COUNT, but rejects unsafe COUNT values', () => {
    const text = fixture('pathological').replace(';INTERVAL=50000;BYMONTH=2;BYMONTHDAY=30', '')
    const events = icsImport(text, 's', range, 'UTC')
    expect(events).toHaveLength(168)
    expect(events[0]?.start).toBe('2026-10-19T00:00:00.000Z')
    expect(events[167]?.start).toBe('2026-10-25T23:00:00.000Z')
    expect(() => icsImport(text.replace('COUNT=2147483647', 'COUNT=9007199254740992'), 's', range, 'UTC')).toThrow('iterations')
  })
  it('still shares the work limit across series inside the requested range', () => {
    const master = fixture('pathological').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)![0]
      .replace(';INTERVAL=50000;BYMONTH=2;BYMONTHDAY=30', '')
    const text = calendar(Array.from({ length: 24 }, (_, index) => master.replace('UID:pathological', `UID:hourly-${index}`)).join('\n'))
    expect(() => icsImport(text, 's', range, 'UTC')).toThrow('iterations')
  })
  it('keeps recurring instances spanning the range start when seeking', () => {
    const text = fixture('long-running').replace('20150102T113000', '20150105T113000')
    const events = icsImport(text, 's', { start: '2026-10-18', end: '2026-10-19' }, 'America/Bogota')
    expect(events.filter(event => event.uid === 'weekly-friday@example.invalid')).toEqual([
      expect.objectContaining({ start: '2026-10-16T16:00:00.000Z', end: '2026-10-19T16:30:00.000Z' }),
    ])
  })
  it('preserves daily wall times across DST after skipping years of history', () => {
    const text = fixture('dst').replace(/20261019/g, '20150101').replace(';COUNT=7', '')
    const events = icsImport(text, 's', range, 'Europe/Madrid')
    expect(events.map(event => event.start)).toEqual([
      ...[19, 20, 21, 22, 23, 24].map(day => `2026-10-${day}T07:00:00.000Z`),
      '2026-10-25T08:00:00.000Z',
    ])
  })
  it('matches UTC Google EXDATE values to TZID occurrences and RDATE periods by instant', () => {
    expect(parse('google-utc-exdate').map(event => event.start)).toEqual([
      '2026-10-19T14:00:00.000Z', '2026-10-21T14:00:00.000Z',
    ])
  })
  it('emits UTC Outlook overrides once and suppresses UTC cancellations of TZID instances', () => {
    expect(parse('outlook-utc-override').map(event => [event.start, event.end])).toEqual([
      ['2026-10-19T14:00:00.000Z', '2026-10-19T15:00:00.000Z'],
      ['2026-10-20T16:00:00.000Z', '2026-10-20T17:00:00.000Z'],
    ])
  })
  it('uses embedded VTIMEZONE offsets when matching UTC exclusions', () => {
    const timezone = fixture('embedded').match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/)![0]
    const text = fixture('google-utc-exdate').replace('BEGIN:VEVENT', `${timezone}\nBEGIN:VEVENT`).replace(/T140000Z/g, 'T060000Z')
    expect(icsImport(text, 'source', range, 'UTC').map(event => event.start)).toEqual([
      '2026-10-19T06:00:00.000Z', '2026-10-21T06:00:00.000Z',
    ])
  })
  it('matches all-day DATE exclusions by local date regardless of viewer zone', () => {
    for (const zone of ['America/Bogota', 'Pacific/Auckland']) {
      expect(parse('all-day-exdate', zone).map(event => [event.start, event.end])).toEqual([
        ['2026-10-19', '2026-10-20'], ['2026-10-21', '2026-10-22'],
      ])
    }
  })
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
