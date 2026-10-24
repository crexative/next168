import { describe, expect, it } from 'vitest'
import { plannerDocument } from '@/features/week/testDocument'
import { checkInCardVisible, checkInDoneToday } from './evening'

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
})
