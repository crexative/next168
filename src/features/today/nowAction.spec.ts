import { describe, expect, it } from 'vitest'
import type { BlockActual } from '@/core/model'
import { ENDING_WINDOW_MINUTES } from './statusWindow'
import { nowAction } from './nowAction'
import { selectNow } from './nowSelection'
import { at, block, event, task } from './timelineFixtures'
import type { TimelineItem } from './todayTimeline'

const project = block('project', '19:00', '20:00', 'Project')
const sleep = block('sleep', '23:00', '23:59', 'Sleep')
const SINCE = at('00:00').getTime()

function action(items: TimelineItem[], now: string, overrides: { actuals?: BlockActual[]; closeDayOpen?: boolean; since?: number | undefined } = {}) {
  return nowAction({
    selection: selectNow(items, at(now)), items, actuals: overrides.actuals ?? [], since: 'since' in overrides ? overrides.since : SINCE,
    now: at(now), today: '2026-11-06', timeZone: 'UTC', closeDayOpen: overrides.closeDayOpen ?? false,
  })
}

const answerFor = (item: TimelineItem & { kind: 'block' }, status: BlockActual['status']): BlockActual => ({
  date: '2026-11-06', blockId: item.occurrence.blockId, categoryId: 'work', plannedStartAt: item.start, plannedEndAt: item.end, plannedMinutes: item.occurrence.plannedMinutes, status,
}) as BlockActual

describe('the Now card action', () => {
  it('asks nothing while most of the block is ahead, and from its last ten minutes', () => {
    expect(action([project, sleep], '19:19')).toBeNull()
    expect(action([project, sleep], '19:49')).toBeNull()
    expect(action([project, sleep], '19:50')).toMatchObject({ kind: 'ask', own: true })
  })

  it(`keeps asking for ${ENDING_WINDOW_MINUTES} minutes after the block ended when nothing else is current, then stops`, () => {
    expect(action([project, sleep], '20:15')).toMatchObject({ kind: 'ask', own: false, occurrence: { title: 'Project' } })
    expect(action([project, sleep], '20:29')).toMatchObject({ kind: 'ask' })
    expect(action([project, sleep], '20:30')).toBeNull()
    expect(action([project, sleep], '20:31')).toBeNull()
  })

  it('does not ask about the ended block once it is answered, or when the plan did not exist yet', () => {
    expect(action([project, sleep], '20:15', { actuals: [answerFor(project as never, 'done')] })).toBeNull()
    expect(action([project, sleep], '20:15', { since: at('21:00').getTime() })).toBeNull()
    expect(action([project, sleep], '20:15', { since: undefined })).toBeNull()
  })

  it('does not ask about an ended block while another item is current', () => {
    expect(action([project, block('next', '20:00', '22:00', 'Next')], '20:15')).toBeNull()
  })

  it('keeps showing an answer given mid-block', () => {
    expect(action([project], '19:20', { actuals: [answerFor(project as never, 'partial')] })).toMatchObject({ kind: 'ask', actual: { status: 'partial' } })
  })

  it('still asks about a routine in its last minutes while an event is what the card shows', () => {
    const meeting = event('meeting', '19:30', '20:30', 'Meeting')
    expect(action([project, meeting], '19:55')).toMatchObject({ kind: 'ask', own: false, occurrence: { title: 'Project' } })
    expect(action([project, meeting], '19:40')).toBeNull()
  })

  it('offers completing the task underway before anything else', () => {
    expect(action([block('work', '09:00', '17:00'), task('call', '10:00', '10:45', 'Call')], '10:10')).toEqual({ kind: 'task', taskId: 'call', title: 'Call' })
  })

  it('offers closing the day only when no question applies, and only while it is open', () => {
    expect(action([sleep], '23:30', { closeDayOpen: true })).toEqual({ kind: 'closeDay' })
    expect(action([sleep], '23:30', { closeDayOpen: false })).toBeNull()
    expect(action([project, sleep], '20:15', { closeDayOpen: true })).toMatchObject({ kind: 'ask' })
  })

  it('leaves the slot empty in free time even when the day can be closed (the check-in card carries the way in)', () => {
    expect(action([project, sleep], '21:00', { closeDayOpen: true })).toBeNull()
  })
})
