// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PlannerDocument, Task, TaskPlacement } from './model'
import { fitTasks } from './scheduling'

// A category is a preference, not a wall, when the deadline is at stake (docs/architecture/deliverable-1.md, Task
// fitting). The owner's case: Sunday 25 Oct in Bogotá, "Trotar" filed under Trabajo (Monday to Friday 8:00-17:00)
// and due that Sunday, was put on Monday 8:00 with "after its due date" and no way out.
const ZONE = 'America/Bogota'
const WEEKDAYS = [1, 2, 3, 4, 5]
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

function planner(task: Partial<Task>, blocks: PlannerDocument['blocks'] = [
  { id: 'b-work', categoryId: 'work', title: 'Trabajo', days: WEEKDAYS, start: 480, end: 1020 },
  { id: 'b-sleep', categoryId: 'sleep', title: 'Dormir', days: EVERY_DAY, start: 1320, end: 360 },
]): PlannerDocument {
  return {
    schemaVersion: 3, generation: 0, workspaceId: 'w', revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone: ZONE, onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } },
      { id: 'sleep', name: 'Sueño', icon: '😴', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } },
    ],
    blocks,
    tasks: [{ id: 'jog', title: 'Trotar', categoryId: 'work', durationMin: 60, priority: 2, createdAt: '2026-10-25T14:00:00.000Z', ...task }],
    checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
  }
}

// Wall-clock time in Bogotá (UTC-5, no daylight saving).
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`)
const iso = (date: string, time: string) => bogota(date, time).toISOString()
const fit = (document: PlannerDocument, now: Date, previous?: Map<string, TaskPlacement>) =>
  fitTasks({ document, busy: [], now, timeZone: ZONE, previous })[0]!

describe('a task whose category cannot hold it before its due date goes to free time', () => {
  it("places the owner's Sunday jog today in free time, not on Monday after its due date", () => {
    const placement = fit(planner({ dueDate: '2026-10-25' }), bogota('2026-10-25', '10:00'))
    expect(placement.chunks).toEqual([{ start: iso('2026-10-25', '10:00'), end: iso('2026-10-25', '11:00') }])
    expect(placement).toMatchObject({ late: false, overflowMinutes: 0, outsideCategory: true })
  })

  it('never places it in the past: it starts at the next five minutes after now', () => {
    const placement = fit(planner({ dueDate: '2026-10-25' }), bogota('2026-10-25', '16:07'))
    expect(placement.chunks[0]).toEqual({ start: iso('2026-10-25', '16:10'), end: iso('2026-10-25', '17:10') })
  })

  it('keeps the category when its blocks hold the task before a deadline of tomorrow', () => {
    const placement = fit(planner({ dueDate: '2026-10-26' }), bogota('2026-10-25', '10:00'))
    expect(placement.chunks).toEqual([{ start: iso('2026-10-26', '08:00'), end: iso('2026-10-26', '09:00') }])
    expect(placement.late).toBe(false)
    expect(placement).not.toHaveProperty('outsideCategory')
  })

  it('uses the planner time zone: 23:30 on Sunday in Bogotá is still the due day, although UTC is Monday', () => {
    const document = planner({ dueDate: '2026-10-25', durationMin: 30 }, [{ id: 'b-work', categoryId: 'work', title: 'Trabajo', days: WEEKDAYS, start: 480, end: 1020 }])
    const placement = fit(document, new Date('2026-10-26T04:30:00Z'))
    expect(placement.chunks).toEqual([{ start: '2026-10-26T04:30:00.000Z', end: '2026-10-26T05:00:00.000Z' }])
    expect(placement).toMatchObject({ late: false, outsideCategory: true })
  })

  it('works on a planner with no blocks at all', () => {
    const placement = fit(planner({ dueDate: '2026-10-25' }, []), bogota('2026-10-25', '10:00'))
    expect(placement.chunks).toEqual([{ start: iso('2026-10-25', '10:00'), end: iso('2026-10-25', '11:00') }])
    expect(placement).toMatchObject({ late: false, outsideCategory: true })
  })

  it('splits a task longer than the free time left today and still says it lands late', () => {
    // 21:30: half an hour before sleep, then the free morning on Monday before work.
    const placement = fit(planner({ dueDate: '2026-10-25' }), bogota('2026-10-25', '21:30'))
    expect(placement.chunks).toEqual([
      { start: iso('2026-10-25', '21:30'), end: iso('2026-10-25', '22:00') },
      { start: iso('2026-10-26', '06:00'), end: iso('2026-10-26', '06:30') },
    ])
    expect(placement).toMatchObject({ late: true, outsideCategory: true })
  })

  it('leaves the category placement, late, when there is no free time at all before the deadline', () => {
    const document = planner({ dueDate: '2026-10-25' })
    document.events.push({ id: 'e', title: 'Viaje', start: iso('2026-10-25', '09:00'), end: iso('2026-10-25', '22:00'), allDay: false, attendees: [] })
    const placement = fit(document, bogota('2026-10-25', '10:00'))
    expect(placement.chunks).toEqual([{ start: iso('2026-10-26', '08:00'), end: iso('2026-10-26', '09:00') }])
    expect(placement.late).toBe(true)
    expect(placement).not.toHaveProperty('outsideCategory')
  })

  it('keeps an overdue task in its category: no slot can be before a deadline that has passed', () => {
    const placement = fit(planner({ dueDate: '2026-10-24' }), bogota('2026-10-25', '10:00'))
    expect(placement.chunks[0]!.start).toBe(iso('2026-10-26', '08:00'))
    expect(placement.late).toBe(true)
  })

  it('does not move a task with no due date out of its category', () => {
    const placement = fit(planner({}, []), bogota('2026-10-25', '10:00'))
    expect(placement).toMatchObject({ chunks: [], overflowMinutes: 60 })
    expect(placement).not.toHaveProperty('outsideCategory')
  })

  it('keeps a free-time placement while it is under way instead of sliding with the clock', () => {
    const document = planner({ dueDate: '2026-10-25' })
    const first = fit(document, bogota('2026-10-25', '10:00'))
    const later = fit(document, bogota('2026-10-25', '10:20'), new Map([['jog', first]]))
    expect(later).toEqual(first)
  })

  it('fits again a shown placement that now misses a deadline brought forward to today', () => {
    const shown = fit(planner({ dueDate: '2026-10-27' }), bogota('2026-10-25', '10:00'))
    expect(shown.chunks[0]!.start).toBe(iso('2026-10-26', '08:00'))
    const placement = fit(planner({ dueDate: '2026-10-25' }), bogota('2026-10-25', '10:00'), new Map([['jog', shown]]))
    expect(placement.chunks).toEqual([{ start: iso('2026-10-25', '10:00'), end: iso('2026-10-25', '11:00') }])
    expect(placement).toMatchObject({ late: false, outsideCategory: true })
  })
})
