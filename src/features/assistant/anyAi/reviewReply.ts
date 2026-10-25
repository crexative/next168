import type { ChangeProposal, PlannerDocument, ProposalRepository } from '@/core/model'
import { validatedProposal } from '../modelOutput'
import { AssistantError } from '../provider'
import { extractProposal, matchesPlan, type ExtractFailure, type MatchFailure } from './extractProposal'

export type ReplyFailure = ExtractFailure | MatchFailure | 'unusable' | 'duplicateCategory' | 'saveFailed'
// `detail` names what the message is about: the category that already exists, or how many changes were sent.
export type ReplyOutcome = { ok: true; proposal: ChangeProposal } | { ok: false; reason: ReplyFailure; detail?: string }

function failureOf(error: unknown): ReplyFailure {
  const code = error instanceof Error ? ((error as { code?: unknown }).code ?? error.message) : ''
  if (code === 'workspace-mismatch' || code === 'proposal.wrongWorkspace') return 'wrongWorkspace'
  if (code === 'proposal.staleRevision') return 'stale'
  return 'saveFailed'
}

// A new category whose name the plan already has is the one refusal a person can fix by asking plainly.
function unusable(error: unknown): ReplyOutcome {
  const cause = error instanceof AssistantError ? error.cause : undefined
  const [code, ...rest] = typeof cause === 'string' ? cause.split(':') : []
  if (code === 'proposal.duplicateCategory') return { ok: false, reason: 'duplicateCategory', detail: rest.join(':') }
  return { ok: false, reason: 'unusable' }
}

// Turns a chat AI's whole reply into a stored, pending proposal, or says why not. The proposal is only stored once
// it has been checked against the plan as it is now (same workspace and revision, every target present); the person
// still approves it in the review sheet, and nothing is written to the plan here.
export async function reviewReply(reply: string, document: PlannerDocument, proposals: Pick<ProposalRepository, 'create'>): Promise<ReplyOutcome> {
  const extracted = extractProposal(reply)
  if (!extracted.ok) return { ok: false, reason: extracted.reason, ...(extracted.count === undefined ? {} : { detail: String(extracted.count) }) }
  const mismatch = matchesPlan(extracted.input, document)
  if (mismatch) return { ok: false, reason: mismatch }
  try { await validatedProposal(extracted.input, document) } catch (error) { return unusable(error) }
  try { return { ok: true, proposal: await proposals.create(extracted.input, 'import', { basis: document }) } } catch (error) { return { ok: false, reason: failureOf(error) } }
}
