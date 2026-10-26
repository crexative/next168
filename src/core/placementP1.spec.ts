// @vitest-environment node
// Tasks P1 placement (design rev 2.1 §6.1 and P1-2/P1-3, rev 4 §2.7, rev 5 §2.8, rev 6 P1-13): to-dos are never placed,
// a fixed start is one contiguous interval busy for every other task, a flexible task gets at most 180 minutes per local
// date, a shown placement is reused only for the same placement key, and a category with no blocks is a list.
import { describe, expect, it } from 'vitest'
import { parseExportBundle } from './exportBundle'
import { validateDocument } from './documents'
import { MAX_FLEX_MIN_PER_DAY, type PlannerDocument, type Task, type TaskPlacement, type TimeBlock } from './model'
import { fitTasks, placementKey } from './scheduling'
import { addLocalDays, localDateOf, zonedInstant } from './time'

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const MINUTE = 60_000

function planner(tasks: Partial<Task>[], blocks: TimeBlock[] = [], timeZone = 'America/Bogota'): PlannerDocument {
  return {
    schemaVersion: 3, generation: 0, workspaceId: 'w', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone, onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'home', name: 'Casa', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } },
    ],
    blocks,
    tasks: tasks.map((task, index) => ({ id: `t${index}`, title: `Tarea ${index}`, priority: 2, createdAt: '2026-10-20T08:00:00.000Z', ...task })),
    checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
  }
}
const fit = (document: PlannerDocument, now: Date, previous?: Map<string, TaskPlacement>) =>
  fitTasks({ document, busy: [], now, timeZone: document.settings.timeZone, previous })
const one = (placements: TaskPlacement[], id = 't0') => placements.find((placement) => placement.taskId === id)!
const minutesOf = (placement: TaskPlacement) => placement.chunks.reduce((sum, chunk) => sum + (Date.parse(chunk.end) - Date.parse(chunk.start)) / MINUTE, 0)

// Minutes of a placement on each local date, splitting its chunks at local midnight (independent of the scheduler).
function perLocalDate(placement: TaskPlacement, timeZone: string): Map<string, number> {
  const totals = new Map<string, number>()
  for (const chunk of placement.chunks) {
    let start = Date.parse(chunk.start)
    const end = Date.parse(chunk.end)
    while (start < end) {
      const date = localDateOf(new Date(start), timeZone)
      const midnight = zonedInstant(addLocalDays(date, 1), 0, timeZone).getTime()
      const until = Math.min(end, midnight)
      totals.set(date, (totals.get(date) ?? 0) + (until - start) / MINUTE)
      start = until
    }
  }
  return totals
}

describe('to-dos and short tasks', () => {
  it('a task without a duration is never placed and never overflows', () => {
    expect(fit(planner([{ title: 'Llamar a mamá' }]), new Date('2026-10-26T13:00:00Z'))).toEqual([])
  })

  it('GUARD (shipped in dbfffad): a 5-minute task is placed whole', () => {
    const placement = one(fit(planner([{ durationMin: 5 }]), new Date('2026-10-26T13:00:00Z')))
    expect(placement.chunks).toEqual([{ start: '2026-10-26T13:00:00.000Z', end: '2026-10-26T13:05:00.000Z' }])
  })

  it('GUARD: a final remainder under ten minutes is placed', () => {
    const blocks: TimeBlock[] = [
      { id: 'a', categoryId: 'work', title: 'A', days: EVERY_DAY, start: 540, end: 550 },
      { id: 'b', categoryId: 'work', title: 'B', days: EVERY_DAY, start: 600, end: 605 },
    ]
    const placement = one(fit(planner([{ durationMin: 15, categoryId: 'work' }], blocks), new Date('2026-10-26T13:00:00Z')))
    expect(placement.chunks.map((chunk) => (Date.parse(chunk.end) - Date.parse(chunk.start)) / MINUTE)).toEqual([10, 5])
    expect(placement.overflowMinutes).toBe(0)
  })
})

