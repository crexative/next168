import type { ChangeProposal, CheckIn, PlannerDocument, PlannerEvent, ProposalOp, Task, TimeBlock } from './model'

// The only view of the planner any AI gets (tasks design rev 2.1 §11.1, rev 4 §2.3): MCP tools, the on-device model's
// context and the "Use with your AI" prompt all read it. Free-text notes never leave the app (task, routine and event
// notes and the check-in note); an entry that has one says so with `hasNotes`. Attendee emails are other people's data
// and are left out too.
export type ProjectedTask = Omit<Task, 'notes'> & { hasNotes?: true }
export type ProjectedBlock = Omit<TimeBlock, 'notes'> & { hasNotes?: true }
export type ProjectedEvent = Omit<PlannerEvent, 'notes' | 'attendees'> & { hasNotes?: true }
export type ProjectedCheckIn = Omit<CheckIn, 'note'> & { hasNotes?: true }

export interface AiProjection extends Omit<PlannerDocument, 'tasks' | 'blocks' | 'events' | 'checkIns'> {
  tasks: ProjectedTask[]
  blocks: ProjectedBlock[]
  events: ProjectedEvent[]
  checkIns: ProjectedCheckIn[]
}

function withoutKeys<T extends object, K extends string>(entry: T, keys: readonly K[], hadNotes: boolean): Omit<T, K> & { hasNotes?: true } {
  const copy = { ...entry } as Record<string, unknown>
  for (const key of keys) delete copy[key]
  if (hadNotes) copy.hasNotes = true
  return copy as Omit<T, K> & { hasNotes?: true }
}

const filled = (text: string | undefined) => text !== undefined && text.trim() !== ''

// The planner with every note and attendee email removed, as a PlannerDocument, for code that builds a model's input
// from the planner type (the on-device model's prompts).
export function redactForAi(document: PlannerDocument): PlannerDocument {
  return {
    ...structuredClone(document),
    tasks: document.tasks.map((task) => withoutKeys(task, ['notes'], false)),
    blocks: document.blocks.map((block) => withoutKeys(block, ['notes'], false)),
    events: document.events.map((event) => ({ ...withoutKeys(event, ['notes'], false), attendees: [] })),
    checkIns: document.checkIns.map((checkIn) => withoutKeys(checkIn, ['note'], false)),
  }
}

export function aiProjection(document: PlannerDocument): AiProjection {
  return {
    ...structuredClone(document),
    tasks: document.tasks.map((task) => withoutKeys(task, ['notes'], filled(task.notes))),
    blocks: document.blocks.map((block) => withoutKeys(block, ['notes'], filled(block.notes))),
    events: document.events.map((event) => withoutKeys(event, ['notes', 'attendees'], filled(event.notes))),
    checkIns: document.checkIns.map((checkIn) => withoutKeys(checkIn, ['note'], filled(checkIn.note))),
  }
}

// What a proposal looks like to an AI (MCP propose_changes and get_proposal): what it is and which entries it touches,
// never the stored ops, which can carry notes copied by the app (a routine split by the on-device model keeps its notes).
export interface ProposalView {
  id: string
  status: ChangeProposal['status']
  summary: string
  createdAt: string
  decidedAt?: string
  ops: { op: ProposalOp['op']; targetId?: string; title?: string }[]
}

export function proposalView(proposal: ChangeProposal, document?: PlannerDocument): ProposalView {
  const titleOf = (id: string) => document?.tasks.find((task) => task.id === id)?.title ?? document?.blocks.find((block) => block.id === id)?.title
  return {
    id: proposal.id, status: proposal.status, summary: proposal.summary, createdAt: proposal.createdAt,
    ...(proposal.decidedAt ? { decidedAt: proposal.decidedAt } : {}),
    ops: proposal.ops.map((op) => {
      switch (op.op) {
        case 'add_task': return { op: op.op, title: op.task.title }
        case 'add_block': return { op: op.op, title: op.block.title }
        case 'update_task': case 'complete_task': case 'update_block': case 'delete_block': {
          const title = titleOf(op.id)
          return { op: op.op, targetId: op.id, ...(title !== undefined ? { title } : {}) }
        }
        case 'update_category_goal': return { op: op.op, targetId: op.id }
        default: return { op: op.op }
      }
    }),
  }
}
