import { describe, expect, it } from 'vitest'
import { exportNudge, noteFirstVisit, readNudgeInput, recordExport, snoozeNudge } from './exportReminder'

const NOW = new Date('2026-10-24T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const base = { lastExport: null, firstSeen: null, snoozedAt: null, now: NOW, hasContent: true }

describe('weekly export nudge', () => {
  it('stays quiet during the first week and when there is nothing to save', () => {
    expect(exportNudge({ ...base, firstSeen: daysAgo(3) })).toBeNull()
    expect(exportNudge({ ...base, firstSeen: daysAgo(30), hasContent: false })).toBeNull()
    expect(exportNudge(base)).toBeNull()
  })

  it('asks after a week without any export, and names the days after an old export', () => {
    expect(exportNudge({ ...base, firstSeen: daysAgo(8) })).toEqual({ kind: 'never' })
    expect(exportNudge({ ...base, firstSeen: daysAgo(40), lastExport: daysAgo(9) })).toEqual({ kind: 'overdue', days: 9 })
    expect(exportNudge({ ...base, firstSeen: daysAgo(40), lastExport: daysAgo(6) })).toBeNull()
  })

  it('"not now" holds it back for another week', () => {
    expect(exportNudge({ ...base, firstSeen: daysAgo(40), lastExport: daysAgo(20), snoozedAt: daysAgo(2) })).toBeNull()
    expect(exportNudge({ ...base, firstSeen: daysAgo(40), lastExport: daysAgo(20), snoozedAt: daysAgo(8) })).toEqual({ kind: 'overdue', days: 20 })
  })

  it('remembers the times in storage it is given', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
    noteFirstVisit(new Date(daysAgo(10)), storage)
    noteFirstVisit(NOW, storage)
    expect(readNudgeInput(NOW, true, storage).firstSeen).toBe(daysAgo(10))
    recordExport(NOW, storage)
    snoozeNudge(NOW, storage)
    expect(readNudgeInput(NOW, true, storage)).toMatchObject({ lastExport: NOW.toISOString(), snoozedAt: NOW.toISOString() })
  })
})