describe('the daily cap of a flexible task', () => {
  it('wide windows (Work 08–20 every day): at most 180 minutes per local date, and the overflow the windows imply', () => {
    const zone = 'America/Bogota'
    const work: TimeBlock = { id: 'w', categoryId: 'work', title: 'Trabajo', days: EVERY_DAY, start: 480, end: 1200 }
    const now = new Date('2026-10-27T00:00:00Z') // Mon 26 Oct, 19:00 in Bogotá: one hour of Work left today
    const placement = one(fit(planner([{ durationMin: 1260, categoryId: 'work' }], [work], zone), now))
    const totals = perLocalDate(placement, zone)
    for (const [date, minutes] of totals) expect([date, minutes <= MAX_FLEX_MIN_PER_DAY]).toEqual([date, true])
    // Independently: each date of the horizon offers min(180, Work minutes after now).
    let offered = 0
    for (let day = 0; day < 7; day++) {
      const date = addLocalDays('2026-10-26', day)
      const start = Math.max(zonedInstant(date, 480, zone).getTime(), now.getTime())
      const end = zonedInstant(date, 1200, zone).getTime()
      offered += Math.min(MAX_FLEX_MIN_PER_DAY, Math.max(0, (end - start) / MINUTE))
    }
    expect(offered).toBe(60 + 6 * 180)
    expect(placement.overflowMinutes).toBe(1260 - offered)
    expect(minutesOf(placement)).toBe(offered)
  })

  it('across midnight and the 2026-10-25 Berlin fold: a chunk runs past midnight, every local date stays at 180 or less', () => {
    const zone = 'Europe/Berlin'
    const now = new Date('2026-10-24T20:00:00Z') // Sat 24 Oct, 22:00 CEST: 120 minutes left today
    const placement = one(fit(planner([{ durationMin: 1260 }], [], zone), now))
    const totals = perLocalDate(placement, zone)
    expect(totals.get('2026-10-24')).toBe(120)
    expect(totals.get('2026-10-25')).toBe(MAX_FLEX_MIN_PER_DAY)
    for (const [date, minutes] of totals) expect([date, minutes <= MAX_FLEX_MIN_PER_DAY]).toEqual([date, true])
    expect(placement.chunks.some((chunk) => localDateOf(chunk.start, zone) !== localDateOf(new Date(Date.parse(chunk.end) - 1), zone))).toBe(true)
    // Independently: 120 minutes on the 24th, then 180 on each of the six following dates of the horizon.
    expect(placement.overflowMinutes).toBe(1260 - (120 + 6 * 180))
  })

  it('greedy, earliest first: 7 days of a 175-minute and a 60-minute window place 1,225 of 1,260 minutes and overflow 35', () => {
    const blocks: TimeBlock[] = [
      { id: 'long', categoryId: 'work', title: 'Largo', days: EVERY_DAY, start: 540, end: 715 },
      { id: 'short', categoryId: 'work', title: 'Corto', days: EVERY_DAY, start: 780, end: 840 },
    ]
    const zone = 'America/Bogota'
    const placement = one(fit(planner([{ durationMin: 1260, categoryId: 'work' }], blocks, zone), new Date('2026-10-26T11:00:00Z')))
    expect(minutesOf(placement)).toBe(1225)
    expect(placement.overflowMinutes).toBe(35)
    expect([...perLocalDate(placement, zone).values()]).toEqual([175, 175, 175, 175, 175, 175, 175])
    // No short piece that is not the last: the 60-minute windows are skipped once 175 minutes are used that day.
    expect(placement.chunks.every((chunk) => (Date.parse(chunk.end) - Date.parse(chunk.start)) / MINUTE === 175)).toBe(true)
  })

  it('a date whose allowance cannot hold a piece is skipped, and the task goes on after midnight in the same free window', () => {
    const document = planner([{ durationMin: 1260 }], [], 'UTC')
    const busy = [{ start: '2026-10-26T00:00:00.000Z', end: '2026-10-26T08:00:00.000Z' }, { start: '2026-10-26T10:55:00.000Z', end: '2026-10-26T12:00:00.000Z' }]
    const placement = one(fitTasks({ document, busy, now: new Date('2026-10-26T00:00:00Z'), timeZone: 'UTC' }))
    // Monday: 175 minutes before the busy hour; the 5 left of its allowance cannot hold a piece, so Monday ends there.
    expect(placement.chunks[0]).toEqual({ start: '2026-10-26T08:00:00.000Z', end: '2026-10-26T10:55:00.000Z' })
    expect(placement.chunks[1]!.start).toBe('2026-10-27T00:00:00.000Z')
    expect(placement.chunks.every((chunk) => (Date.parse(chunk.end) - Date.parse(chunk.start)) / MINUTE >= 10)).toBe(true)
    expect(placement.overflowMinutes).toBe(1260 - (175 + 6 * 180))
  })

  it('a shown placement over the cap is fitted again', () => {
    const document = planner([{ durationMin: 200 }], [], 'UTC')
    const now = new Date('2026-10-26T08:00:00Z')
    const key = placementKey(document.tasks[0]!, 'UTC')
    const shown: TaskPlacement = { taskId: 't0', overflowMinutes: 0, late: false, key, chunks: [{ start: '2026-10-26T10:00:00.000Z', end: '2026-10-26T13:20:00.000Z' }] }
    const placement = one(fit(document, now, new Map([['t0', shown]])))
    expect(placement.chunks).not.toEqual(shown.chunks)
    for (const minutes of perLocalDate(placement, 'UTC').values()) expect(minutes).toBeLessThanOrEqual(MAX_FLEX_MIN_PER_DAY)
  })
})

