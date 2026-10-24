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
