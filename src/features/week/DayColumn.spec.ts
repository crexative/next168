import { afterEach, expect, it } from 'vitest'
import { createApp, type App } from 'vue'
import { i18n } from '@/i18n'
import DayColumn from './DayColumn.vue'
import { blockSegmentsByDate, busySegmentsByDate } from './weekLayout'
import { deepWork, plannerDocument } from './testDocument'

let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove() })

it('renders shared lanes for staggered blocks and an event without shrinking individual blocks', () => {
  const date = '2026-10-21'
  const document = plannerDocument({ blocks: [deepWork, { ...deepWork, id: 'later', start: 600, end: 720 }] })
  const segments = blockSegmentsByDate(document, [date], 'UTC')[date]!
  const busy = busySegmentsByDate([
    { sourceId: 's', uid: 'e', title: 'Event', start: `${date}T11:00:00Z`, end: `${date}T12:00:00Z`, allDay: false, busy: true },
  ], [], [date], 'UTC')[date]!
  host = window.document.createElement('div')
  window.document.body.append(host)
  app = createApp(DayColumn, { date, label: date, segments, busy, categories: document.categories, timeZone: 'UTC', nowMinute: null, editable: true }).use(i18n)
  app.mount(host)

  const blocks = [...host.querySelectorAll<HTMLElement>('.block')]
  expect(blocks.map((node) => [node.style.insetInlineStart, node.style.width])).toEqual([
    ['calc(0% + 2px)', 'calc(50% - 4px)'],
    ['calc(50% + 2px)', 'calc(50% - 4px)'],
  ])
  const overlay = host.querySelector<HTMLElement>('.busy')!
  expect([overlay.style.insetInlineStart, overlay.style.width]).toEqual(['calc(0% + 2px)', 'calc(50% - 4px)'])
  expect(overlay.querySelector('[data-testid="calendar-conflict"]')).not.toBeNull()
})

it('opens the event details with the full title, range, calendar and the block it conflicts with', () => {
  const date = '2026-10-21'
  const document = plannerDocument({ blocks: [{ ...deepWork, days: [3] }] })
  const segments = blockSegmentsByDate(document, [date], 'UTC')[date]!
  const busy = busySegmentsByDate([
    { sourceId: 's', uid: 'e', title: 'Team sync with the vendor', start: `${date}T09:30:00Z`, end: `${date}T10:30:00Z`, allDay: false, busy: true },
  ], [], [date], 'UTC', new Map([['s', 'Work calendar']]))[date]!
  const inspected: unknown[] = []
  host = window.document.createElement('div')
  window.document.body.append(host)
  app = createApp(DayColumn, { date, label: date, segments, busy, categories: document.categories, timeZone: 'UTC', nowMinute: null, editable: true, onInspect: (details: unknown) => inspected.push(details) }).use(i18n)
  app.mount(host)

  const overlay = host.querySelector<HTMLButtonElement>('button.busy')!
  expect(overlay.style.getPropertyValue('--stack-left')).toBe('28%')
  expect(overlay.style.getPropertyValue('--stack-width')).toBe('72%')
  overlay.click()
  expect(inspected).toEqual([{ title: 'Team sync with the vendor', date, range: '9:30 AM – 10:30 AM', calendar: 'Work calendar', conflictsWith: [{ blockId: deepWork.id, title: deepWork.title }] }])
})

const DATE = '2026-10-21'
const column = (overrides: Record<string, unknown> = {}) => {
  const document = plannerDocument({ blocks: [{ ...deepWork, days: [3] }, { id: 'gym-block', categoryId: 'gym', title: 'Gym', days: [3], start: 720, end: 750 }] })
  const props = {
    date: DATE, label: DATE, segments: blockSegmentsByDate(document, [DATE], 'UTC')[DATE]!, busy: [], categories: document.categories,
    timeZone: 'UTC', nowMinute: null, editable: true, ...overrides,
  }
  host = window.document.createElement('div')
  window.document.body.append(host)
  const emitted = { select: [] as string[], taskSelect: [] as string[], create: [] as number[] }
  app = createApp(DayColumn, {
    ...props,
    onSelect: (id: string) => emitted.select.push(id),
    'onSelect-task': (id: string) => emitted.taskSelect.push(id),
    onCreate: (_date: string, minute: number) => emitted.create.push(minute),
  }).use(i18n)
  app.mount(host)
  const root = host.querySelector<HTMLElement>('.day-column')!
  root.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 1152, right: 200, bottom: 1152, x: 0, y: 0, toJSON: () => ({}) })
  return { root, emitted }
}
const taskAt = (startMinute: number, endMinute: number, change: { categoryId?: string } = { categoryId: 'work' }) => ({
  key: `t@${startMinute}`, taskId: 't', title: 'Report', categoryId: change.categoryId, late: false, date: DATE, startMinute, endMinute, continuesBefore: false, continuesAfter: false,
})
const anyTime = {}
const click = (root: HTMLElement, y: number, x = 100) => root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))

