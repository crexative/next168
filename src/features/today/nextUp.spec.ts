import { describe, expect, it } from 'vitest'
import { nextUp, upcomingItems, type UpcomingItem } from './nextUp'
import { plannerDocument, sleep } from '@/features/week/testDocument'
import { at, block, event } from './timelineFixtures'

const today = '2026-11-06'
const upcoming = (...items: ReturnType<typeof block>[]): UpcomingItem[] => items

function next(now: string, primaryEnd: string | undefined, items: UpcomingItem[], continues = false) {
  return nextUp({ primaryEnd: primaryEnd ? at(primaryEnd).toISOString() : undefined, continues, upcoming: items, now: at(now), today, timeZone: 'UTC' })
}

describe('nextUp', () => {
  it('names an event starting while the current item is still under way (check 18)', () => {
    const items = upcoming(block('work', '09:00', '17:00'), event('lunch', '12:30', '13:00', 'Lunch'), block('commute', '17:00', '17:30', 'Commute'))
    expect(next('12:10', '17:00', items)).toMatchObject({ kind: 'item', title: 'Lunch' })
  })

  it('names the free time after the current item when nothing starts right after it', () => {
    const result = next('19:19', '20:00', upcoming(block('project', '19:00', '20:00'), block('sleep', '23:00', '23:59', 'Sleep')))
    expect(result).toEqual({ kind: 'free', start: at('20:00').toISOString(), until: at('23:00').toISOString() })
  })

  it('names no free time when another item still spans the end of the current one', () => {
    expect(next('18:10', '18:30', upcoming(block('exercise', '18:00', '19:00'), block('project', '19:00', '20:00', 'Project')), true))
      .toMatchObject({ kind: 'item', title: 'Project' })
  })

  it('with nothing current, is simply the next item of any kind', () => {
    expect(next('07:40', undefined, upcoming(block('commute', '08:30', '09:00', 'Commute')))).toMatchObject({ kind: 'item', title: 'Commute' })
  })

  it('names tomorrow\'s item instead of free time when the gap would cross midnight', () => {
    const tomorrow = { key: 'block:x@t', title: 'Commute', start: '2026-11-07T08:30:00.000Z' }
    expect(next('23:30', '23:59', [tomorrow])).toMatchObject({ kind: 'item', title: 'Commute' })
  })

  it('is empty when nothing is left', () => {
    expect(next('10:00', undefined, [])).toBeNull()
  })

  it('upcomingItems adds the coming days\' routine blocks once, without repeating today\'s', () => {
    const document = plannerDocument({ blocks: [sleep] })
    const todaySleep = block('sleep', '22:00', '23:59', 'Sleep')
    const items = upcomingItems(document, today, 'UTC', [todaySleep])
    expect(items.filter((item) => item.start.startsWith('2026-11-07')).length).toBeGreaterThan(0)
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length)
  })
})
