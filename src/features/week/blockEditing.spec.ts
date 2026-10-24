import { describe, expect, it } from 'vitest'
import { validateDocument } from '@/core/documents'
import { removeBlock, restoreBlock, upsertBlock, validateBlockDraft, type BlockDraft } from './blockEditing'
import { deepWork, plannerDocument, sleep } from './testDocument'

const document = plannerDocument({ blocks: [deepWork, sleep] })
const draft = (patch: Partial<BlockDraft> = {}): BlockDraft => ({ title: 'Standup', categoryId: 'work', start: 720, end: 750, days: [3], ...patch })

describe('block draft validation', () => {
  it('accepts a free slot and returns a schema-valid block', () => {
    const result = validateBlockDraft(draft(), document)
    expect(result.errors).toEqual([])
    expect(result.block).toMatchObject({ title: 'Standup', days: [3], start: 720, end: 750 })
  })

  it('reports every missing field', () => {
    expect(validateBlockDraft(draft({ title: '  ', categoryId: 'nope', start: null, days: [] }), document).errors.map((error) => error.code))
      .toEqual(['titleRequired', 'categoryRequired', 'timeRequired', 'daysRequired'])
    expect(validateBlockDraft(draft({ end: 720 }), document).errors).toEqual([{ code: 'zeroLength' }])
  })

  it('blocks an overlap and names the block it hits', () => {
    const result = validateBlockDraft(draft({ start: 570, end: 630 }), document)
    expect(result.errors).toEqual([{ code: 'overlap', blockTitle: 'Deep work' }])
    expect(result.block).toBeNull()
  })

  it('detects overlaps with the spill of an overnight block into the next day', () => {
    expect(validateBlockDraft(draft({ start: 300, end: 420, days: [0] }), document).errors).toEqual([{ code: 'overlap', blockTitle: 'Sleep' }])
    expect(validateBlockDraft(draft({ start: 360, end: 420, days: [0] }), document).errors).toEqual([])
  })

  it('lets a block keep its own time when it is edited', () => {
    const result = validateBlockDraft({ id: 'deep', title: 'Deep work', categoryId: 'work', start: 540, end: 690, days: [1, 2, 3, 4, 5] }, document)
    expect(result.errors).toEqual([])
    expect(result.block).toMatchObject({ id: 'deep', end: 690 })
  })

  it('warns without blocking when a max goal would be exceeded', () => {
    const result = validateBlockDraft(draft({ categoryId: 'gym', start: 720, end: 900, days: [3] }), document)
    expect(result.warnings).toEqual([{ code: 'goalOver', categoryName: 'Exercise', minutes: 60 }])
    expect(result.block).not.toBeNull()
  })
})

describe('block mutations', () => {
  it('adds, replaces, removes and restores a block at its position', () => {
    const next = structuredClone(document)
    upsertBlock(next, { ...validateBlockDraft(draft(), next).block!, id: 'new' })
    upsertBlock(next, { ...deepWork, title: 'Focus' })
    expect(next.blocks.map((block) => block.title)).toEqual(['Focus', 'Sleep', 'Standup'])
    removeBlock(next, 'sleep')
    restoreBlock(next, sleep, 1)
    restoreBlock(next, sleep, 1)
    expect(next.blocks.map((block) => block.id)).toEqual(['deep', 'sleep', 'new'])
    expect(() => validateDocument(next)).not.toThrow()
  })
})