it('hides the block time range when a task starts in its first half hour, and keeps it otherwise', () => {
  const early = column({ tasks: [taskAt(540, 600)] })
  expect(early.root.querySelector('.block[data-block-id="deep"]')!.classList.contains('is-crowded')).toBe(true)
  app!.unmount(); host!.remove()
  const later = column({ tasks: [taskAt(600, 660)] })
  expect(later.root.querySelector('.block[data-block-id="deep"]')!.classList.contains('is-crowded')).toBe(false)
  app!.unmount(); host!.remove()
  const none = column({ tasks: [taskAt(540, 600, anyTime)] })
  // A task with no category has no block around it, so no block loses its time.
  expect(none.root.querySelector('.block[data-block-id="deep"]')!.classList.contains('is-crowded')).toBe(false)
})

it('marks a done block as done (dimmed with a check) and only a skipped one as struck through', () => {
  const actual = (blockId: string, status: 'done' | 'skipped' | 'partial') => ({
    date: DATE, blockId, categoryId: blockId === 'deep' ? 'work' : 'gym', plannedStartAt: blockId === 'deep' ? `${DATE}T09:00:00.000Z` : `${DATE}T12:00:00.000Z`,
    plannedEndAt: blockId === 'deep' ? `${DATE}T11:00:00.000Z` : `${DATE}T12:30:00.000Z`, plannedMinutes: 60, status,
  })
  const { root } = column({ actuals: [actual('deep', 'done'), actual('gym-block', 'skipped')] })
  const deep = root.querySelector('.block[data-block-id="deep"]')!
  const gym = root.querySelector('.block[data-block-id="gym-block"]')!
  expect([deep.classList.contains('is-done'), deep.classList.contains('is-skipped')]).toEqual([true, false])
  expect([gym.classList.contains('is-done'), gym.classList.contains('is-skipped')]).toEqual([false, true])
  expect(deep.querySelector('[data-testid="block-status"]')).not.toBeNull()
})

it('draws a task as a button that opens it, and as a disabled one when nothing can be edited', () => {
  const editable = column({ tasks: [taskAt(540, 600)] })
  const chunk = editable.root.querySelector<HTMLButtonElement>('button[data-testid="week-task"]')!
  chunk.click()
  expect(editable.emitted.taskSelect).toEqual(['t'])
  app!.unmount(); host!.remove()
  const locked = column({ tasks: [taskAt(540, 600)], editable: false })
  expect(locked.root.querySelector<HTMLButtonElement>('[data-testid="week-task"]')!.disabled).toBe(true)
})

it('opens a short block from just outside it (44 px target) and creates a block anywhere farther away', () => {
  // Gym is 12:00-12:30 at 48 px per hour: 24 px tall, drawn from y = 576 to 600; its target reaches 10 px each way.
  const { root, emitted } = column()
  click(root, 600 + 9)
  click(root, 576 - 9)
  expect(emitted.select).toEqual(['gym-block', 'gym-block'])
  expect(emitted.create).toEqual([])
  click(root, 600 + 14)
  expect(emitted.select).toHaveLength(2)
  expect(emitted.create).toEqual([750])
})

it('opens a task from just outside it, ahead of the block it sits in', () => {
  const { root, emitted } = column({ tasks: [taskAt(780, 795, anyTime)] })
  // 13:00-13:15 is 12 px tall (y 624-636), in the open: a tap 15 px below it still means the task.
  click(root, 636 + 15)
  expect(emitted.taskSelect).toEqual(['t'])
})
