import { describe, expect, it } from 'vitest'
import { LONG_EVENT_HOURS, nowContext, selectNow } from './nowSelection'
import { at, block, event, task } from './timelineFixtures'

const work = block('work', '09:00', '17:00', 'Work')

describe('selectNow priority (docs/design/today-screen.md §5.1)', () => {
  it('picks nothing when no item spans now, and treats the end as exclusive', () => {
    expect(selectNow([work], at('08:59')).primary).toBeNull()
    expect(selectNow([work], at('17:00')).primary).toBeNull()
    expect(selectNow([work], at('09:00')).primary?.title).toBe('Work')
  })

  it('puts a task chunk spanning now before its routine, which becomes the context (kept floating chunk, check 24)', () => {
    const chunk = task('call', '09:50', '10:40', 'Call')
    const selection = selectNow([work, chunk], at('10:10'))
    expect(selection.primary?.title).toBe('Call')
    expect(nowContext(selection)).toMatchObject({ kind: 'taskContext', title: 'Work', more: 0 })
  })

  it('puts an event of up to four hours before a task and a routine, and names the routine as the context', () => {
    const meeting = event('meeting', '17:30', '21:30', 'Meeting')
    expect(selectNow([block('late', '17:00', '23:00', 'Late'), meeting, task('t', '17:30', '18:00')], at('17:40')).primary?.title).toBe('Meeting')
    const selection = selectNow([block('late', '17:00', '23:00', 'Late'), meeting], at('17:40'))
    expect(nowContext(selection)).toMatchObject({ kind: 'routineContext', title: 'Late' })
  })

  it(`keeps an event longer than ${LONG_EVENT_HOURS} h behind the task or routine, and shows it as the context`, () => {
    const trip = event('trip', '06:00', '21:00', 'Trip')
    const selection = selectNow([work, trip], at('11:00'))
    expect(selection.primary?.title).toBe('Work')
    expect(nowContext(selection)).toMatchObject({ kind: 'alsoNow', title: 'Trip', end: trip.end })
    expect(selectNow([work, trip, task('t', '10:00', '12:00', 'Task')], at('11:00')).primary?.title).toBe('Task')
  })

  it('treats exactly four hours as short and one minute more as long', () => {
    expect(selectNow([work, event('a', '10:00', '14:00', 'Four hours')], at('11:00')).primary?.title).toBe('Four hours')
    expect(selectNow([work, event('b', '10:00', '14:01', 'Over four')], at('11:00')).primary?.title).toBe('Work')
  })

  it('makes a long event the primary item when nothing else spans now', () => {
    expect(selectNow([work, event('trip', '06:00', '21:00', 'Trip')], at('20:00')).primary?.title).toBe('Trip')
  })

  it('names the event, not the routine, as the runner-up when both a long event and a routine are underneath', () => {
    const selection = selectNow([work, event('trip', '06:00', '21:00', 'Trip'), block('gym', '17:00', '19:00', 'Gym'), event('call', '17:30', '18:30', 'Call')], at('17:40'))
    expect(selection.primary?.title).toBe('Call')
    expect(nowContext(selection)).toMatchObject({ kind: 'alsoNow', title: 'Trip', more: 1 })
  })

  describe('ties inside one rank', () => {
    it('the shorter item wins and the longer one is the context, whatever the order of the keys', () => {
      const long = event('a-long', '17:30', '18:30', 'One hour')
      const short = event('z-short', '17:30', '18:00', 'Half hour')
      for (const items of [[long, short], [short, long]]) {
        const selection = selectNow(items, at('17:40'))
        expect(selection.primary?.title).toBe('Half hour')
        expect(nowContext(selection)).toMatchObject({ kind: 'alsoNow', title: 'One hour', end: long.end })
      }
    })

    it('equal lengths: the later start wins, then the stable key order', () => {
      expect(selectNow([event('early', '17:00', '18:00', 'Early'), event('late', '17:15', '18:15', 'Late')], at('17:40')).primary?.title).toBe('Late')
      expect(selectNow([event('b', '17:00', '18:00', 'B'), event('a', '17:00', '18:00', 'A')], at('17:40')).primary?.title).toBe('A')
      expect(selectNow([event('a', '17:00', '18:00', 'A'), event('b', '17:00', '18:00', 'B')], at('17:40')).primary?.title).toBe('A')
    })

    it('counts the rest after the runner-up', () => {
      const selection = selectNow([event('a', '17:00', '18:00'), event('b', '17:00', '18:10'), event('c', '17:00', '18:20'), event('d', '17:00', '18:30')], at('17:40'))
      expect(nowContext(selection)).toMatchObject({ title: 'b', more: 2 })
    })
  })

  it('has no context when only one item spans now', () => {
    expect(nowContext(selectNow([work], at('10:00')))).toBeNull()
  })

  it('two routine blocks at the same time read as also now, not as a task context', () => {
    const selection = selectNow([work, block('other', '10:00', '12:00', 'Other')], at('10:30'))
    expect(selection.primary?.title).toBe('Other')
    expect(nowContext(selection)).toMatchObject({ kind: 'alsoNow', title: 'Work' })
  })
})
