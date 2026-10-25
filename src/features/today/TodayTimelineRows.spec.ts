import { afterEach, describe, expect, it, vi } from 'vitest'
import { datedOccurrences } from '@/core/time'
import { mountForTest } from '@/features/week/mountForTest'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import TodayTimeline from './TodayTimeline.vue'
import { recordActual } from './actuals'
import { buildTimeline } from './todayTimeline'

let unmount = () => undefined as void
afterEach(() => unmount())

const TODAY = '2026-10-21'
const document = plannerDocument({ blocks: [deepWork, sleep] })
const { items } = buildTimeline({ document, today: TODAY, timeZone: 'UTC', external: [], placements: [] })
const SINCE = Date.parse('2026-10-20T00:00:00Z')
const deepWorkKey = items.find((item) => item.kind === 'block' && item.title === 'Deep work')!.key
const task = { kind: 'task' as const, key: 'task:t@10', title: 'Write report', start: '2026-10-21T13:00:00.000Z', end: '2026-10-21T14:00:00.000Z', overlapsWith: [], taskId: 't', categoryId: 'work', late: false }

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountForTest(TodayTimeline, {
    items, allDay: [], actuals: [], categories: document.categories, now: new Date('2026-10-21T12:00:00Z'),
    timeZone: 'UTC', writable: true, planSince: SINCE, ...props,
  })
  unmount = mounted.unmount
  return mounted.host
}

const rowOf = (host: HTMLElement, title: string) => [...host.querySelectorAll<HTMLElement>('[data-testid="timeline-item"]')].find((row) => row.textContent?.includes(title) && !row.classList.contains('is-carry'))!
const controls = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="status-control"]')]

