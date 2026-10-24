import { describe, expect, it } from 'vitest'
import { isReportable, STATUS_WINDOW_MINUTES } from './statusWindow'

const block = { start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T17:00:00.000Z' }
const at = (time: string) => new Date(`2026-10-21T${time}Z`)

describe('isReportable', () => {
  it('stays quiet for most of the block and opens for its last ten minutes', () => {
    expect(isReportable(block, at('10:15:00'))).toBe(false)
    expect(isReportable(block, at('16:49:59'))).toBe(false)
    expect(isReportable(block, at('16:50:00'))).toBe(true)
    expect(STATUS_WINDOW_MINUTES).toBe(10)
  })

  it('treats a block that ends exactly now, and any later moment, as ended', () => {
    expect(isReportable(block, at('17:00:00'))).toBe(true)
    expect(isReportable(block, at('23:59:00'))).toBe(true)
  })

  it('never asks about a block that has not started, even a short one inside the window', () => {
    const short = { start: '2026-10-21T12:03:00.000Z', end: '2026-10-21T12:08:00.000Z' }
    expect(isReportable(short, at('12:00:00'))).toBe(false)
    expect(isReportable(short, at('12:03:00'))).toBe(true)
  })

  it('works across local midnight: a block ending at 24:00 opens at 23:50', () => {
    const evening = { start: '2026-10-21T22:00:00.000Z', end: '2026-10-22T00:00:00.000Z' }
    expect(isReportable(evening, at('23:49:00'))).toBe(false)
    expect(isReportable(evening, at('23:50:00'))).toBe(true)
  })
})
