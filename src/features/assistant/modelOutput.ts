import { proposalInputSchema, type PlannerDocument, type ProposalInput } from '@/core/model'
import { buildProposal, previewProposal } from '@/core/proposals'
import { AssistantError } from './provider'

// The binding fields come from the document the question was asked about, never from the model:
// a 1B model cannot be trusted to copy a UUID. Everything else must validate as the model wrote it.
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

export async function validatedProposal(text: string, document: PlannerDocument): Promise<ProposalInput> {
  const raw = parseJsonObject(text)
  const parsed = proposalInputSchema.safeParse({
    ...raw, contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision,
  })
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

export function answerText(text: string): string {
  const answer = parseJsonObject(text).answer
  if (typeof answer !== 'string' || answer.trim() === '') throw new AssistantError('invalid-output')
  return answer.trim()
}
