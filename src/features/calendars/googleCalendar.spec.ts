import { describe, expect, it } from 'vitest'
import { coverageIncludes, occurrencesWithin } from './googleCalendar'

// Review finding 3: civil dates mean something only in the zone they were read in.
describe('coverageIncludes', () => {
  const coverage = { start: '2026-10-12', end: '2026-11-30', timeZone: 'UTC' }

  it('covers a range inside it in the same zone', () => {
    expect(coverageIncludes(coverage, { start: '2026-11-23', end: '2026-11-30' }, 'UTC')).toBe(true)
  })

  it('covers nothing once the planner is in another zone', () => {
    // 2026-11-30T01:00Z is Sunday 29 November in Los Angeles but outside a UTC read that ends on the 30th.
    expect(occurrencesWithin([{ sourceId: 'google:primary', uid: 'late', title: '', start: '2026-11-30T01:00:00.000Z', end: '2026-11-30T02:00:00.000Z', allDay: false, busy: true }], { start: '2026-11-23', end: '2026-11-30' }, 'America/Los_Angeles')).toHaveLength(1)
    expect(coverageIncludes(coverage, { start: '2026-11-23', end: '2026-11-30' }, 'America/Los_Angeles')).toBe(false)
  })

  it('covers nothing without a read', () => {
    expect(coverageIncludes(undefined, { start: '2026-11-23', end: '2026-11-30' }, 'UTC')).toBe(false)
  })
})
