import { describe, expect, it } from 'vitest'
import { placementClock } from './placementClock'

const iso = (value: string) => placementClock(new Date(value)).toISOString()

describe('placementClock', () => {
  it('rounds up to the next five minutes', () => {
    expect(iso('2026-10-24T12:31:00Z')).toBe('2026-10-24T12:35:00.000Z')
    expect(iso('2026-10-24T12:30:00.001Z')).toBe('2026-10-24T12:35:00.000Z')
    expect(iso('2026-10-24T12:34:59.999Z')).toBe('2026-10-24T12:35:00.000Z')
  })

  it('keeps an instant that is already on a step', () => {
    expect(iso('2026-10-24T12:30:00.000Z')).toBe('2026-10-24T12:30:00.000Z')
  })

  it('rolls over the hour, the day and the DST change without drifting', () => {
    expect(iso('2026-10-24T23:58:10Z')).toBe('2026-10-25T00:00:00.000Z')
    // New York falls back at 06:00Z on 2026-11-01: the step is real elapsed time, so the hour repeats cleanly.
    expect(iso('2026-11-01T05:59:30Z')).toBe('2026-11-01T06:00:00.000Z')
    expect(iso('2026-11-01T06:01:00Z')).toBe('2026-11-01T06:05:00.000Z')
  })
})
