import { describe, expect, it } from 'vitest'
import type { TimeBlock } from '@/core/model'
import { BLOCK_INSET, BUSY_INSET, LANE_GAP_PX, MIN_TASK_PX, PIECE_GAP_PX, TASK_INSET, planDayColumn, type ColumnMeasure, type DayColumnPlan } from './dayColumnPlan'
import { ELLIPSIS, fittedHeight, lineCount, type TextMetrics, type TextPiece, type TextRole } from './itemText'
import { blockSegmentsByDate, busySegmentsByDate, HOUR_HEIGHT_PX, type BusySegment, type TaskSegment } from './weekLayout'
import { plannerDocument } from './testDocument'

const DATE = '2026-10-21'
const BASE: Record<TextRole, { char: number; line: number }> = {
  blockTitle: { char: 7, line: 16.25 }, blockDetail: { char: 6, line: 15 }, caption: { char: 6, line: 16 }, taskTitle: { char: 6, line: 13.2 }, compact: { char: 5.5, line: 12.9 },
}

// Fake fonts: every character of a role has one width; `scale` 2 is text at 200 %.
function measureAt(width: number, scale = 1): ColumnMeasure {
  const metrics: TextMetrics = {
    width: (text, role) => [...text].length * BASE[role].char * scale,
    lineHeight: (role) => BASE[role].line * scale,
  }
  return { width, basis: `${width}px 16px`, metrics, markLead: 16 * scale, iconLead: 18 * scale, glyph: { width: 11.25 * scale, height: 11.25 * scale }, glyphMin: { width: 10 * scale, height: 10 * scale } }
}

const px = (minute: number) => (minute / 60) * HOUR_HEIGHT_PX
const block = (id: string, start: number, end: number, title = id): TimeBlock => ({ id, categoryId: 'work', title, days: [3], start, end })
const event = (title: string, start: number, end: number) => ({
  sourceId: 's', uid: title, title, allDay: false, busy: true,
  start: new Date(Date.UTC(2026, 9, 21, 0, start)).toISOString(), end: new Date(Date.UTC(2026, 9, 21, 0, end)).toISOString(),
})
const task = (id: string, startMinute: number, endMinute: number, title = id, categoryId: string | undefined = 'work'): TaskSegment => ({
  key: `${id}@${startMinute}`, taskId: id, title, categoryId, late: false, date: DATE, startMinute, endMinute, continuesBefore: false, continuesAfter: false,
})

function plan(options: { blocks?: TimeBlock[]; events?: ReturnType<typeof event>[]; tasks?: TaskSegment[]; measure: ColumnMeasure | null; compact?: boolean }): DayColumnPlan {
  const document = plannerDocument({ blocks: options.blocks ?? [] })
  return planDayColumn({
    blocks: blockSegmentsByDate(document, [DATE], 'UTC')[DATE]!,
    busy: busySegmentsByDate(options.events ?? [], [], [DATE], 'UTC')[DATE]!,
    tasks: options.tasks ?? [],
    hourHeight: HOUR_HEIGHT_PX,
    compact: options.compact ?? false,
    measure: options.measure,
    words: {
      block: (segment) => ({ title: segment.occurrence.title, time: '9:00 AM – 10:00 AM', category: 'Work time' }),
      busy: (item: BusySegment) => ({ title: item.title, conflict: options.blocks?.length ? 'Conflict' : undefined }),
      task: (segment) => ({ title: segment.title, late: false }),
    },
  })
}

const shown = (result: DayColumnPlan, id: string) => {
  const found = result.blocks.find((segment) => segment.occurrence.blockId === id)!.show
  const title = found.title && (found.small ? 'small' : found.cut ? 'title…' : 'title')
  return [title, found.time && 'time', found.category && 'category'].filter(Boolean).join('+') || 'mark'
}

