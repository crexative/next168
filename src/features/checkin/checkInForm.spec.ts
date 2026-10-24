import { describe, expect, it } from 'vitest'
import { checkInFromForm, formFromCheckIn, isEmptyCheckIn, minuteToTime, timeToMinute, upsertCheckIn } from './checkInForm'

describe('check-in form conversion', () => {
  it('round-trips times and rejects malformed input', () => {
    expect(minuteToTime(23 * 60 + 5)).toBe('23:05')
    expect(timeToMinute('07:30')).toBe(450)
    expect(timeToMinute('')).toBeUndefined()
    expect(timeToMinute('24:00')).toBeUndefined()
  })

  it('omits unanswered fields', () => {
    const form = formFromCheckIn('2026-10-24', undefined)
    expect(isEmptyCheckIn(checkInFromForm(form))).toBe(true)
    form.bedtime = '23:00'
    form.wake = '07:00'
    form.stress = '4'
    form.note = '  rough day '
    expect(checkInFromForm(form)).toEqual({ date: '2026-10-24', bedtime: 1380, wake: 420, stress: 4, note: 'rough day' })
  })

  it('loads an existing check-in back into the form', () => {
    const form = formFromCheckIn('2026-10-24', { date: '2026-10-24', bedtime: 1380, exercise: 'not-planned', stress: 2 })
    expect(form).toMatchObject({ bedtime: '23:00', wake: '', exercise: 'not-planned', stress: '2' })
  })

  it('replaces the entry for a date and keeps dates sorted', () => {
    const list = upsertCheckIn([{ date: '2026-10-24', stress: 1 }, { date: '2026-10-22', stress: 2 }], { date: '2026-10-24', stress: 5 })
    expect(list).toEqual([{ date: '2026-10-22', stress: 2 }, { date: '2026-10-24', stress: 5 }])
  })
})
