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
  it('clears an existing Partial actual when Partial is tapped again', async () => {
    const document = plannerDocument({ blocks: [deepWork] })
    const [occurrence] = datedOccurrences(document, '2026-10-21', 1, 'UTC')
    recordActual(document, occurrence!, 'partial', 30)
    const { items, allDay } = buildTimeline({ document, today: '2026-10-21', timeZone: 'UTC', external: [], placements: [] })
    const onClear = vi.fn()
    const onRecord = vi.fn()
    const mounted = await mountForTest(TodayTimeline, {
      items, allDay, actuals: document.actuals, categories: document.categories,
      now: new Date('2026-10-21T10:15:00Z'), timeZone: 'UTC', writable: true, onClear, onRecord,
    })
    unmount = mounted.unmount
    const partial = [...mounted.host.querySelectorAll<HTMLButtonElement>('.actual-choice')].find((button) => button.classList.contains('is-partial'))!
    expect(partial.getAttribute('aria-pressed')).toBe('true')
    partial.click()
    await nextTick()
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onRecord).not.toHaveBeenCalled()
    expect(mounted.host.querySelector('.partial')).toBeNull()
  })
})
