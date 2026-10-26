import { describe, expect, it } from 'vitest'
import { buildShareSummary, shareGroups } from './shareSummary'
import { BLOCK_SENTINEL, manyCategoriesDocument, sentinelDocument } from './testFixtures'

const brand = { name: 'Weeklid', slug: 'weeklid' }
const ISO_DATE = /\d{4}-\d{2}-\d{2}/

// T-1B-01: only allowlisted fields reach the summary.
describe('buildShareSummary', () => {
  it('with names off carries no sentinel, no id and no date', () => {
    const json = JSON.stringify(buildShareSummary(sentinelDocument(), { includeNames: false, brand }))
    expect(json).not.toMatch(/SENTINEL|sentinel/)
    expect(json).not.toMatch(ISO_DATE)
  })

  it('with names on carries block titles only, at most three per category, longest first', () => {
    const summary = buildShareSummary(sentinelDocument(), { includeNames: true, brand })
    const json = JSON.stringify(summary)
    expect(json.replace(new RegExp(`${BLOCK_SENTINEL}-[A-Z0-9]+`, 'g'), '')).not.toMatch(/SENTINEL|sentinel/)
    expect(json).not.toMatch(ISO_DATE)
    const work = summary.categories.find((category) => category.name === 'Work')!
    // W1 40 h, W2 2 h, W3 1 h; W4 (30 min) is the fourth and stays out.
    expect(work.routines).toEqual([`${BLOCK_SENTINEL}-W1`, `${BLOCK_SENTINEL}-W2`, `${BLOCK_SENTINEL}-W3`])
    for (const category of summary.categories) expect(category.routines!.length).toBeLessThanOrEqual(3)
  })

  it('copies the figures of the Summary: planned categories only, largest first, 168 split like the week bar', () => {
    const summary = buildShareSummary(sentinelDocument(), { includeNames: false, brand })
    expect(summary.categories.map(({ name, plannedMinutes }) => [name, plannedMinutes])).toEqual([['Sleep', 3360], ['Work', 2610], ['Gym', 120]])
    expect(summary.assignedHours + summary.unassignedHours).toBe(168)
    expect(summary).toMatchObject({ brandName: 'Weeklid', assignedHours: 102, plannedTotalHours: 102, overlap: false })
    expect(summary.categories[0]).toEqual({ name: 'Sleep', glyph: 'S', color: { key: 'purple' }, plannedMinutes: 3360 })
    expect('publicUrl' in summary).toBe(false)
  })

  it('keeps a custom colour as hex and the icon as the glyph', () => {
    const document = sentinelDocument()
    document.categories[0] = { ...document.categories[0]!, customColor: '#FFFFFF', icon: '💼' }
    const work = buildShareSummary(document, { includeNames: false, brand }).categories.find((category) => category.name === 'Work')!
    expect(work).toMatchObject({ glyph: '💼', color: { hex: '#FFFFFF' } })
  })

  it('groups the legend into six entries, four with names on, the last gathering the rest', () => {
    const document = manyCategoriesDocument(30)
    const off = shareGroups(buildShareSummary(document, { includeNames: false, brand }))
    expect(off).toHaveLength(6)
    expect(off[5]).toMatchObject({ others: true, count: 25 })
    const on = shareGroups(buildShareSummary(document, { includeNames: true, brand }))
    expect(on).toHaveLength(4)
    expect(on[3]).toMatchObject({ others: true, count: 27 })
    const total = (groups: { plannedMinutes: number }[]) => groups.reduce((sum, group) => sum + group.plannedMinutes, 0)
    expect(total(off)).toBe(total(on))
  })
})
