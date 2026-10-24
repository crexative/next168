import { describe, expect, it } from 'vitest'
import { calendarExport } from '@/core/calendarExport'
import type { PlannerEvent } from '@/core/model'
import { summarizeEntity, type SummaryContext } from './changeSummary'

const context: SummaryContext = { categories: [], locale: 'en-US', timeZone: 'UTC', t: key => key }

describe('proposal date summaries', () => {
  it.each([
    ['2026-10-24T00:00:00+14:00', '2026-10-25T00:00:00+14:00', 'Oct 24, 2026 – Oct 24, 2026', '20261024', '20261025'],
    ['2026-10-31T00:00:00+14:00', '2026-11-03T00:00:00+14:00', 'Oct 31, 2026 – Nov 2, 2026', '20261031', '20261103'],
    ['2026-12-31T23:00:00-12:00', '2027-01-02T23:00:00-12:00', 'Dec 31, 2026 – Jan 1, 2027', '20261231', '20270102'],
    ['2028-02-29T00:00:00Z', '2028-03-01T00:00:00Z', 'Feb 29, 2028 – Feb 29, 2028', '20280229', '20280301'],
  ])('shows stored all-day dates with an exclusive end: %s to %s', (start, end, expected, exportStart, exportEnd) => {
    const event: PlannerEvent = { id: 'all-day', title: 'Holiday', allDay: true, start, end, attendees: [] }
    for (const timeZone of ['UTC', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
      expect(summarizeEntity(event, { ...context, timeZone })).toContainEqual({ label: 'proposals.fields.when', value: expected })
    }
    expect(calendarExport([event], { now: () => new Date('2026-10-24T12:00:00Z') }))
      .toContain(`DTSTART;VALUE=DATE:${exportStart}\r\nDTEND;VALUE=DATE:${exportEnd}`)
  })

  it('keeps task due dates independent of the workspace time zone', () => {
    for (const timeZone of ['UTC', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
      expect(summarizeEntity({ dueDate: '2026-10-24' }, { ...context, timeZone }))
        .toEqual([{ label: 'proposals.fields.due', value: 'Oct 24, 2026' }])
    }
  })

  it.each([
    ['UTC', 'Oct 23, 2026, 10:00 AM – Oct 23, 2026, 11:00 AM'],
    ['America/Los_Angeles', 'Oct 23, 2026, 3:00 AM – Oct 23, 2026, 4:00 AM'],
    ['Pacific/Kiritimati', 'Oct 24, 2026, 12:00 AM – Oct 24, 2026, 1:00 AM'],
  ])('converts timed event instants to the workspace time zone: %s', (timeZone, expected) => {
    expect(summarizeEntity({ allDay: false, start: '2026-10-24T00:00:00+14:00', end: '2026-10-24T01:00:00+14:00' }, { ...context, timeZone }))
      .toEqual([{ label: 'proposals.fields.when', value: expected }])
  })
})