describe('what a routine shows, by the size of its box', () => {
  // A 300 px phone column, a 145 px desktop column, a 95 px tablet column.
  it.each([
    [300, 1, 10, 'mark'], [300, 1, 15, 'mark'], [300, 1, 20, 'small'], [300, 1, 25, 'small'], [300, 1, 30, 'title'], [300, 1, 45, 'title'], [300, 1, 50, 'title+time'], [300, 1, 90, 'title+time+category'],
    [300, 2, 30, 'mark'], [300, 2, 45, 'small'], [300, 2, 60, 'title'], [300, 2, 120, 'title+time'], [300, 2, 150, 'title+time+category'],
    [145, 1, 60, 'title+time'], [95, 1, 60, 'title'], [95, 1, 90, 'title'], [130, 1, 90, 'title+time+category'], [60, 1, 120, 'title…'], [40, 1, 120, 'small'], [30, 1, 120, 'mark'],
  ])('a %i px column at %ix text, %i minutes: %s', (width, scale, minutes, expected) => {
    expect(shown(plan({ blocks: [block('meeting', 540, 540 + minutes, 'Team meeting')], measure: measureAt(width, scale) }), 'meeting')).toBe(expected)
  })

  it('wraps a title between words, ends a cut one with "…" after its last whole word, and draws no fragment of a word', () => {
    // 95 px column: 80 px for text: "Quarterly" (63) fits a line, "Quarterly budget" (112) does not: three lines.
    const two = plan({ blocks: [block('q', 540, 600, 'Quarterly budget review')], measure: measureAt(95) }).blocks[0]!.show
    expect(two).toMatchObject({ title: true, text: 'Quarterly budget…', cut: true, time: false })
    expect(plan({ blocks: [block('q', 540, 630, 'Quarterly budget review')], measure: measureAt(95) }).blocks[0]!.show).toMatchObject({ title: true, text: 'Quarterly budget review' })
    // A single word wider than the box is never cut: the box is a mark.
    expect(shown(plan({ blocks: [block('q', 540, 720, 'Abstimmungsgespräch')], measure: measureAt(95) }), 'q')).toBe('mark')
  })

  // Codex review: a "…" that belongs to the title is punctuation, not a cut.
  it('draws a title that itself ends with "…" whole, without calling it cut', () => {
    for (const name of ['Pausa…', 'Wait...']) {
      expect(plan({ blocks: [block('p', 540, 600, name)], measure: measureAt(300) }).blocks[0]!.show).toMatchObject({ title: true, text: name, cut: false })
    }
  })

  it('drops the category mark before the title', () => {
    const result = plan({ blocks: [block('w', 540, 600, 'Work')], measure: measureAt(300) })
    expect(result.blocks[0]!.show).toMatchObject({ title: true, mark: true })
    // 46 px column: 31 px for text, "Work" is 28 px, with the 16 px mark 44 px.
    expect(plan({ blocks: [block('w', 540, 600, 'Work')], measure: measureAt(46) }).blocks[0]!.show).toMatchObject({ title: true, mark: false })
  })

  it('draws the status icon only where it was measured: the word alone may fit where icon and word do not', () => {
    const at = (width: number) => planDayColumn({
      blocks: blockSegmentsByDate(plannerDocument({ blocks: [block('lunch', 780, 855, 'Lunch')] }), [DATE], 'UTC')[DATE]!,
      busy: [], tasks: [], hourHeight: HOUR_HEIGHT_PX, compact: false, measure: measureAt(width),
      words: { block: () => ({ title: 'Lunch', time: '1:00 – 3:00', status: 'Partly done' }), busy: () => ({ title: '' }), task: () => ({ title: '', late: false }) },
    }).blocks[0]!.show
    expect(at(300)).toMatchObject({ status: true, statusIcon: true })
    // 90 px column, 75 px for text: "Partly done" (66 px) fits one line, with the 18 px icon (84 px) it needs two, which a 75-minute routine cannot hold.
    expect(at(90)).toMatchObject({ status: true, statusIcon: false })
  })

  it('draws every word before the column is measured, and none in the overview', () => {
    expect(plan({ blocks: [block('m', 540, 555)], measure: null }).blocks[0]!.show).toMatchObject({ title: true, time: true })
    expect(plan({ blocks: [block('m', 540, 660)], measure: measureAt(300), compact: true }).blocks[0]!.show).toMatchObject({ title: false, time: false })
  })
})

