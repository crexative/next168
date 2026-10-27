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
  // Beside the routine, never over its title (docs/design/visual-design.md › Week items).
  expect([overlay.style.insetInlineStart, overlay.style.width]).toEqual(['calc(50% + 2px)', 'calc(50% - 4px)'])
  overlay.click()
  expect(inspected).toEqual([{ key: `s/e/@${date}`, title: 'Team sync with the vendor', date, range: '9:30\u00a0AM\u00a0–\u00a010:30\u00a0AM', calendar: 'Work calendar', conflictsWith: [{ blockId: deepWork.id, title: deepWork.title }] }])
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
  const emitted = { select: [] as string[], taskSelect: [] as string[], create: [] as number[], inspect: [] as unknown[] }
  app = createApp(DayColumn, {
    ...props,
    onInspect: (details: unknown) => emitted.inspect.push(details),
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
const click = (root: HTMLElement, y: number, x = 100) => root.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))

// What a box shows is decided by dayColumnPlan.ts (unit tested there across sizes); before a page has measured the
// column, every word is drawn, and the column asks the visual-integrity guard to hold its text whole.
it('draws every word of an unmeasured column and marks the column for the whole-text guard', () => {
  const { root } = column({ tasks: [taskAt(540, 600)] })
  expect(root.hasAttribute('data-whole-text')).toBe(true)
  const deep = root.querySelector('.block[data-block-id="deep"]')!
  expect(['.block-title', '.block-time', '.block-category'].map((selector) => deep.querySelector(selector)?.textContent?.trim())).toEqual(['Deep work', '9:00\u00a0AM\u00a0–\u00a011:00\u00a0AM', 'Work'])
  expect(root.querySelector('[data-testid="week-task"] .task-title')?.textContent).toBe('Report')
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

// The 44 px areas around short items need a measured column (hitAreas.spec.ts, e2e/week-ux.spec.ts and the visual
// integrity guard's hit-target rule); without layout a press on empty time starts a block.
it('creates a block from a press on empty time', () => {
  const { root, emitted } = column()
  click(root, 600 + 14)
  expect(emitted.create).toEqual([750])
})

it('draws back-to-back tasks under the routine title in disjoint boxes (#3 review)', () => {
  const { root } = column({ tasks: [taskAt(540, 560), { ...taskAt(560, 580), taskId: 't2' }] })
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.task-chunk')).map((chunk) => ({ top: Number.parseFloat(chunk.style.top), height: Number.parseFloat(chunk.style.height) }))
  expect(boxes).toHaveLength(2)
  expect(boxes[1]!.top).toBeGreaterThanOrEqual(boxes[0]!.top + boxes[0]!.height)
})

it('opens the routine from its own area, even inside the expanded target of a short task it holds', () => {
  const { root, emitted } = column({ tasks: [taskAt(600, 615)] })
  const routine = root.querySelector<HTMLElement>('[data-block-id=deep] .block-title')!
  // Task is drawn at y 480–492. Its expanded target ends at 508, over the routine: the routine's area opens the routine;
  // the task opens from its own box (its button handles that press itself).
  routine.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 100, clientY: 507 }))
  expect(emitted.taskSelect).toEqual([])
  expect(emitted.select).toEqual(['deep'])
  emitted.select.length = 0
  routine.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 100, clientY: 520 }))
  expect(emitted.select).toEqual(['deep'])
  expect(emitted.create).toEqual([])
})

it('keeps keyboard routine activation explicit even when its center holds a task', () => {
  const { root, emitted } = column({ tasks: [taskAt(600, 615)] })
  root.querySelector<HTMLButtonElement>('[data-block-id=deep]')!.click()
  expect(emitted.select).toEqual(['deep'])
  expect(emitted.taskSelect).toEqual([])
})


it('keeps an explicitly clicked calendar event selected over a task hit target', () => {
  const busy = busySegmentsByDate([
    { sourceId: 'calendar', uid: 'event', title: 'Call', start: `${DATE}T10:00:00Z`, end: `${DATE}T10:30:00Z`, allDay: false, busy: true },
  ], [], [DATE], 'UTC')[DATE]!
  const { root, emitted } = column({ tasks: [taskAt(600, 615)], busy })
  root.querySelector<HTMLElement>('.busy-title')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 100, clientY: 490 }))
  expect(emitted.inspect).toHaveLength(1)
  expect(emitted.select).toEqual([])
  expect(emitted.taskSelect).toEqual([])
  expect(emitted.create).toEqual([])
})

// verify6 D7: an own event's place and notes reach its details sheet.
it('passes an event\'s location and notes to its details', () => {
  const busy = busySegmentsByDate([], [
    { id: 'e-3', title: 'Cita médica', start: `${DATE}T18:00:00Z`, end: `${DATE}T19:00:00Z`, allDay: false, location: 'Consultorio 3', notes: 'En ayunas', attendees: [] },
  ], [DATE], 'UTC')[DATE]!
  const { root, emitted } = column({ busy })
  root.querySelector<HTMLElement>('.busy')!.click()
  expect(emitted.inspect).toMatchObject([{ title: 'Cita médica', location: 'Consultorio 3', notes: 'En ayunas' }])
})
