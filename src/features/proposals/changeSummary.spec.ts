import { afterEach, describe, expect, it } from 'vitest'
import { setHourCycle } from '@/ui/format'
import { calendarExport } from '@/core/calendarExport'
import type { PlannerEvent } from '@/core/model'
import { summarizeEntity, type SummaryContext } from './changeSummary'

const context: SummaryContext = { categories: [], locale: 'en-US', timeZone: 'UTC', t: key => key }

describe('proposal date summaries', () => {
  it.each([
    ['2026-10-24T00:00:00+14:00', '2026-10-25T00:00:00+14:00', 'Oct\u00a024,\u00a02026\u00a0–\u00a0Oct\u00a024,\u00a02026', '20261024', '20261025'],
    ['2026-10-31T00:00:00+14:00', '2026-11-03T00:00:00+14:00', 'Oct\u00a031,\u00a02026\u00a0–\u00a0Nov\u00a02,\u00a02026', '20261031', '20261103'],
    ['2026-12-31T23:00:00-12:00', '2027-01-02T23:00:00-12:00', 'Dec\u00a031,\u00a02026\u00a0–\u00a0Jan\u00a01,\u00a02027', '20261231', '20270102'],
    ['2028-02-29T00:00:00Z', '2028-03-01T00:00:00Z', 'Feb\u00a029,\u00a02028\u00a0–\u00a0Feb\u00a029,\u00a02028', '20280229', '20280301'],
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
        .toEqual([{ label: 'proposals.fields.due', value: 'Oct\u00a024,\u00a02026' }])
    }
  })

  it.each([
    ['UTC', 'Oct\u00a023,\u00a02026, 10:00\u00a0AM\u00a0–\u00a0Oct\u00a023,\u00a02026, 11:00\u00a0AM'],
    ['America/Los_Angeles', 'Oct\u00a023,\u00a02026, 3:00\u00a0AM\u00a0–\u00a0Oct\u00a023,\u00a02026, 4:00\u00a0AM'],
    ['Pacific/Kiritimati', 'Oct\u00a024,\u00a02026, 12:00\u00a0AM\u00a0–\u00a0Oct\u00a024,\u00a02026, 1:00\u00a0AM'],
  ])('converts timed event instants to the workspace time zone: %s', (timeZone, expected) => {
    expect(summarizeEntity({ allDay: false, start: '2026-10-24T00:00:00+14:00', end: '2026-10-24T01:00:00+14:00' }, { ...context, timeZone }))
      .toEqual([{ label: 'proposals.fields.when', value: expected }])
  })
})

describe('routine times', () => {
  const t = (key: string, params?: Record<string, unknown>) => (key === 'week.grid.crossesMidnight' ? `${String(params?.range)} (overnight)` : key)
  it('names a routine that runs past midnight as overnight, and a daytime one plainly', () => {
    expect(summarizeEntity({ start: 1350, end: 390 }, { ...context, t })).toContainEqual({ label: 'proposals.fields.time', value: '10:30\u00a0PM\u00a0–\u00a06:30\u00a0AM (overnight)' })
    expect(summarizeEntity({ start: 540, end: 600 }, { ...context, t })).toContainEqual({ label: 'proposals.fields.time', value: '9:00\u00a0AM\u00a0–\u00a010:00\u00a0AM' })
  })
})

// verify4 defect 9: the review sheet wrote routine ranges as "18:00\u00a0–\u00a019:00" on a 12-hour clock.
describe('proposal times follow the 12/24 h setting', () => {
  afterEach(() => setHourCycle('auto'))

  it('writes a routine range and an event on the clock the person chose', () => {
    const spanish: SummaryContext = { ...context, locale: 'es' }
    setHourCycle('h12')
    const range = summarizeEntity({ start: 1080, end: 1140 }, spanish).find((row) => row.label === 'proposals.fields.time')!.value
    expect(range).toMatch(/^6:00\sp\.\s?m\.\u00a0–\u00a07:00\sp\.\s?m\.$/u)
    const event = summarizeEntity({ start: '2026-10-22T18:00:00Z', end: '2026-10-22T19:00:00Z', allDay: false }, spanish).find((row) => row.label === 'proposals.fields.when')!.value
    expect(event).toMatch(/6:00\sp\.\s?m\./u)
    setHourCycle('h23')
    expect(summarizeEntity({ start: 1080, end: 1140 }, { ...context, locale: 'en-US' })[0]!.value).toBe('18:00\u00a0–\u00a019:00')
  })
})

describe('a task\'s fixed start and length in the approval summary (P1 review F4)', () => {
  const task = { id: 't', title: 'Dentista', priority: 2, createdAt: '2026-10-20T08:00:00.000Z', dueDate: '2026-10-27' }
  const fieldOf = (value: unknown, label: string) => summarizeEntity(value, context).find((row) => row.label === `proposals.fields.${label}`)?.value

  it('a move from 09:00 to 17:00 reads differently before and after', () => {
    const plain = (value: string | undefined) => value?.replace(/[\u00a0\u202f]/g, ' ')
    expect(plain(fieldOf({ ...task, at: 540 }, 'at'))).toBe('9:00 AM')
    expect(plain(fieldOf({ ...task, at: 1020 }, 'at'))).toBe('5:00 PM')
  })

  it('removing the fixed time or the length shows on the after side', () => {
    expect(fieldOf({ ...task }, 'at')).toBe('proposals.noFixedTime')
    expect(fieldOf({ ...task, durationMin: 30 }, 'duration')).toBe('proposals.minutes')
    expect(fieldOf({ ...task }, 'duration')).toBe('tasks.add.untimed')
  })
})
