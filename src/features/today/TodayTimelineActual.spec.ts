import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { datedOccurrences } from '@/core/time'
import { mountForTest } from '@/features/week/mountForTest'
import { deepWork, plannerDocument } from '@/features/week/testDocument'
import TodayTimeline from './TodayTimeline.vue'
import { recordActual } from './actuals'
import { buildTimeline } from './todayTimeline'

let unmount = () => undefined as void
afterEach(() => unmount())

describe('TodayTimeline partial status', () => {
  it('clears nothing and records done when the circle of a Partly answer is tapped', async () => {
    const document = plannerDocument({ blocks: [deepWork] })
    const [occurrence] = datedOccurrences(document, '2026-10-21', 1, 'UTC')
    recordActual(document, occurrence!, 'partial', 30)
    const { items, allDay } = buildTimeline({ document, today: '2026-10-21', timeZone: 'UTC', external: [], placements: [] })
    const onClear = vi.fn()
    const onRecord = vi.fn()
    const mounted = await mountForTest(TodayTimeline, {
      items, allDay, actuals: document.actuals, categories: document.categories,
      now: new Date('2026-10-21T10:15:00Z'), timeZone: 'UTC', writable: true, planSince: Date.parse('2026-10-20T00:00:00Z'), onClear, onRecord,
    })
    unmount = mounted.unmount
    const circle = mounted.host.querySelector<HTMLButtonElement>('[data-testid="status-control"]')!
    expect(circle.getAttribute('data-status')).toBe('partial')
    circle.click()
    await nextTick()
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep' }), 'done', undefined)
    expect(onClear).not.toHaveBeenCalled()
  })

  it('offers to remove a Partly answer from the menu, which emits clear', async () => {
    const document = plannerDocument({ blocks: [deepWork] })
    const [occurrence] = datedOccurrences(document, '2026-10-21', 1, 'UTC')
    recordActual(document, occurrence!, 'partial', 30)
    const { items, allDay } = buildTimeline({ document, today: '2026-10-21', timeZone: 'UTC', external: [], placements: [] })
    const onClear = vi.fn()
    const mounted = await mountForTest(TodayTimeline, {
      items, allDay, actuals: document.actuals, categories: document.categories,
      now: new Date('2026-10-21T10:15:00Z'), timeZone: 'UTC', writable: true, planSince: Date.parse('2026-10-20T00:00:00Z'), onClear,
    })
    unmount = mounted.unmount
    mounted.host.querySelector('[data-testid="status-control"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    mounted.host.querySelector<HTMLButtonElement>('[data-testid="status-clear"]')!.click()
    expect(onClear).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep' }))
  })
})
