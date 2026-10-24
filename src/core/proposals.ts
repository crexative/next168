import { changeProposalSchema, proposalInputSchema, type Category, type ChangeProposal, type Clock, type PlannerDocument, type ProposalOp } from './model'
import { canonicalJson, sha256, type Hasher } from './canonical'
import { firstUnusedColorKey } from './colorKeys'
import { nextRevision, validateDocument } from './documents'
import { computeStats } from './stats'
import { overlaps } from './time'

export type IdGenerator = () => string
export type ProposalApplication =
  | { kind: 'applied'; document: PlannerDocument; proposal: ChangeProposal }
  | { kind: 'already-applied'; document: PlannerDocument }
  | { kind: 'rejected'; reason: string }
export interface ProposalChange { op: ProposalOp['op']; before: unknown; after: unknown }
// `categories` are the categories as they would be after approval, so new ones can be named in the review.
// `emptyCategories`: categories the approved proposal would leave with no routine and no task (e.g. a default
// "Work" after a whole week was imported), so the review can say they can be deleted.
export interface ProposalPreview { valid: boolean; changes: ProposalChange[]; warnings: string[]; categories: Category[]; emptyCategories: Category[]; reason?: string }

// Category names compare without case, accents' composition or extra spaces: "sueño " and "Sueño" are the same.
export function categoryNameKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export async function canonicalContentHash(ops: ProposalOp[], hash: Hasher = sha256): Promise<string> {
  return hash(canonicalJson(ops))
}
export async function buildProposal(input: unknown, document: PlannerDocument, source: ChangeProposal['source'], clock: Clock, idGen: IdGenerator, hash: Hasher = sha256): Promise<ChangeProposal> {
  const parsed = proposalInputSchema.parse(input)
  if (parsed.workspaceId !== document.workspaceId) throw new Error('proposal.wrongWorkspace')
  if (parsed.baseRevision !== document.revision) throw new Error('proposal.staleRevision')
  return changeProposalSchema.parse({ ...parsed, id: idGen(), source, status: 'pending', createdAt: clock.now().toISOString(), contentHash: await canonicalContentHash(parsed.ops, hash) })
}
async function verifyProposal(document: PlannerDocument, raw: ChangeProposal, hash: Hasher): Promise<ChangeProposal> {
  const proposal = changeProposalSchema.parse(raw)
  if (proposal.workspaceId !== document.workspaceId) throw new Error('proposal.wrongWorkspace')
  if (proposal.baseRevision !== document.revision) throw new Error('proposal.staleRevision')
  if (proposal.status !== 'pending') throw new Error('proposal.notPending')
  if (proposal.contentHash !== await canonicalContentHash(proposal.ops, hash)) throw new Error('proposal.invalidHash')
  return proposal
}
function required<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((item) => item.id === id)
  if (!item) throw new Error('proposal.missingTarget')
  return item
}
// Reasons carry a detail after the first colon, as warnings do ("proposal.duplicateCategory:Sueño").
function fail(code: string, detail?: string): never { throw new Error(detail === undefined ? code : `${code}:${detail}`) }