describe('events and routines share the column', () => {
  it('puts an event that starts on a routine\'s title row beside it, never over it', () => {
    const result = plan({ blocks: [block('deep', 540, 780, 'Deep work')], events: [event('Vendor call', 545, 575)], measure: measureAt(145) })
    expect(result.blocks[0]).toMatchObject({ left: 0, width: 50 })
    expect(result.busy[0]).toMatchObject({ left: 50, width: 50 })
  })

  // verify8: a conflict always leads with its ⚠ where the ⚠ fits; its title follows with whole words as space allows.
  // At 973724c a box that held the whole title but not "⚠ title" drew the title alone, with no ⚠.
  it('shows a conflict as ⚠ and word, then ⚠ and title, then ⚠ and whole words, then ⚠ and the small title, then the ⚠ alone', () => {
    const at = (width: number, minutes: number) => plan({ blocks: [block('b', 540, 600)], events: [event('Vendor call', 540, 540 + minutes)], measure: measureAt(width) }).busy[0]!.show
    expect(at(400, 60)).toEqual({ icon: true, word: true, title: true, text: 'Vendor call', cut: false })
    expect(at(200, 30)).toEqual({ icon: true, word: false, title: true, text: 'Vendor call', cut: false })
    // 16 px tall, 74 px of room: no caption line, but the ⚠ and "Vendor…" in the small size beside it.
    expect(at(150, 20)).toMatchObject({ icon: true, word: false, title: true, text: 'Vendor…', cut: true, small: true })
    // 104 px column, two lanes: 42 px for text holds "Vendor" / "call" but no word after the ⚠: the ⚠ alone, never the
    // title without it (it stays in the accessible name and on tap).
    expect(at(104, 60)).toEqual({ icon: true, word: false, title: false })
    expect(at(120, 30)).toEqual({ icon: true, word: false, title: false })
    expect(at(60, 20)).toEqual({ icon: true, word: false, title: false })
    // Codex review of verify7: 14.4 px tall in a narrow lane: the ⚠ centred in the small insets, never the grey initial.
    expect(at(60, 18)).toEqual({ icon: true, word: false, title: false })
    // 12 px tall: too short for the ⚠ (10 px of room) or any text; the red border and hatching mark the conflict.
    expect(at(104, 15)).toEqual({ icon: false, word: false, title: false })
    expect(at(30, 5)).toEqual({ icon: false, word: false, title: false })
  })

  it('draws the ⚠ on a line of its own above a title that does not fit beside it', () => {
    // 100 px column, two lanes: 40 px of text room, 56 px tall. "⚠ Vendor" (54 px) does not fit a line; under a 13 px ⚠
    // line, "Vendor" / "call" does.
    const show = plan({ blocks: [block('b', 540, 600)], events: [event('Vendor call', 540, 615)], measure: measureAt(100) }).busy[0]!.show
    expect(show).toEqual({ icon: true, stacked: true, word: false, title: true, text: 'Vendor call', cut: false })
  })
})

