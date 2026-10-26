import { z } from 'zod'
import { aiProjection } from './aiProjection'
import { CONTRACT_VERSION, proposalInputSchema, type PlannerDocument } from './model'
import { computeStats, planVsActual } from './stats'

// The planner as an AI reads it (MCP get_week, the on-device model, a pasted snapshot): always the AI projection.
export function assistantContext(document: PlannerDocument): string {
  const shared = aiProjection(document)
  return JSON.stringify({
    contractVersion: CONTRACT_VERSION, workspaceId: shared.workspaceId, revision: shared.revision,
    settings: shared.settings, categories: shared.categories, blocks: shared.blocks,
    tasks: shared.tasks, stats: computeStats(document), planVsActual: planVsActual(document.actuals),
  })
}
export function proposalJsonSchema() { return z.toJSONSchema(proposalInputSchema) }