describe('TodayTimeline rows', () => {
  it('collapses last night’s sleep to a single line without a status question', async () => {
    const host = await render()
    const carry = host.querySelector('[data-testid="timeline-carry"]')!
    expect(carry.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Sleep\s*Since yesterday · until 6:00\sAM$/)
    expect(carry.textContent).toContain('yesterday\u00a0·\u00a0until')
    const row = carry.closest('li')!
    expect(controls(row)).toHaveLength(0)
    expect(row.querySelector('[data-testid="timeline-start"]')).toBeNull()
  })

  it('puts one circle on a finished block and nothing else: no chips, no sub-labels, no emoji mark', async () => {
    const host = await render()
    const row = rowOf(host, 'Deep work')
    expect(controls(row)).toHaveLength(1)
    expect(controls(host)).toHaveLength(1)
    expect(row.querySelector('[role="group"], .choices, .choice')).toBeNull()
    expect(row.querySelector('[data-testid="category-mark"], [data-testid="timeline-category"]')).toBeNull()
    expect(row.querySelector('.row-kind')).toBeNull()
    expect(row.textContent).not.toContain('Work')
    expect(row.querySelector('li > .row-control, .row-control')).not.toBeNull()
  })

  it('does not ask about the block the Now card asks about', async () => {
    const delegated = await render({ currentKey: deepWorkKey })
    expect(controls(delegated)).toHaveLength(0)
  })

  it('does not ask about blocks that started before the plan existed, or that have not started', async () => {
    const late = await render({ planSince: Date.parse('2026-10-21T14:00:00Z') })
    expect(controls(late)).toHaveLength(0)
    unmount()
    const early = await render({ now: new Date('2026-10-21T08:00:00Z') })
    expect(controls(early)).toHaveLength(0)
  })

  it('stays quiet until the last ten minutes of a block, and asks from then on', async () => {
    const midBlock = await render({ now: new Date('2026-10-21T10:15:00Z') })
    expect(controls(midBlock)).toHaveLength(0)
    unmount()
    const lastMinutes = await render({ now: new Date('2026-10-21T10:50:00Z') })
    expect(controls(lastMinutes)).toHaveLength(1)
  })

  it('keeps the answer on a row that was answered before it ended', async () => {
    const answered = structuredClone(document)
    const [occurrence] = datedOccurrences(answered, TODAY, 1, 'UTC').filter((item) => item.title === 'Deep work')
    recordActual(answered, occurrence!, 'skipped')
    const host = await render({ now: new Date('2026-10-21T10:15:00Z'), actuals: answered.actuals })
    expect(controls(host).map((control) => control.getAttribute('data-status'))).toEqual(['skipped'])
  })

  it('emits the answers of a block row, and clears one that is already done', async () => {
    const onRecord = vi.fn()
    const onClear = vi.fn()
    const host = await render({ onRecord, onClear })
    controls(host)[0]!.click()
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep' }), 'done', undefined)
    unmount()
    const answered = structuredClone(document)
    recordActual(answered, datedOccurrences(answered, TODAY, 1, 'UTC').find((item) => item.title === 'Deep work')!, 'done')
    const again = await render({ onRecord, onClear, actuals: answered.actuals })
    controls(again)[0]!.click()
    expect(onClear).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep' }))
  })

  it('completes a task in one tap from the same circle', async () => {
    const onCompleteTask = vi.fn()
    const host = await render({ items: [task], onCompleteTask })
    const check = controls(host)[0]!
    expect(check.getAttribute('aria-label')).toBe('Mark Write report as done')
    expect(check.hasAttribute('aria-haspopup')).toBe(false)
    check.click()
    expect(onCompleteTask).toHaveBeenCalledWith('t', 'Write report')
  })

  it('reads a task or an event as one before its title for assistive technology, without a visible sub-label', async () => {
    const event = { kind: 'event' as const, key: 'event:e', title: 'Dentist', start: '2026-10-21T15:00:00.000Z', end: '2026-10-21T16:00:00.000Z', overlapsWith: [] }
    const host = await render({ items: [task, event] })
    expect(rowOf(host, 'Write report').querySelector('.visually-hidden')?.textContent).toBe('Task: ')
    expect(rowOf(host, 'Dentist').querySelector('.visually-hidden')?.textContent).toBe('Event: ')
    expect(host.querySelector('.row-kind')).toBeNull()
  })

  it('shows midnight where an item began before the day, and only the start where it runs past the end of the day', async () => {
    const host = await render({ items: [...items, {
      kind: 'event' as const, key: 'event:late', title: 'Night shift', start: '2026-10-20T22:00:00.000Z', end: '2026-10-21T01:00:00.000Z', overlapsWith: [],
    }] })
    const times = (title: string) => {
      const row = rowOf(host, title)
      return [row.querySelector('[data-testid="timeline-start"]')?.textContent, row.querySelector('[data-testid="timeline-end"]')?.textContent ?? null]
    }
    expect(times('Night shift')).toEqual(['12:00\u00a0AM', '1:00\u00a0AM'])
    // Tonight's Sleep: "10:00 PM", then its own line "Until 6:00 AM" — never "12:00 AM" as an end.
    expect(times('Sleep')).toEqual(['10:00\u00a0PM', null])
    expect(rowOf(host, 'Sleep').querySelector('[data-testid="timeline-span-hint"]')?.textContent?.replace(/\s/g, ' ')).toBe('Until 6:00 AM')
  })

  it('says what an item overlaps with, as plain information and never as an alarm', async () => {
    const overlapping = { ...items.find((item) => item.title === 'Deep work')!, overlapsWith: ['Dentist', 'Standup'] }
    const host = await render({ items: [overlapping] })
    const note = host.querySelector('[data-testid="timeline-overlap"]')!
    expect(note.textContent).toBe('Overlaps with Dentist and Standup')
    expect(note.className).toContain('t-secondary')
    expect(host.querySelector('[data-testid="conflict-mark"], .badge.is-conflict, svg')).toBeNull()
    unmount()
    expect((await render()).querySelector('[data-testid="timeline-overlap"]')).toBeNull()
  })

  it('dims what is over and locks the circles while the plan is read-only', async () => {
    const host = await render({ items: [...items, task], writable: false })
    const past = [...host.querySelectorAll('[data-testid="timeline-item"].is-past')].map((row) => row.querySelector('.row-title-text')?.textContent ?? 'carry-over')
    // Last night's Sleep and the finished Deep work are over; tonight's Sleep and the 13:00 task are not.
    expect(past).toEqual(['carry-over', 'Deep work'])
    expect(controls(host).length).toBeGreaterThan(0)
    expect(controls(host).every((control) => control.disabled)).toBe(true)
  })

  it('titles the list "Your day"', async () => {
    const host = await render()
    expect(host.querySelector('.section-title')?.textContent).toBe('Your day')
  })
})
