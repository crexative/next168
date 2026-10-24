import { proposalInputSchema, type PlannerDocument, type ProposalInput } from '@/core/model'
import { buildProposal, previewProposal } from '@/core/proposals'
import { parseIntent, proposalFromIntent } from './changeIntent'
import { AssistantError, type AskContext, type AssistantAnswer } from './provider'

export function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new AssistantError('invalid-output', { cause })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AssistantError('invalid-output')
  return value as Record<string, unknown>
}

// The proposal is built by code from the model's intent, so the binding fields and ids come from the document.
// It is still checked as an external proposal would be: schema, then a dry run against the document.
export async function validatedProposal(candidate: unknown, document: PlannerDocument): Promise<ProposalInput> {
  const parsed = proposalInputSchema.safeParse(candidate)
  if (!parsed.success) throw new AssistantError('invalid-output', { cause: parsed.error })

  try {
    const proposal = await buildProposal(parsed.data, document, 'assistant', { now: () => new Date() }, () => 'preview')
    const preview = await previewProposal(document, proposal)
    if (!preview.valid) throw new AssistantError('invalid-output', { cause: preview.reason })
  } catch (cause) {
    throw cause instanceof AssistantError ? cause : new AssistantError('invalid-output', { cause })
  }
  return parsed.data
}

// Either a reviewable proposal or a short message about what the request still needs; never an unchecked proposal.
export async function answerFromChangeReply(text: string, request: string, { document, locale, translate }: AskContext): Promise<AssistantAnswer> {
  const outcome = proposalFromIntent(parseIntent(parseJsonObject(text)), { request, document, locale, translate })
  if (outcome.kind === 'message') return { answer: outcome.message }
  return { answer: outcome.summary, proposal: await validatedProposal(outcome.proposal, document) }
}

export function answerText(text: string): string {
  const answer = parseJsonObject(text).answer
  if (typeof answer !== 'string' || answer.trim() === '') throw new AssistantError('invalid-output')
  return answer.trim()
}
