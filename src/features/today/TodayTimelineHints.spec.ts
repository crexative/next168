import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'
import { mountForTest } from '@/features/week/mountForTest'
import TodayTimeline from './TodayTimeline.vue'

let unmount = () => undefined as void
afterEach(() => { unmount(); i18n.global.locale.value = 'en' })

describe('TodayTimeline continuation hints', () => {
  it.each([
    ['2026-10-23T22:00:00Z', '2026-10-24T06:00:00Z', ['Since yesterday']],
    ['2026-10-24T22:00:00Z', '2026-10-25T06:00:00Z', ['Until 6:00 AM']],
    ['2026-10-22T18:00:00Z', '2026-10-27T09:00:00Z', ['Since 22 Thu', 'Until 27 Tue']],
    ['2026-10-24T09:00:00Z', '2026-10-24T18:00:00Z', []],
  ])('renders the hints for %s → %s', async (start, end, expected) => {
    const mounted = await mountForTest(TodayTimeline, {
      items: [{ kind: 'event', key: 'event', title: 'Event', start, end, overlapsWith: [] }],
      allDay: [], actuals: [], categories: [], now: new Date('2026-10-24T12:00:00Z'), timeZone: 'UTC', writable: true,
    })
    unmount = mounted.unmount
    expect([...mounted.host.querySelectorAll('[data-testid="timeline-span-hint"]')].map(node => node.textContent?.replace(/\s/g, ' '))).toEqual(expected)
  })

  it('updates both localized date hints when the language changes', async () => {
    const mounted = await mountForTest(TodayTimeline, {
      items: [{ kind: 'event', key: 'event', title: 'Event', start: '2026-10-22T18:00:00Z', end: '2026-10-27T09:00:00Z', overlapsWith: [] }],
      allDay: [], actuals: [], categories: [], now: new Date('2026-10-24T12:00:00Z'), timeZone: 'UTC', writable: true,
    })
    unmount = mounted.unmount
    i18n.global.locale.value = 'es'
    await nextTick()
    expect([...mounted.host.querySelectorAll('[data-testid="timeline-span-hint"]')].map(node => node.textContent)).toEqual([
      'Desde el jue\u00a022', 'Hasta el mar\u00a027',
    ])
  })
})
