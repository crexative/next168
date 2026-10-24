import { describe, expect, it } from 'vitest'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { freeHoursAhead, weekEnd } from './freeHours'

// Wednesday 2026-10-21 10:15 UTC; with weeks starting on Monday the week ends at Monday 00:00.
const NOW = new Date('2026-10-21T10:15:00Z')
const REMAINING_HOURS = (4 * 24 * 60 + 13 * 60 + 45) / 60 // 109.75 h from Wed 10:15 to Mon 00:00

describe('freeHoursAhead', () => {
  it('is every remaining hour of the week for an empty plan', () => {
    expect(freeHoursAhead(plannerDocument(), NOW, 'UTC')).toBe(REMAINING_HOURS)
  })

  it('subtracts the covered part of the block in progress and every later block this week', () => {
    // Deep work 09:00–11:00 Mon–Fri: 45 min of today left, then Thu and Fri in full.
    const covered = (45 + 2 * 120) / 60
    expect(freeHoursAhead(plannerDocument({ blocks: [deepWork] }), NOW, 'UTC')).toBe(REMAINING_HOURS - covered)
  })

  it('counts overlapping blocks once and clips an overnight block at the end of the week', () => {
    const overlapping = { ...deepWork, id: 'overlap', start: 600, end: 720 }
    const covered = (45 + 60 + 2 * 180) / 60 // today 10:15–12:00, then Thu and Fri 09:00–12:00
    expect(freeHoursAhead(plannerDocument({ blocks: [deepWork, overlapping] }), NOW, 'UTC')).toBe(REMAINING_HOURS - covered)
    // Sunday's Sleep starts at 22:00 and would end Monday 06:00, after the week: only 2 h belong to it.
    const sundayOnly = { ...sleep, days: [0] as [0] }
    expect(freeHoursAhead(plannerDocument({ blocks: [sundayOnly] }), NOW, 'UTC')).toBe(REMAINING_HOURS - 2)
  })

  it('counts the part of last night’s block that is still ahead', () => {
    const now = new Date('2026-10-21T02:00:00Z') // Sleep from Tue 22:00 ends 06:00
    const tail = 4
    const remaining = 4 * 24 + 22 // Wed 02:00 to Mon 00:00
    expect(freeHoursAhead(plannerDocument({ blocks: [{ ...sleep, days: [2] as [2] }] }), now, 'UTC')).toBe(remaining - tail)
  })

  it('ends the week on Saturday when weeks start on Sunday', () => {
    const document = plannerDocument({ settings: { ...plannerDocument().settings, weekStartsOn: 0 } })
    expect(weekEnd(document, NOW, 'UTC').lastDate).toBe('2026-10-24')
    expect(freeHoursAhead(document, NOW, 'UTC')).toBe((3 * 24 * 60 + 13 * 60 + 45) / 60)
    // Sunday 00:00 opens a new week for these settings: all 168 hours are ahead.
    expect(freeHoursAhead(document, new Date('2026-10-25T00:00:00Z'), 'UTC')).toBe(168)
  })

  it('follows the document time zone for the end of the week', () => {
    const document = plannerDocument()
    // 23:30 UTC on Sunday is already Monday 08:30 in Tokyo, so a new week has just started there.
    const now = new Date('2026-10-25T23:30:00Z')
    expect(freeHoursAhead(document, now, 'UTC')).toBe(0.5)
    expect(freeHoursAhead(document, now, 'Asia/Tokyo')).toBe(7 * 24 - 8.5)
  })
})
