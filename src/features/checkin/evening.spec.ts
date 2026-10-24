import { describe, expect, it } from 'vitest'
import { plannerDocument } from '@/features/week/testDocument'
import { checkInCardVisible, checkInDateFor, checkInDoneToday } from './evening'

describe('check-in card timing', () => {
  const empty = plannerDocument()

  it('is hidden before 20:00 and appears from 20:00', () => {
    expect(checkInCardVisible(empty, new Date('2026-10-21T19:59:00Z'))).toBe(false)
    expect(checkInCardVisible(empty, new Date('2026-10-21T20:00:00Z'))).toBe(true)
  })

  it('uses the document time zone', () => {
    const bogota = plannerDocument({ settings: { ...empty.settings, timeZone: 'America/Bogota' } })
    expect(checkInCardVisible(bogota, new Date('2026-10-22T00:30:00Z'))).toBe(false) // 19:30 in Bogotá
    expect(checkInCardVisible(bogota, new Date('2026-10-22T01:00:00Z'))).toBe(true) // 20:00 in Bogotá
  })

  it('stays visible all day once today’s check-in exists', () => {
    const done = plannerDocument({ checkIns: [{ date: '2026-10-21' }] })
    expect(checkInDoneToday(done, new Date('2026-10-21T08:00:00Z'))).toBe(true)
    expect(checkInCardVisible(done, new Date('2026-10-21T08:00:00Z'))).toBe(true)
    expect(checkInDoneToday(done, new Date('2026-10-22T08:00:00Z'))).toBe(false)
  })

  it('decides “today” in the document time zone, not in UTC', () => {
    const bogota = plannerDocument({ settings: { ...empty.settings, timeZone: 'America/Bogota' }, checkIns: [{ date: '2026-10-21' }] })
    // 21:00 in Bogotá on 21 Oct is already 22 Oct in UTC.
    expect(checkInDoneToday(bogota, new Date('2026-10-22T02:00:00Z'))).toBe(true)
    // 01:00 on 22 Oct in Bogotá is still the night of the 21st; from 04:00 the 22nd needs its own.
    expect(checkInDoneToday(bogota, new Date('2026-10-22T06:00:00Z'))).toBe(true)
    expect(checkInDoneToday(bogota, new Date('2026-10-22T09:00:00Z'))).toBe(false)
  })
})

describe('which day the check-in closes', () => {
  it('is today until midnight, the day before until 04:00, then today again', () => {
    expect(checkInDateFor(new Date('2026-10-21T23:59:00Z'), 'UTC')).toBe('2026-10-21')
    expect(checkInDateFor(new Date('2026-10-22T00:30:00Z'), 'UTC')).toBe('2026-10-21')
    expect(checkInDateFor(new Date('2026-10-22T03:59:00Z'), 'UTC')).toBe('2026-10-21')
    expect(checkInDateFor(new Date('2026-10-22T04:00:00Z'), 'UTC')).toBe('2026-10-22')
  })

  it('counts local time on the nights the clocks change', () => {
    // Madrid springs forward on 29 March 2026 (02:00 → 03:00): 03:30 local is still the 28th's night.
    expect(checkInDateFor(new Date('2026-03-29T01:30:00Z'), 'Europe/Madrid')).toBe('2026-03-28')
    expect(checkInDateFor(new Date('2026-03-29T02:00:00Z'), 'Europe/Madrid')).toBe('2026-03-29') // 04:00 local
    // Madrid falls back on 25 October 2026 (03:00 → 02:00): 03:59 local (after the repeat) is the 24th's night.
    expect(checkInDateFor(new Date('2026-10-25T02:59:00Z'), 'Europe/Madrid')).toBe('2026-10-24')
    expect(checkInDateFor(new Date('2026-10-25T03:00:00Z'), 'Europe/Madrid')).toBe('2026-10-25') // 04:00 local
  })

  it('keeps the card on screen after midnight until the day closes', () => {
    const empty = plannerDocument()
    expect(checkInCardVisible(empty, new Date('2026-10-22T00:30:00Z'))).toBe(true)
    expect(checkInCardVisible(empty, new Date('2026-10-22T04:00:00Z'))).toBe(false)
    const doneLastNight = plannerDocument({ checkIns: [{ date: '2026-10-21' }] })
    expect(checkInDoneToday(doneLastNight, new Date('2026-10-22T00:30:00Z'))).toBe(true)
  })
})
