// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { legacyChangeProposalSchema } from '../legacy/v2'
import { commitProposal, buildProposal, previewProposal } from '../proposals'
import { changeProposalSchema, COLOR_KEYS, MAX_OPS_PER_PROPOSAL, proposalInputSchema, type PlannerDocument, type ProposalInput, type ProposalOp } from '../model'
import { computeStats } from '../stats'
import { clock, document } from './fixtures'
import { syntheticWeekProposal, SYNTHETIC_RANGE_COUNT } from '../../features/assistant/anyAi/syntheticWeek'

// add_category (#3): a proposal can create categories and use them through their temporary ref in later ops.
const input = (ops: ProposalOp[], doc: PlannerDocument = document()): ProposalInput => ({ contractVersion: '1.1', workspaceId: doc.workspaceId, baseRevision: doc.revision, summary: 'Move my week', ops })
const ids = () => { let i = 0; return () => `id-${++i}` }
const empty = (): PlannerDocument => ({ ...document(), categories: [] })
const sleep: ProposalOp = { op: 'add_category', ref: 'new-sleep', category: { name: 'Sueño', goal: { type: 'min', hoursPerWeek: 56 } } }
const music: ProposalOp = { op: 'add_category', ref: 'new-music', category: { name: 'Música' } }
// Sunday to Thursday 22:30 → 06:30 the next morning.
const overnight: ProposalOp = { op: 'add_block', block: { categoryId: 'new-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4], start: 1350, end: 390 } }

async function apply(doc: PlannerDocument, ops: ProposalOp[], id = 'p') {
  const proposal = await buildProposal(input(ops, doc), doc, 'import', clock, () => id)
  return { proposal, result: await commitProposal(doc, proposal, ids(), clock) }
}

describe('add_category', () => {
  it('creates the category with a real id and an unused colour, and later ops use it through the ref', async () => {
    const doc = empty()
    const { result } = await apply(doc, [
      sleep, music, overnight,
      { op: 'add_task', task: { title: 'Afinar', categoryId: 'new-music', durationMin: 15, priority: 3 } },
      { op: 'update_category_goal', id: 'new-music', goal: { type: 'max', hoursPerWeek: 3 } },
    ])
    if (result.kind !== 'applied') throw Error(JSON.stringify(result))
    const [created, second] = result.document.categories
    expect(created).toEqual({ id: 'id-1', name: 'Sueño', colorKey: 'blue', goal: { type: 'min', hoursPerWeek: 56 } })
    expect(second).toEqual({ id: 'id-2', name: 'Música', colorKey: 'green', goal: { type: 'max', hoursPerWeek: 3 } })
    expect(result.document.blocks[0]).toMatchObject({ categoryId: 'id-1', start: 1350, end: 390 })
    expect(result.document.tasks[0]).toMatchObject({ categoryId: 'id-2' })
    expect(JSON.stringify(result.document)).not.toContain('new-sleep')
    // The overnight block counts 8 h on each of its five nights.
    expect(computeStats(result.document).categories.find((row) => row.categoryId === 'id-1')!.plannedMinutes).toBe(5 * 8 * 60)
    expect(doc.categories).toEqual([])
  })

  it('a category without a goal gets "no goal", and colours stay distinct next to existing categories', async () => {
    const doc = document() // already has "Work" in blue
    const { result } = await apply(doc, [music, { op: 'add_category', ref: 'new-b', category: { name: 'Lectura' } }])
    if (result.kind !== 'applied') throw Error(JSON.stringify(result))
    expect(result.document.categories.map((category) => category.colorKey)).toEqual(['blue', 'green', 'orange'])
    expect(result.document.categories[1]!.goal).toEqual({ type: 'none', hoursPerWeek: 0 })
    const nine = await apply(empty(), COLOR_KEYS.map((_, index) => ({ op: 'add_category', ref: `new-${index}`, category: { name: `C${index}` } })))
    if (nine.result.kind !== 'applied') throw Error('apply')
    expect(new Set(nine.result.document.categories.map((category) => category.colorKey)).size).toBe(COLOR_KEYS.length)
  })

  it('the preview names the new categories so the review can show them, and stages nothing', async () => {
    const doc = empty()
    const proposal = await buildProposal(input([sleep, overnight], doc), doc, 'import', clock, () => 'p')
    const preview = await previewProposal(doc, proposal)
    expect(preview.valid).toBe(true)
    expect(preview.categories.map((category) => category.name)).toEqual(['Sueño'])
    expect(preview.changes[1]!.after).toMatchObject({ categoryId: preview.categories[0]!.id })
    expect(doc.categories).toEqual([])
  })

  it.each<[string, ProposalOp[], string]>([
    ['a name the plan already has (any case and spacing)', [{ op: 'add_category', ref: 'new-w', category: { name: '  WORK ' } }], 'proposal.duplicateCategory:Work'],
    ['the same name twice in one proposal', [sleep, { op: 'add_category', ref: 'new-other', category: { name: 'sueño' } }], 'proposal.duplicateCategory:Sueño'],
    ['a ref that is an existing id', [{ op: 'add_category', ref: 'work', category: { name: 'Otra' } }], 'proposal.categoryRefTaken:work'],
    ['the same ref twice', [sleep, { op: 'add_category', ref: 'new-sleep', category: { name: 'Siesta' } }], 'proposal.categoryRefTaken:new-sleep'],
    ['a ref used before its category is created', [overnight, sleep], 'document.missingCategory'],
  ])('rejects the whole proposal for %s, with a plain reason', async (_label, ops, reason) => {
    const doc = document(); const before = JSON.stringify(doc)
    const { proposal, result } = await apply(doc, [...ops, { op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }])
    expect(result).toEqual({ kind: 'rejected', reason })
    expect(await previewProposal(doc, proposal)).toMatchObject({ valid: false, reason })
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('approving twice creates the categories once', async () => {
    const doc = empty()
    const { proposal, result } = await apply(doc, [sleep, overnight])
    if (result.kind !== 'applied') throw Error('apply')
    expect(await commitProposal(result.document, proposal, ids(), clock)).toEqual({ kind: 'already-applied', document: result.document })
    expect(result.document.categories).toHaveLength(1)
  })

  it('is refused when the plan changed after the proposal was made (another tab created a category)', async () => {
    const doc = empty()
    const proposal = await buildProposal(input([sleep], doc), doc, 'import', clock, () => 'p')
    const changed = { ...doc, revision: doc.revision + 1, categories: [{ id: 'tab-2', name: 'Sueño', colorKey: 'blue' as const, goal: { type: 'none' as const, hoursPerWeek: 0 } }] }
    expect(await commitProposal(changed, proposal, ids(), clock)).toEqual({ kind: 'rejected', reason: 'proposal.staleRevision' })
  })

  it('reads older (contract 1.0) proposals only as history, and allows a whole week in one proposal', async () => {
    const legacy = { id: 'p', workspaceId: 'w', source: 'mcp', baseRevision: 0, contentHash: '0'.repeat(64), summary: '', status: 'pending', createdAt: clock.now().toISOString(),
      ops: [{ op: 'update_category_goal', id: 'work', goal: { type: 'min', hoursPerWeek: 1 } }] }
    expect(legacyChangeProposalSchema.safeParse(legacy).success).toBe(true)
    expect(changeProposalSchema.safeParse(legacy).success).toBe(false)
    expect(MAX_OPS_PER_PROPOSAL).toBe(200)
    const tooMany = Array.from({ length: 201 }, () => ({ op: 'delete_block', id: 'x' }))
    expect(proposalInputSchema.safeParse({ ...input([]), ops: tooMany }).success).toBe(false)
    expect(proposalInputSchema.safeParse({ ...input([]), ops: tooMany.slice(1) }).success).toBe(true)

    const doc = empty()
    const week = syntheticWeekProposal(doc.workspaceId, doc.revision)
    const proposal = await buildProposal(week, doc, 'import', clock, () => 'week')
    const result = await commitProposal(doc, proposal, ids(), clock)
    if (result.kind !== 'applied') throw Error(JSON.stringify(result))
    expect(result.document.categories).toHaveLength(8)
    expect(result.document.blocks.reduce((sum, block) => sum + block.days.length, 0)).toBe(SYNTHETIC_RANGE_COUNT)
    expect(result.document.tasks).toHaveLength(3)
    expect(computeStats(result.document).categories.reduce((sum, row) => sum + row.plannedMinutes, 0)).toBe(168 * 60)
  })
})

describe('categories a proposal leaves empty', () => {
  it('names a category with no routine and no task after the change, like a default one next to an imported week', async () => {
    const doc = document()
    const kept = doc.categories[0]!
    const proposal = await buildProposal(input([sleep, overnight]), doc, 'import', clock, () => 'p-empty')
    const preview = await previewProposal(doc, proposal)
    expect(preview.valid).toBe(true)
    expect(preview.emptyCategories.map((category) => category.name)).toEqual([kept.name])
  })

  it('does not name a category that keeps a task, and names one whose last routine the change removes', async () => {
    const base = document()
    const kept = base.categories[0]!
    const doc: PlannerDocument = { ...base, blocks: [{ id: 'b-1', categoryId: kept.id, title: 'Focus', days: [1], start: 540, end: 600 }] }
    const withTask = await buildProposal(input([{ op: 'add_task', task: { title: 'Plan', categoryId: kept.id, durationMin: 30, priority: 2 } }, { op: 'delete_block', id: 'b-1' }], doc), doc, 'import', clock, () => 'p-task')
    expect((await previewProposal(doc, withTask)).emptyCategories).toEqual([])
    const removing = await buildProposal(input([{ op: 'delete_block', id: 'b-1' }], doc), doc, 'import', clock, () => 'p-delete')
    expect((await previewProposal(doc, removing)).emptyCategories.map((category) => category.id)).toEqual([kept.id])
  })
})
