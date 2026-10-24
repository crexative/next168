import type { ChangeProposal, PlannerDocument, ProposalRepository } from '@/core/model'
import { validatedProposal } from '../modelOutput'
import { extractProposal, matchesPlan, type ExtractFailure, type MatchFailure } from './extractProposal'

export type ReplyFailure = ExtractFailure | MatchFailure | 'unusable' | 'saveFailed'
export type ReplyOutcome = { ok: true; proposal: ChangeProposal } | { ok: false; reason: ReplyFailure }

function failureOf(error: unknown): ReplyFailure {
  const code = error instanceof Error ? ((error as { code?: unknown }).code ?? error.message) : ''
  if (code === 'workspace-mismatch' || code === 'proposal.wrongWorkspace') return 'wrongWorkspace'
  if (code === 'proposal.staleRevision') return 'stale'
  return 'saveFailed'
}

// Turns a chat AI's whole reply into a stored, pending proposal, or says why not. The proposal is only stored once
// it has been checked against the plan as it is now (same workspace and revision, every target present); the person
// still approves it in the review sheet, and nothing is written to the plan here.
export async function reviewReply(reply: string, document: PlannerDocument, proposals: Pick<ProposalRepository, 'create'>): Promise<ReplyOutcome> {
  const extracted = extractProposal(reply)
  if (!extracted.ok) return extracted
  const mismatch = matchesPlan(extracted.input, document)
  if (mismatch) return { ok: false, reason: mismatch }
  try { await validatedProposal(extracted.input, document) } catch { return { ok: false, reason: 'unusable' } }
  try { return { ok: true, proposal: await proposals.create(extracted.input, 'import') } } catch (error) { return { ok: false, reason: failureOf(error) } }
}