function stage(document: PlannerDocument, ops: ProposalOp[], idGen: IdGenerator, clock: Clock) {
  const changes: ProposalChange[] = []
  // Temporary refs of the categories this proposal creates, to their real ids; any other id passes through unchanged.
  const refs = new Map<string, string>()
  const categoryId = (value: string) => refs.get(value) ?? value
  const withCategory = <T extends { categoryId?: string }>(item: T): T => (item.categoryId === undefined ? item : { ...item, categoryId: categoryId(item.categoryId) })
  for (const op of ops) {
    let before: unknown = null, after: unknown = null
    switch (op.op) {
      case 'add_category': {
        if (refs.has(op.ref) || document.categories.some((category) => category.id === op.ref)) fail('proposal.categoryRefTaken', op.ref)
        const existing = document.categories.find((category) => categoryNameKey(category.name) === categoryNameKey(op.category.name))
        if (existing) fail('proposal.duplicateCategory', existing.name)
        const colorKey = firstUnusedColorKey(document.categories.filter((category) => !category.customColor).map((category) => category.colorKey))
        const category: Category = { id: idGen(), name: op.category.name, colorKey, goal: op.category.goal ?? { type: 'none', hoursPerWeek: 0 } }
        refs.set(op.ref, category.id); document.categories.push(category); after = category; break
      }
      case 'add_block': {
        const block = { ...withCategory(op.block), id: idGen() }; document.blocks.push(block); after = block; break
      }
      case 'update_block': {
        const block = required(document.blocks, op.id); before = structuredClone(block)
        Object.assign(block, withCategory(op.patch)); after = block; break
      }
      case 'delete_block': {
        before = required(document.blocks, op.id)
        document.blocks = document.blocks.filter((block) => block.id !== op.id); break
      }
      case 'add_task': {
        const task = { ...withCategory(op.task), id: idGen(), createdAt: clock.now().toISOString() }; document.tasks.push(task); after = task; break
      }
      case 'update_task': {
        const task = required(document.tasks, op.id); before = structuredClone(task)
        Object.assign(task, withCategory(op.patch)); after = task; break
      }
      case 'complete_task': {
        const task = required(document.tasks, op.id); before = structuredClone(task)
        task.doneAt = clock.now().toISOString(); after = task; break
      }
      case 'add_event': {
        const event = { ...op.event, id: idGen() }; document.events.push(event); after = event; break
      }
      case 'update_category_goal': {
        const category = required(document.categories, categoryId(op.id)); before = structuredClone(category)
        category.goal = op.goal; after = category; break
      }
    }
    changes.push({ op: op.op, before: structuredClone(before), after: structuredClone(after) })
  }
  return { document: validateDocument(document), changes }
}
function reason(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export async function previewProposal(document: PlannerDocument, proposal: ChangeProposal, hash: Hasher = sha256): Promise<ProposalPreview> {
  try {
    const snapshot = validateDocument(document)
    const verified = await verifyProposal(snapshot, proposal, hash)
    let sequence = 0
    const ids = new Set([...snapshot.categories, ...snapshot.blocks, ...snapshot.tasks, ...snapshot.events].map((item) => item.id))
    const previewId = () => { let id: string; do { id = `preview-${++sequence}` } while (ids.has(id)); return id }
    const result = stage(snapshot, verified.ops, previewId, { now: () => new Date(verified.createdAt) })
    const warnings: string[] = []
    if (result.document.blocks.some((a, index, blocks) => blocks.slice(index + 1).some((b) => overlaps(a, b)))) warnings.push('block.overlap')
    for (const category of computeStats(result.document).categories) {
      if (category.goal.kind === 'over') warnings.push(`goal.over:${category.categoryId}`)
    }
    const used = new Set([...result.document.blocks, ...result.document.tasks].map((item) => item.categoryId))
    const emptyCategories = result.document.categories.filter((category) => !used.has(category.id))
    return { valid: true, changes: result.changes, warnings, categories: result.document.categories, emptyCategories }
  } catch (error) { return { valid: false, changes: [], warnings: [], categories: document.categories, emptyCategories: [], reason: reason(error) } }
}
export async function applyProposal(document: PlannerDocument, proposal: ChangeProposal, idGen: IdGenerator, clock: Clock, hash: Hasher = sha256): Promise<ProposalApplication> {
  if (document.appliedProposalIds.includes(proposal.id)) return { kind: 'already-applied', document }
  try {
    const snapshot = validateDocument(document)
    const verified = await verifyProposal(snapshot, proposal, hash)
    const candidate = stage(snapshot, verified.ops, idGen, clock).document
    candidate.appliedProposalIds = [...candidate.appliedProposalIds, verified.id].slice(-200)
    const updated = nextRevision(candidate, clock)
    return { kind: 'applied', document: updated, proposal: { ...verified, status: 'applied', appliedRevision: updated.revision, decidedAt: updated.updatedAt } }
  } catch (error) { return { kind: 'rejected', reason: reason(error) } }
}
