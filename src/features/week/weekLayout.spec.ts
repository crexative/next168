import { describe, expect, it } from 'vitest'
import { INSTANT_EVENT_MINUTES, blockSegmentsByDate, busySegmentsByDate, layoutDaySegments, nearestHitTarget, placeTasks, splitByLocalDay } from './weekLayout'
import type { ExternalOccurrence, PlannerEvent, TimeBlock } from '@/core/model'
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
    expect(layoutDaySegments(segments['2026-10-21']!, []).blocks.map((segment) => [segment.occurrence.blockId, segment.lane, segment.lanes])).toEqual([['deep', 0, 2], ['call', 1, 2]])
    expect(layoutDaySegments(segments['2026-10-20']!, []).blocks.map((segment) => [segment.lane, segment.lanes])).toEqual([[0, 1]])
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

describe('shared day lanes', () => {
  const date = '2026-10-21'
  const block = (id: string, start: number, end: number): TimeBlock => ({ ...deepWork, id, title: id, days: [3], start, end })
  const event = (start: string, end: string): ExternalOccurrence => ({ sourceId: 'calendar', uid: 'external', title: 'External', start, end, allDay: false, busy: true })

  function layout(blocks: TimeBlock[], external: ExternalOccurrence[] = [], events: PlannerEvent[] = [], day = date) {
    const segments = blockSegmentsByDate(plannerDocument({ blocks }), week, 'UTC')[day]!
    const busy = busySegmentsByDate(external, events, week, 'UTC')[day]!
    return layoutDaySegments(segments, busy)
  }

  function expectDisjoint(result: ReturnType<typeof layout>) {
    const items = [...result.blocks, ...result.busy]
    for (const [index, item] of items.entries()) {
      expect(item.left).toBeGreaterThanOrEqual(0)
      expect(item.left + item.width).toBeLessThanOrEqual(100)
      for (const other of items.slice(index + 1)) {
        if (item.startMinute < other.endMinute && other.startMinute < item.endMinute) {
          // Thirds have floating-point roundoff; the rendered lanes also have a 4 px gutter.
          const overlap = Math.min(item.left + item.width, other.left + other.width) - Math.max(item.left, other.left)
          expect(overlap).toBeLessThanOrEqual(1e-10)
        }
      }
    }
  }

  it('gives non-overlapping items full width, including touching endpoints', () => {
    const result = layout([block('A', 540, 660)], [event('2026-10-21T11:00:00Z', '2026-10-21T12:00:00Z')])
    expect([...result.blocks, ...result.busy].map(({ left, width, lanes }) => [left, width, lanes])).toEqual([[0, 100, 1], [0, 100, 1]])
  })

  it('places a block and an external event side by side', () => {
    const result = layout([block('A', 540, 660)], [event('2026-10-21T09:30:00Z', '2026-10-21T10:00:00Z')])
    expect(result.blocks[0]).toMatchObject({ left: 0, width: 50, lane: 0, lanes: 2 })
    expect(result.busy[0]).toMatchObject({ left: 50, width: 50, lane: 1, lanes: 2 })
    expectDisjoint(result)
  })

  it('keeps staggered overlapping blocks in shared lanes when only the later block overlaps an event', () => {
    const result = layout([block('A', 540, 660), block('B', 600, 720)], [event('2026-10-21T11:00:00Z', '2026-10-21T12:00:00Z')])
    expect(result.blocks.map(({ left, width, lane, lanes }) => [left, width, lane, lanes])).toEqual([[0, 50, 0, 2], [50, 50, 1, 2]])
    expect(result.busy[0]).toMatchObject({ left: 0, width: 50, lane: 0, lanes: 2 })
    expectDisjoint(result)
  })

  it('uses three equal lanes for mutually overlapping blocks, external and planner events', () => {
    const result = layout([block('A', 540, 660)], [event('2026-10-21T09:30:00Z', '2026-10-21T10:30:00Z')], [
      { id: 'planner', title: 'Planner', start: '2026-10-21T10:00:00Z', end: '2026-10-21T11:00:00Z', allDay: false, attendees: [] },
    ])
    const items = [...result.blocks, ...result.busy]
    expect(items.map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 3], [1, 3], [2, 3]])
    items.forEach((item) => expect(item.width).toBeCloseTo(100 / 3))
    expectDisjoint(result)
  })

  it('lays out each overnight block segment with only the events on that local day', () => {
    const blocks = [block('Night', 1320, 360)]
    const external = [event('2026-10-22T01:00:00Z', '2026-10-22T02:00:00Z')]
    expect(layout(blocks, external).blocks[0]).toMatchObject({ startMinute: 1320, endMinute: 1440, continuesAfter: true, width: 100 })
    const morning = layout(blocks, external, [], '2026-10-22')
    expect(morning.blocks[0]).toMatchObject({ startMinute: 0, endMinute: 360, continuesBefore: true, width: 50 })
    expectDisjoint(morning)
  })

  it('returns an empty layout for an empty day', () => {
    expect(layout([], [])).toEqual({ blocks: [], busy: [], loose: [] })
  })

  // Nothing is drawn over a routine at any width: an event on its title row, below it, or several events take lanes
  // beside it (docs/design/visual-design.md › Week items).
  it('gives an event on a routine\'s title row its own lane instead of covering the title', () => {
    for (const result of [
      layout([block('A', 540, 600)], [event(`${date}T09:00:00Z`, `${date}T10:00:00Z`)]),
      layout([block('A', 540, 660)], [event(`${date}T09:25:00Z`, `${date}T10:00:00Z`)]),
      layout([block('A', 540, 600)], [], [{ id: 'own', title: 'Own', start: `${date}T09:10:00Z`, end: `${date}T09:40:00Z`, allDay: false, attendees: [] }]),
    ]) {
      expect(result.blocks[0]).toMatchObject({ left: 0, width: 50 })
      expect(result.busy[0]).toMatchObject({ left: 50, width: 50 })
      // No second, stacked placement for narrow columns: the lanes are the only layout.
      expect(result.busy[0]).not.toHaveProperty('stackLeft')
      expectDisjoint(result)
    }
  })

  it('splits four overlapping items into four lanes', () => {
    const first = event(`${date}T09:00:00Z`, `${date}T10:00:00Z`)
    const result = layout([block('A', 540, 600)], [first, { ...first, uid: 'second' }, { ...first, uid: 'third' }])
    expect([...result.blocks, ...result.busy].map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 4], [1, 4], [2, 4], [3, 4]])
    expect([...result.blocks, ...result.busy].map((item) => Object.keys(item).filter((key) => key.startsWith('stack')))).toEqual([[], [], [], []])
    expectDisjoint(result)
  })

  it('gives a task in free time its own lane beside an event', () => {
    const task = { key: 'free', startMinute: 570, endMinute: 600 }
    const result = layoutDaySegments([], busySegmentsByDate([event(`${date}T09:00:00Z`, `${date}T10:00:00Z`)], [], [date], 'UTC')[date]!, [task])
    expect(result.busy[0]).toMatchObject({ left: 0, width: 50 })
    expect(result.loose[0]).toMatchObject({ key: 'free', left: 50, width: 50 })
  })

  it('draws an event with no duration as a short span, keeping its real times for the details', () => {
    const instant = event(`${date}T09:00:00Z`, `${date}T09:00:00Z`)
    const [segment] = busySegmentsByDate([instant], [], [date], 'UTC')[date]!
    expect(segment).toMatchObject({ startMinute: 540, endMinute: 540 + INSTANT_EVENT_MINUTES, start: instant.start, end: instant.end })
  })
})