describe('a box with no words', () => {
  // verify8 D3: a 15-minute item (12 px at a 48 px hour) has 10 px of room inside an event's small insets, less than the
  // glyph. At 973724c it was a bare strip; the glyph is now drawn scaled down to the room, never below its smallest size.
  it('draws the glyph scaled down to a box shorter than it, down to its smallest size', () => {
    const quarter = plan({ events: [event('Pausa', 540, 555)], measure: measureAt(300) }).busy[0]!.show
    expect(quarter).toMatchObject({ title: false, glyph: true })
    expect(quarter.glyphScale).toBeCloseTo(10 / 11.25, 5)
    // 10 minutes (8 px, 6 px of room) is below the smallest glyph: a bare strip.
    expect(plan({ events: [event('Pausa', 540, 550)], measure: measureAt(300) }).busy[0]!.show).toEqual({ icon: false, word: false, title: false })
  })

  it('keeps a 1 px gap between touching routines of one category, and none between different categories', () => {
    const blocks = [block('work', 540, 600), block('standup', 600, 615), { ...block('lunch', 615, 660), categoryId: 'meals' }]
    const result = plan({ blocks, measure: measureAt(300) }).blocks
    const byKey = (id: string) => result.find((planned) => planned.occurrence.blockId === id)!
    expect(byKey('work').bottom).toBe(px(600) - 1)
    expect(byKey('standup').bottom).toBe(px(615))
    expect(byKey('lunch').bottom).toBe(px(660))
  })

  it('shows a plain event its initial where the glyph fits, but a conflict only its ⚠ or nothing', () => {
    const lone = (minutes: number) => plan({ events: [event('Vendor call', 540, 540 + minutes)], measure: measureAt(26) }).busy[0]!.show
    // 26 px column: 20 px of room inside the small insets; "Vendor…" does not fit in the small size.
    expect(lone(18)).toMatchObject({ title: false, icon: false, glyph: true })
    const conflicting = (width: number, minutes: number) => plan({ blocks: [block('b', 540, 600)], events: [event('Vendor call', 540, 540 + minutes)], measure: measureAt(width) }).busy[0]!.show
    expect(conflicting(60, 18)).toEqual({ icon: true, word: false, title: false })
    // 17 px of room: 13.6 px tall holds the 11.25 px glyph but not the 12 px ⚠; the red border marks the conflict.
    expect(conflicting(60, 17)).toEqual({ icon: false, word: false, title: false })
  })
})

describe('tasks inside a routine', () => {
  // verify6 D1: "Trabajo de la mañana" beside a short event at 768 px needed three hyphenated lines ("Tra-" / "ba-" /
  // "jo…") but the strip above its tasks allowed two, so the routine was blank.
  it('hyphenates a routine\'s small title but never a task\'s', () => {
    const measure = measureAt(52)
    // The browser can break "Trabajo…" only in the small size.
    const hyphenating = { ...measure, metrics: { ...measure.metrics, hyphenatedLines: (text: string, role: string) => role === 'compact' && text.startsWith('Trabajo') ? 2 : null } }
    // A 30 px wide text area: "Trabajo…" does not fit whole at either size; hyphenated in the small size it does.
    const routine = plan({ blocks: [block('am', 510, 750, 'Trabajo de la mañana')], measure: hyphenating }).blocks[0]!.show
    expect(routine).toMatchObject({ title: true, small: true, hyphenate: true, text: 'Trabajo…' })
    const chunk = plan({ blocks: [block('am', 510, 750, 'Am')], tasks: [task('t', 600, 660, 'Trabajo de la mañana')], measure: hyphenating }).tasks[0]!.show
    expect(chunk.hyphenate).toBeFalsy()
  })

  it('gives a routine above its tasks the lines its hyphenated first word needs', () => {
    const measure = measureAt(60)
    const hyphenating = { ...measure, metrics: { ...measure.metrics, hyphenatedLines: (text: string) => text.startsWith('Trabajo') ? 3 : null } }
    const result = plan({ blocks: [block('am', 510, 750, 'Trabajo de la mañana')], tasks: [task('t', 540, 560, 'Pay')], measure: hyphenating })
    expect(result.blocks[0]!.show).toMatchObject({ title: true, text: 'Trabajo…', hyphenate: true })
    expect(result.tasks[0]!.top).toBeGreaterThanOrEqual(px(510) + BLOCK_INSET.top + 3 * 16.25 - 0.01)
  })

  it('starts tasks under the routine\'s title and draws the time only above the first task', () => {
    const result = plan({ blocks: [block('deep', 540, 780, 'Deep work')], tasks: [task('report', 540, 600, 'Write report')], measure: measureAt(300) })
    const [chunk] = result.tasks
    expect(chunk!.top).toBeCloseTo(9 * HOUR_HEIGHT_PX + BLOCK_INSET.top + 16.25 + PIECE_GAP_PX)
    expect(result.blocks[0]!.show).toMatchObject({ title: true, time: false })
    expect(chunk!.show.title).toBe(true)
    const later = plan({ blocks: [block('deep', 540, 780, 'Deep work')], tasks: [task('report', 660, 720, 'Write report')], measure: measureAt(300) })
    expect(later.blocks[0]!.show).toMatchObject({ title: true, time: true, category: true })
  })

  it('gives back-to-back 10-minute tasks the height of their title when the routine has room', () => {
    const tasks = [task('a', 600, 610, 'Call bank'), task('b', 610, 620, 'Email Ana'), task('c', 620, 630, 'Pay rent')]
    const result = plan({ blocks: [block('deep', 540, 780)], tasks, measure: measureAt(300) })
    expect(result.tasks.every((chunk) => chunk.show.title && chunk.bottom - chunk.top >= 13.2 + TASK_INSET.top + TASK_INSET.bottom - 0.01)).toBe(true)
  })

  it('falls back to one line in the small caption size, then 12 px marks, then one outline, as the routine gets shorter', () => {
    const tasks = [task('a', 540, 545, 'Call bank'), task('b', 545, 550, 'Email Ana'), task('c', 550, 555, 'Pay rent')]
    // 72 px: three caption lines (18.2 px each) do not fit under the title, three small ones (15.9 px) do.
    const small = plan({ blocks: [block('deep', 540, 630)], tasks, measure: measureAt(300) })
    expect(small.tasks.every((chunk) => !chunk.outline && chunk.show.small && chunk.show.title)).toBe(true)
    const marks = plan({ blocks: [block('deep', 540, 615)], tasks, measure: measureAt(300) })
    expect(marks.tasks.every((chunk) => !chunk.outline && !chunk.show.title && chunk.bottom - chunk.top >= MIN_TASK_PX)).toBe(true)
    const outline = plan({ blocks: [block('deep', 540, 570)], tasks, measure: measureAt(300) })
    expect(outline.tasks.every((chunk) => chunk.outline && !chunk.show.title)).toBe(true)
  })

  it('keeps a task in free time inside the free stretch around it', () => {
    const result = plan({ blocks: [block('a', 540, 600), block('b', 610, 700)], tasks: [task('free', 600, 605, 'Stretch', undefined)], measure: measureAt(300) })
    const [chunk] = result.tasks
    expect(chunk!.top).toBeGreaterThanOrEqual(10 * HOUR_HEIGHT_PX)
    expect(chunk!.bottom).toBeLessThanOrEqual((610 / 60) * HOUR_HEIGHT_PX + 0.01)
  })
})

