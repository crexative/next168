// The person's own submissions (tasks design rev 6 §2.1/§2.4, addendum 6.1 F1–F3). This module is the only one that
// writes ops a person composed in a preview: proposals made by an AI reach the planner only through commitProposal.
// Its inputs are plain values built by UI code (titles, dates, minutes), never proposal ops or proposal inputs, and a
// build-graph test keeps every assistant, proposal and companion module from reaching it.
//
// A submission is an attempt: an immutable id with a fixed payload (its ops and the ids its tasks will get). It commits
// only on the planner the preview was built on (its revision, and inside the commit lock its stored fingerprint and
// workspace), records its id in `appliedCaptureIds` with the change, and returns a receipt that Undo is bound to.
import { toRaw } from 'vue'
import { documentFingerprint } from '@/core/documents'
import { proposalOpSchema, type PlannerDocument, type ProposalOp } from '@/core/model'
import { stageOps } from '@/core/proposals'
import { CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { activePlannerRepository, usePlannerStore } from '@/stores/plannerStore'

// What a capture row may set: the fields of a new task a person chose or typed.
export interface CapturedTask {
  title: string
  durationMin?: number
  dueDate?: string
  at?: number
  categoryId?: string
  priority?: 1 | 2 | 3
  notes?: string
}

// The planner a preview was built on.
export interface CaptureBinding {
  workspaceId: string
  generation: number
  revision: number
  storedFingerprint: string
  purgeEpoch?: number
}

type AddTaskOp = Extract<ProposalOp, { op: 'add_task' }>

export interface CaptureAttempt {
  readonly attemptId: string
  readonly ops: readonly AddTaskOp[]
  readonly taskIds: readonly string[]
}

// What an Undo is bound to: the workspace and its generation, and every created task exactly as the commit left it.
export interface CaptureReceipt {
  workspaceId: string
  generation: number
  attemptId: string
  createdIds: string[]
  snapshots: (string | undefined)[]
}

export type CaptureOutcome =
  | { kind: 'added'; receipt: CaptureReceipt }
  // The planner changed after the preview was built: nothing was written, and the preview is built again.
  | { kind: 'changed-elsewhere' }
  | { kind: 'invalid'; reason: string }
  // The write may or may not have happened (a lost response): reconcileCapture finds out before anything else is sent.
  | { kind: 'unknown' }

export type UndoOutcome = 'undone' | 'changed-elsewhere' | 'unknown'

const ALREADY_APPLIED = 'capture.alreadyApplied'
const MAX_APPLIED_CAPTURES = 200

const newId = () => crypto.randomUUID()

// The planner as shown now, read before any await so every part describes the same moment.
export async function bindToPlanner(): Promise<CaptureBinding | null> {
  const planner = usePlannerStore()
  const document = planner.document
  if (planner.status !== 'ready' || !document) return null
  const shown = structuredClone(toRaw(document))
  const stored = planner.stored
  const purgeEpoch = activePlannerRepository().knownPurgeEpoch?.()
  return {
    workspaceId: shown.workspaceId, generation: shown.generation, revision: shown.revision,
    storedFingerprint: stored ? await documentFingerprint(shown) : 'absent',
    ...(purgeEpoch !== undefined ? { purgeEpoch } : {}),
  }
}

// An attempt for `rows`, its ops checked against the strict contract the AI routes use. Throws on an invalid row.
export function captureAttempt(rows: readonly CapturedTask[]): CaptureAttempt {
  const ops = rows.map((row) => proposalOpSchema.parse({
    op: 'add_task',
    task: {
      title: row.title, priority: row.priority ?? 2,
      ...(row.durationMin !== undefined ? { durationMin: row.durationMin } : {}),
      ...(row.dueDate !== undefined ? { dueDate: row.dueDate } : {}),
      ...(row.at !== undefined ? { at: row.at } : {}),
      ...(row.categoryId !== undefined ? { categoryId: row.categoryId } : {}),
      ...(row.notes !== undefined && row.notes.trim() !== '' ? { notes: row.notes } : {}),
    },
  }) as AddTaskOp)
  return Object.freeze({ attemptId: newId(), ops: Object.freeze(ops), taskIds: Object.freeze(ops.map(() => newId())) })
}

function recordAttempt(draft: PlannerDocument, attemptId: string): void {
  draft.appliedCaptureIds = [...draft.appliedCaptureIds, attemptId].slice(-MAX_APPLIED_CAPTURES)
}

function receiptFrom(document: PlannerDocument, attempt: CaptureAttempt): CaptureReceipt {
  return {
    workspaceId: document.workspaceId, generation: document.generation, attemptId: attempt.attemptId,
    createdIds: [...attempt.taskIds], snapshots: attempt.taskIds.map((id) => snapshotOf(document.tasks.find((task) => task.id === id))),
  }
}

// The receipt of an attempt the planner in memory already holds.
function appliedReceipt(attempt: CaptureAttempt): CaptureReceipt | undefined {
  const document = usePlannerStore().document
  return document?.appliedCaptureIds.includes(attempt.attemptId) ? receiptFrom(document, attempt) : undefined
}

function outcomeOf(reason: string, attempt: CaptureAttempt): CaptureOutcome {
  const applied = appliedReceipt(attempt)
  if (applied) return { kind: 'added', receipt: applied }
  if (reason === CHANGED_ELSEWHERE || reason === 'conflict') return { kind: 'changed-elsewhere' }
  if (reason === 'invalid-document' || reason.startsWith('proposal.') || reason.startsWith('task.') || reason.startsWith('document.')) return { kind: 'invalid', reason }
  return { kind: 'unknown' }
}

// Writes the ops a person composed, on the planner `binding` describes, all or nothing.
export async function commitPersonOps(attempt: CaptureAttempt, binding: CaptureBinding): Promise<CaptureOutcome> {
  const planner = usePlannerStore()
  const holder: { receipt?: CaptureReceipt } = {}
  const ids = [...attempt.taskIds]
  const result = await planner.commit((draft) => {
    if (draft.workspaceId !== binding.workspaceId || draft.generation !== binding.generation) throw new Error(CHANGED_ELSEWHERE)
    if (draft.appliedCaptureIds.includes(attempt.attemptId)) throw new Error(ALREADY_APPLIED)
    const now = new Date()
    stageOps(draft, structuredClone([...attempt.ops]), () => ids.shift() ?? newId(), { now: () => now })
    recordAttempt(draft, attempt.attemptId)
    holder.receipt = receiptFrom(draft, attempt)
  }, {
    expect: { storedFingerprint: binding.storedFingerprint, purgeEpoch: binding.purgeEpoch, workspaceId: binding.workspaceId },
    expectRevision: binding.revision,
  })
  if (result.ok && holder.receipt) return { kind: 'added', receipt: holder.receipt }
  if (!result.ok) {
    planner.dismissError()
    return outcomeOf(result.reason, attempt)
  }
  return { kind: 'unknown' }
}

// Captured tasks, added in one commit. `rows` are plain values from the capture preview or the quick-add field.
export function addCapturedTasks(attempt: CaptureAttempt, binding: CaptureBinding): Promise<CaptureOutcome> {
  return commitPersonOps(attempt, binding)
}

// After an unknown outcome: reads the planner again and tells whether the attempt was committed. 'unverified' when the
// planner cannot be read; the same attempt (never a new one) may then be sent again.
export async function reconcileCapture(attempt: CaptureAttempt): Promise<CaptureOutcome | { kind: 'not-applied' } | { kind: 'unverified' }> {
  const planner = usePlannerStore()
  await planner.load()
  if (planner.status !== 'ready' || !planner.document) return { kind: 'unverified' }
  const applied = appliedReceipt(attempt)
  return applied ? { kind: 'added', receipt: applied } : { kind: 'not-applied' }
}

// Removes exactly the receipt's tasks, all or nothing, only while the workspace, its generation and every one of them are
// as the commit left them. An edit elsewhere in the planner never blocks it.
export async function undoCapture(receipt: CaptureReceipt): Promise<UndoOutcome> {
  const planner = usePlannerStore()
  const undoId = newId()
  const result = await planner.commit((draft) => {
    if (draft.workspaceId !== receipt.workspaceId || draft.generation !== receipt.generation) throw new Error(CHANGED_ELSEWHERE)
    receipt.createdIds.forEach((id, index) => {
      if (snapshotOf(draft.tasks.find((task) => task.id === id)) !== receipt.snapshots[index]) throw new Error(CHANGED_ELSEWHERE)
    })
    const created = new Set(receipt.createdIds)
    draft.tasks = draft.tasks.filter((task) => !created.has(task.id))
    recordAttempt(draft, undoId)
  })
  if (result.ok) return 'undone'
  planner.dismissError()
  if (result.reason === CHANGED_ELSEWHERE || result.reason === 'conflict') return 'changed-elsewhere'
  const reconciled = await reconcileUndo(undoId)
  return reconciled
}

async function reconcileUndo(undoId: string): Promise<UndoOutcome> {
  const planner = usePlannerStore()
  await planner.load()
  if (planner.status !== 'ready' || !planner.document) return 'unknown'
  return planner.document.appliedCaptureIds.includes(undoId) ? 'undone' : 'unknown'
}