describe('a one-off fixed start', () => {
  it('02:30 on 2026-03-29 in Berlin (the spring gap) starts at 03:30 and ends an elapsed hour later', () => {
    const document = planner([{ durationMin: 60, dueDate: '2026-03-29', at: 150 }], [], 'Europe/Berlin')
    const placement = one(fit(document, new Date('2026-03-28T12:00:00Z')))
    expect(placement).toMatchObject({ fixed: true, overflowMinutes: 0, chunks: [{ start: '2026-03-29T01:30:00.000Z', end: '2026-03-29T02:30:00.000Z' }] })
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(placement.chunks[0]!.start))).toBe('03:30')
  })

  it('02:30 on 2026-10-25 in Berlin (the autumn fold) takes the earlier instant and keeps its elapsed length', () => {
    const document = planner([{ durationMin: 120, dueDate: '2026-10-25', at: 150 }], [], 'Europe/Berlin')
    const placement = one(fit(document, new Date('2026-10-24T12:00:00Z')))
    expect(placement.chunks).toEqual([{ start: '2026-10-25T00:30:00.000Z', end: '2026-10-25T02:30:00.000Z' }])
  })

  it('600 minutes at 23:00 is one contiguous interval, busy for a flexible task that was shown inside it', () => {
    const document = planner([{ durationMin: 600, dueDate: '2026-10-26', at: 1380 }, { durationMin: 60 }], [], 'America/Bogota')
    const now = new Date('2026-10-26T13:00:00Z')
    const inside: TaskPlacement = { taskId: 't1', overflowMinutes: 0, late: false, key: placementKey(document.tasks[1]!, 'America/Bogota'), chunks: [{ start: '2026-10-27T06:00:00.000Z', end: '2026-10-27T07:00:00.000Z' }] }
    const placements = fit(document, now, new Map([['t1', inside]]))
    const fixed = one(placements, 't0')
    expect(fixed).toMatchObject({ fixed: true, chunks: [{ start: '2026-10-27T04:00:00.000Z', end: '2026-10-27T14:00:00.000Z' }] })
    const flexible = one(placements, 't1')
    for (const chunk of flexible.chunks) expect(Date.parse(chunk.end) <= Date.parse('2026-10-27T04:00:00Z') || Date.parse(chunk.start) >= Date.parse('2026-10-27T14:00:00Z')).toBe(true)
    // With no earlier placement the flexible task never lands inside it either.
    const fresh = one(fit({ ...document, tasks: document.tasks.map((task) => (task.id === 't1' ? { ...task, durationMin: 600 } : task)) }, new Date('2026-10-27T03:30:00Z')), 't1')
    for (const chunk of fresh.chunks) expect(Date.parse(chunk.end) <= Date.parse('2026-10-27T04:00:00Z') || Date.parse(chunk.start) >= Date.parse('2026-10-27T14:00:00Z')).toBe(true)
  })

  it('a fixed start without a duration is a point: no chunk, nothing reserved', () => {
    const placement = one(fit(planner([{ dueDate: '2026-10-27', at: 540 }]), new Date('2026-10-26T13:00:00Z')))
    expect(placement).toMatchObject({ chunks: [], overflowMinutes: 0, at: '2026-10-27T14:00:00.000Z' })
  })
})

