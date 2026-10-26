import { describe, expect, it } from 'vitest'
import { cellsFor, FREE_CELL } from './cells'
import { buildShareSummary, shareGroups } from './shareSummary'
import { overlapDocument, sentinelDocument } from './testFixtures'

const brand = { name: 'Weeklid', slug: 'weeklid' }
const count = (cells: number[], owner: number) => cells.filter((cell) => cell === owner).length

// T-1B-02
describe('cellsFor', () => {
  it('gives the week 168 cells and the categories their rounded planned hours', () => {
    const summary = buildShareSummary(sentinelDocument(), { includeNames: false, brand })
    const cells = cellsFor(shareGroups(summary))
    expect(cells).toHaveLength(168)
    expect(cells.filter((cell) => cell !== FREE_CELL)).toHaveLength(Math.round(Math.min(3360 + 2610 + 120, 168 * 60) / 60))
    expect([count(cells, 0), count(cells, 1), count(cells, 2)]).toEqual([56, 44, 2])
  })

  it('scales overlapping routines (465 h) into all 168 cells, in proportion', () => {
    const summary = buildShareSummary(overlapDocument(), { includeNames: false, brand })
    expect(summary).toMatchObject({ plannedTotalHours: 465, overlap: true, assignedHours: 168, unassignedHours: 0 })
    const cells = cellsFor(shareGroups(summary))
    expect(cells).toHaveLength(168)
    expect(cells).not.toContain(FREE_CELL)
    expect([count(cells, 0), count(cells, 1), count(cells, 2), count(cells, 3)]).toEqual([58, 58, 51, 1])
  })

  it('leaves an empty week free', () => {
    expect(cellsFor([])).toEqual(Array.from({ length: 168 }, () => FREE_CELL))
  })
})