// Every decision, for many seeded columns, sizes and text scales: what an item draws fits its box, and no box covers
// another item's words.
describe('the plan never draws a cut or covered word', () => {
  function random(seed: number) {
    let state = seed
    return () => {
      state = (state + 0x6d2b79f5) | 0
      let value = Math.imul(state ^ (state >>> 15), 1 | state)
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }
  const TITLES = ['Stand-up', 'Reunión diaria', 'Deep work', 'Revisión de diseño de producto', 'Tagesabschluss', 'Gym', 'Vendor call']

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const next = random(seed)
      const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!
      const blocks: TimeBlock[] = []
      let minute = 360
      while (minute < 1380) {
        const length = pick([5, 10, 15, 30, 45, 60, 120, 240])
        blocks.push(block(`b${blocks.length}`, minute, Math.min(1435, minute + length), pick(TITLES)))
        minute += length + pick([0, 0, 15, 60])
      }
      const events = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, index) => {
        const host = pick(blocks)
        const start = host.start + pick([0, 5, 10, 20])
        return event(`${pick(TITLES)} ${index}`, start, Math.min(1440, start + pick([5, 15, 30, 60])))
      })
      const tasks = blocks.flatMap((host, index) => next() < 0.5 ? [] : [0, 1, 2].slice(0, 1 + Math.floor(next() * 3)).map((offset) => {
        const start = Math.min(host.end - 1, host.start + offset * 10)
        return task(`t${index}-${offset}`, start, Math.min(host.end, start + pick([5, 10, 15, 20])), pick(TITLES))
      }).filter((item) => item.endMinute > item.startMinute))
      const measure = measureAt(pick([60, 95, 145, 260, 300]), pick([1, 2]))
      const result = plan({ blocks, events, tasks, measure })
      const px = (value: number) => (value / 60) * HOUR_HEIGHT_PX
      const width = (lane: { width: number }) => (measure.width * lane.width) / 100 - 2 * LANE_GAP_PX

      // A drawn title is the whole title or its first whole words and "…".
      const wholeWords = (show: { text?: string; cut?: boolean }, title: string) => show.text === undefined || !show.cut && show.text === title || Boolean(show.cut) && show.text.endsWith(ELLIPSIS) && title.startsWith(show.text.slice(0, -1)) && title[show.text.length - 1] === ' '
      for (const segment of result.blocks) {
        const count = [segment.show.title, segment.show.time, segment.show.category].filter(Boolean).length
        expect([segment.show.title, segment.show.time, segment.show.category].slice(0, count).every(Boolean)).toBe(true)
        if (count === 0) continue
        expect(wholeWords(segment.show, segment.occurrence.title), `${segment.show.text} of ${segment.occurrence.title}`).toBe(true)
        if (segment.show.cut) expect(count, 'nothing follows a cut title').toBe(1)
        // A title in the small caption size has no padding above or below; the others keep the routine's insets.
        const small = Boolean(segment.show.small)
        if (small) expect(count, 'nothing follows a title in the small caption size').toBe(1)
        const pieces: TextPiece[] = [
          { text: segment.show.text ?? segment.occurrence.title, role: small ? 'compact' : 'blockTitle', lead: segment.show.mark ? measure.markLead : 0 },
          { text: '9:00\u00a0AM – 10:00\u00a0AM', role: 'blockDetail', maxLines: 1 }, { text: 'Work time', role: 'blockDetail' },
        ]
        const textWidth = width(segment) - BLOCK_INSET.start - BLOCK_INSET.end
        const fits = pieces.slice(0, count).map((piece) => ({ lines: lineCount(piece, textWidth, measure.metrics), lead: false }))
        expect(fits.every((fit) => fit.lines !== null), 'every drawn piece fits its width').toBe(true)
        expect(fits[1] === undefined || fits[1].lines === 1, 'a time range is on one line').toBe(true)
        const top = px(segment.startMinute) + (small && segment.show.center ? 0 : BLOCK_INSET.top)
        const textBottom = top + fittedHeight(pieces, fits.map((fit) => ({ ...fit, lines: fit.lines! })), measure.metrics, PIECE_GAP_PX)
        expect(textBottom).toBeLessThanOrEqual(px(segment.endMinute) + 0.01)
        for (const chunk of result.tasks.filter((item) => item.hostKey === segment.key && !item.outline)) expect(chunk.top).toBeGreaterThanOrEqual(textBottom - 0.01)
      }
      for (const chunk of result.tasks) expect(wholeWords(chunk.show, chunk.task.title)).toBe(true)
      for (const item of result.busy) expect(wholeWords(item.show, item.title)).toBe(true)
      for (const item of result.busy) {
        if (!item.show.title) continue
        expect(px(item.endMinute) - px(item.startMinute) - BUSY_INSET.top - BUSY_INSET.bottom).toBeGreaterThanOrEqual(measure.metrics.lineHeight('caption') - 0.01)
      }
      // Boxes of different items never overlap, except a task inside its own routine.
      const boxes = [
        ...result.blocks.map((item) => ({ key: item.key, host: undefined as string | undefined, left: item.left, right: item.left + item.width, top: px(item.startMinute), bottom: px(item.endMinute) })),
        ...result.busy.map((item) => ({ key: item.key, host: undefined as string | undefined, left: item.left, right: item.left + item.width, top: px(item.startMinute), bottom: px(item.endMinute) })),
        ...result.tasks.filter((item) => !item.outline).map((item) => ({ key: item.task.key, host: item.hostKey, left: item.left, right: item.left + item.width, top: item.top, bottom: item.bottom })),
      ]
      for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
          if (a.host === b.key || b.host === a.key) continue
          const overlaps = a.left < b.right - 1e-9 && b.left < a.right - 1e-9 && a.top < b.bottom - 0.01 && b.top < a.bottom - 0.01
          expect(overlaps, `${a.key} and ${b.key}`).toBe(false)
        }
      }
    })
  }
})
