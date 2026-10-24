import { describe, expect, it } from 'vitest'
import { blockSegmentsByDate, busySegmentsByDate, splitByLocalDay } from './weekLayout'
import { weekDates } from './localTime'
import { deepWork, plannerDocument, sleep } from './testDocument'

const week = weekDates('2026-10-21', 1)

describe('week layout', () => {
  it('splits an overnight occurrence at local midnight', () => {
    expect(splitByLocalDay('2026-10-21T22:00:00Z', '2026-10-22T06:00:00Z', week, 'UTC')).toEqual([
      { date: '2026-10-21', startMinute: 1320, endMinute: 1440, continuesBefore: false, continuesAfter: true },
      { date: '2026-10-22', startMinute: 0, endMinute: 360, continuesBefore: true, continuesAfter: false },
    ])
  })

  it('shows an overnight block on both days, including the night before the week starts', () => {
    const segments = blockSegmentsByDate(plannerDocument({ blocks: [sleep] }), week, 'UTC')
    expect(segments['2026-10-19']!.map((segment) => [segment.startMinute, segment.endMinute, segment.occurrence.date])).toEqual([
      [0, 360, '2026-10-18'],
      [1320, 1440, '2026-10-19'],
    ])
    expect(Object.values(segments).flat()).toHaveLength(14)
  })

  it('positions blocks by wall-clock time in the document zone', () => {
    const segments = blockSegmentsByDate(plannerDocument({ blocks: [deepWork] }), week, 'America/Bogota')
    expect(segments['2026-10-21']!.map((segment) => [segment.startMinute, segment.endMinute])).toEqual([[540, 660]])
    expect(segments['2026-10-25']).toEqual([])
  })

  it('keeps blocks at their wall-clock place across a DST change', () => {
    const early = { id: 'early', categoryId: 'work', title: 'Early', days: [0], start: 60, end: 240 }
    const segments = blockSegmentsByDate(plannerDocument({ blocks: [early] }), week, 'Europe/Berlin')
    expect(segments['2026-10-25']!.map((segment) => [segment.startMinute, segment.endMinute, segment.occurrence.plannedMinutes])).toEqual([[60, 240, 240]])
  })

  it('places overlapping blocks side by side', () => {
    const overlap = { ...deepWork, id: 'call', title: 'Call', days: [3] as const, start: 600, end: 720 }
    const segments = blockSegmentsByDate(plannerDocument({ blocks: [deepWork, { ...overlap, days: [3] }] }), week, 'UTC')
    expect(segments['2026-10-21']!.map((segment) => [segment.occurrence.blockId, segment.lane, segment.lanes])).toEqual([['deep', 0, 2], ['call', 1, 2]])
    expect(segments['2026-10-20']!.map((segment) => [segment.lane, segment.lanes])).toEqual([[0, 1]])
  })

  it('turns busy calendar events and Next168 events into overlays, skipping free and all-day ones', () => {
    const busy = busySegmentsByDate([
      { sourceId: 's', uid: 'a', title: 'Flight', start: '2026-10-21T23:00:00Z', end: '2026-10-22T01:00:00Z', allDay: false, busy: true },
      { sourceId: 's', uid: 'b', title: 'Free', start: '2026-10-21T12:00:00Z', end: '2026-10-21T13:00:00Z', allDay: false, busy: false },
      { sourceId: 's', uid: 'c', title: 'Holiday', start: '2026-10-23', end: '2026-10-24', allDay: true, busy: true },
    ], [
      { id: 'e', title: 'Dentist', start: '2026-10-20T15:00:00Z', end: '2026-10-20T16:00:00Z', allDay: false, attendees: [] },
    ], week, 'UTC')
    expect(Object.values(busy).flat().map((item) => [item.title, item.date, item.startMinute, item.endMinute, item.kind])).toEqual([
      ['Dentist', '2026-10-20', 900, 960, 'event'],
      ['Flight', '2026-10-21', 1380, 1440, 'external'],
      ['Flight', '2026-10-22', 0, 60, 'external'],
    ])
  })
})