describe('the placement key', () => {
  it('a time-zone edit places a fixed task again, and refuses a shown flexible placement made for the old zone', () => {
    const fixedTask = { durationMin: 60, dueDate: '2026-10-27', at: 540 }
    const bogota = fit(planner([fixedTask, { durationMin: 60 }], [], 'America/Bogota'), new Date('2026-10-26T13:00:00Z'))
    const berlinDocument = planner([fixedTask, { durationMin: 60 }], [], 'Europe/Berlin')
    const berlin = fit(berlinDocument, new Date('2026-10-26T13:00:00Z'), new Map(bogota.map((placement) => [placement.taskId, placement])))
    expect(one(bogota, 't0').chunks[0]!.start).toBe('2026-10-27T14:00:00.000Z')
    expect(one(berlin, 't0').chunks[0]!.start).toBe('2026-10-27T08:00:00.000Z')

    // A shown placement at 15:00 is kept while nothing changed, and fitted again (at the first free slot) in another zone.
    const shownIn = (zone: string): TaskPlacement => ({ taskId: 't0', overflowMinutes: 0, late: false, key: placementKey({ durationMin: 60 }, zone), chunks: [{ start: '2026-10-26T15:00:00.000Z', end: '2026-10-26T16:00:00.000Z' }] })
    const now = new Date('2026-10-26T13:00:00Z')
    expect(one(fit(planner([{ durationMin: 60 }], [], 'UTC'), now, new Map([['t0', shownIn('UTC')]]))).chunks[0]!.start).toBe('2026-10-26T15:00:00.000Z')
    expect(one(fit(planner([{ durationMin: 60 }], [], 'UTC'), now, new Map([['t0', shownIn('Europe/Berlin')]]))).chunks[0]!.start).toBe('2026-10-26T13:00:00.000Z')
  })

  it('every placement carries the key of what it was made for', () => {
    const document = planner([{ durationMin: 30, categoryId: 'work', dueDate: '2026-10-28' }], [], 'UTC')
    expect(one(fit(document, new Date('2026-10-26T08:00:00Z'))).key).toBe(placementKey(document.tasks[0]!, 'UTC'))
  })
})

describe('a category with no blocks is a list', () => {
  it('an undated task of a category with no blocks in the horizon goes to free time, with no warning', () => {
    const work: TimeBlock = { id: 'w', categoryId: 'work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 480, end: 1020 }
    const placement = one(fit(planner([{ durationMin: 60, categoryId: 'home' }], [work]), new Date('2026-10-26T11:00:00Z')))
    expect(placement).toMatchObject({ overflowMinutes: 0, late: false, chunks: [{ start: '2026-10-26T11:00:00.000Z', end: '2026-10-26T12:00:00.000Z' }] })
    expect(placement).not.toHaveProperty('outsideCategory')
  })
})

describe('a fixed start is validated at every entry', () => {
  const document = (task: Partial<Task>) => planner([{ title: 'Dentista', ...task }], [], 'UTC')
  const bundle = (task: Partial<Task>) => JSON.stringify({ format: 'next168-export', bundleVersion: 1, exportedAt: '2026-10-26T08:00:00.000Z', document: document(task), calendarSourceTexts: {} })

  it('needs a due date', () => {
    expect(() => validateDocument(document({ at: 540 }))).toThrow('task.atNeedsDueDate')
    expect(parseExportBundle(bundle({ at: 540 }))).toMatchObject({ kind: 'corrupt', reason: 'task.atNeedsDueDate' })
  })

  it('holds at most 720 minutes', () => {
    expect(() => validateDocument(document({ at: 540, dueDate: '2026-10-27', durationMin: 721 }))).toThrow('task.fixedTooLong')
    expect(parseExportBundle(bundle({ at: 540, dueDate: '2026-10-27', durationMin: 721 }))).toMatchObject({ kind: 'corrupt', reason: 'task.fixedTooLong' })
    expect(validateDocument(document({ at: 540, dueDate: '2026-10-27', durationMin: 720 })).tasks[0]!.durationMin).toBe(720)
  })
})