describe('placing the tasks of one host', () => {
  const host = { top: 0, bottom: 96, strip: 20 }

  it('stacks back-to-back tasks under the title strip without covering each other', () => {
    expect(placeTasks([{ top: 0, bottom: 16 }, { top: 16, bottom: 32 }, { top: 32, bottom: 48 }], host, 12)).toEqual([
      { top: 20, bottom: 32, outline: false }, { top: 32, bottom: 44, outline: false }, { top: 44, bottom: 56, outline: false },
    ])
  })

  it('keeps tasks inside their host, pulling the last ones up when the end is crowded', () => {
    const boxes = placeTasks([{ top: 60, bottom: 76 }, { top: 76, bottom: 92 }, { top: 92, bottom: 96 }], host, 12)
    expect(boxes.at(-1)!.bottom).toBe(96)
    for (let index = 1; index < boxes.length; index++) expect(boxes[index]!.top).toBeGreaterThanOrEqual(boxes[index - 1]!.bottom)
    expect(boxes.every((box) => box.top >= 20 && box.bottom - box.top >= 12)).toBe(true)
  })

  it('outlines every task over the whole host when they cannot all fit below its title', () => {
    expect(placeTasks([{ top: 0, bottom: 8 }, { top: 8, bottom: 16 }], { top: 0, bottom: 24, strip: 20 }, 12)).toEqual([
      { top: 0, bottom: 24, outline: true }, { top: 0, bottom: 24, outline: true },
    ])
  })

  it('gives each task its own minimum height when one is given per task', () => {
    expect(placeTasks([{ top: 0, bottom: 8 }, { top: 8, bottom: 16 }], host, [30, 12])).toEqual([
      { top: 20, bottom: 50, outline: false }, { top: 50, bottom: 62, outline: false },
    ])
    expect(placeTasks([{ top: 0, bottom: 8 }, { top: 8, bottom: 16 }], host, [60, 30]).every((box) => box.outline)).toBe(true)
  })

  it('places in time order whatever the input order', () => {
    expect(placeTasks([{ top: 16, bottom: 32 }, { top: 0, bottom: 16 }], host, 12)).toEqual([{ top: 32, bottom: 44, outline: false }, { top: 20, bottom: 32, outline: false }])
  })
})

