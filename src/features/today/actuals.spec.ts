import { describe, expect, it } from 'vitest'
import { validateDocument } from '@/core/documents'
import { datedOccurrences } from '@/core/time'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { actualFor, clearActual, recordActual, restoreActual } from './actuals'

describe('actuals', () => {
  const document = plannerDocument({ blocks: [deepWork, sleep], settings: { ...plannerDocument().settings, timeZone: 'Europe/Berlin' } })
  const [lastNight, tonight] = datedOccurrences(document, '2026-10-25', 1, 'Europe/Berlin')

  it('snapshots the occurrence with elapsed minutes across the DST night', () => {
    const next = structuredClone(document)
    recordActual(next, lastNight!, 'done')
    expect(next.actuals).toEqual([{
      date: '2026-10-24', blockId: 'sleep', categoryId: 'sleep',
      plannedStartAt: '2026-10-24T20:00:00.000Z', plannedEndAt: '2026-10-25T05:00:00.000Z', plannedMinutes: 540, status: 'done',
    }])
    expect(() => validateDocument(next)).not.toThrow()
  })

  it('replaces the status of the same occurrence and clamps partial minutes', () => {
    const next = structuredClone(document)
    recordActual(next, lastNight!, 'done')
    recordActual(next, lastNight!, 'partial', 9999)
    expect(next.actuals).toHaveLength(1)
    expect(actualFor(next.actuals, lastNight!)).toMatchObject({ status: 'partial', actualMinutes: 540 })
    recordActual(next, lastNight!, 'skipped')
    expect(actualFor(next.actuals, lastNight!)).not.toHaveProperty('actualMinutes')
    expect(() => validateDocument(next)).not.toThrow()
  })

  it('keeps other occurrences when one is cleared', () => {
    const next = structuredClone(document)
    recordActual(next, lastNight!, 'done')
    recordActual(next, tonight!, 'skipped')
    clearActual(next, lastNight!)
    expect(next.actuals.map((actual) => [actual.blockId, actual.plannedStartAt])).toEqual([['sleep', '2026-10-25T21:00:00.000Z']])
  })

  it('stores whole minutes, never NaN, when the minutes field is empty or not a number', () => {
    const next = structuredClone(document)
    recordActual(next, lastNight!, 'partial', Number.NaN)
    expect(actualFor(next.actuals, lastNight!)).toMatchObject({ status: 'partial', actualMinutes: 0 })
    recordActual(next, lastNight!, 'partial', undefined)
    expect(actualFor(next.actuals, lastNight!)).toMatchObject({ actualMinutes: 0 })
    recordActual(next, lastNight!, 'partial', 89.6)
    expect(actualFor(next.actuals, lastNight!)).toMatchObject({ actualMinutes: 90 })
    expect(() => validateDocument(next)).not.toThrow()
  })

  it('restores the previous entry exactly, or removes the entry when there was none', () => {
    const next = structuredClone(document)
    recordActual(next, lastNight!, 'partial', 100)
    const before = structuredClone(actualFor(next.actuals, lastNight!))
    recordActual(next, lastNight!, 'done')
    restoreActual(next, lastNight!, before)
    expect(next.actuals).toEqual([before])
    restoreActual(next, lastNight!, undefined)
    expect(next.actuals).toEqual([])
  })
})