describe('daylight saving changes', () => {
  it('keeps an event that sits inside the repeated hour when the clocks go back', () => {
    // 00:45Z is 02:45 CEST and 01:15Z is 02:15 CET: the wall clock moves backwards but 30 minutes elapsed.
    expect(splitByLocalDay('2026-10-25T00:45:00Z', '2026-10-25T01:15:00Z', ['2026-10-25'], 'Europe/Berlin')).toEqual([
      { date: '2026-10-25', startMinute: 165, endMinute: 195, continuesBefore: false, continuesAfter: false },
    ])
  })

  it('keeps an event that spans the skipped hour when the clocks go forward', () => {
    // 00:30Z is 01:30 CET and 01:30Z is 03:30 CEST.
    expect(splitByLocalDay('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', ['2026-03-29'], 'Europe/Berlin')).toEqual([
      { date: '2026-03-29', startMinute: 90, endMinute: 210, continuesBefore: false, continuesAfter: false },
    ])
  })
})

describe('nearestHitTarget', () => {
  const HOUR = 48
  const gym = { kind: 'block' as const, id: 'gym', startMinute: 720, endMinute: 750, left: 0, width: 100 }
  const tall = { kind: 'block' as const, id: 'work', startMinute: 540, endMinute: 660, left: 0, width: 100 }

  it('reaches 10 px past a 30-minute block on each side, so every target is at least 44 px', () => {
    const top = 12 * HOUR
    const bottom = top + 24
    expect(nearestHitTarget([gym], top - 10, 50, HOUR)).toBe(gym)
    expect(nearestHitTarget([gym], bottom + 10, 50, HOUR)).toBe(gym)
    expect(nearestHitTarget([gym], top - 11, 50, HOUR)).toBeUndefined()
    expect(nearestHitTarget([gym], bottom + 11, 50, HOUR)).toBeUndefined()
  })

  it('does not grow an item that is already 44 px tall or more', () => {
    expect(nearestHitTarget([tall], 9 * HOUR - 1, 50, HOUR)).toBeUndefined()
    expect(nearestHitTarget([tall], 11 * HOUR + 1, 50, HOUR)).toBeUndefined()
    expect(nearestHitTarget([tall], 10 * HOUR, 50, HOUR)).toBe(tall)
  })

  it('stays inside the lane the item occupies', () => {
    const lane = { ...gym, left: 50, width: 50 }
    expect(nearestHitTarget([lane], 12 * HOUR + 30, 49, HOUR)).toBeUndefined()
    expect(nearestHitTarget([lane], 12 * HOUR + 30, 75, HOUR)).toBe(lane)
  })

  it('picks the item whose center is nearest when two reach the same point', () => {
    const above = { ...gym, id: 'above', startMinute: 690, endMinute: 720 }
    const y = 12 * HOUR - 2 // 2 px above Gym, 2 px below the end of the item above
    expect(nearestHitTarget([above, gym], y, 50, HOUR)?.id).toBe('above')
    expect(nearestHitTarget([above, gym], y + 6, 50, HOUR)?.id).toBe('gym')
  })
})
