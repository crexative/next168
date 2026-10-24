import { z } from 'zod'
import { proposalInputSchema, type PlannerDocument } from './model'
import { computeStats, planVsActual } from './stats'

export function assistantContext(document: PlannerDocument, options: { includeNotes?: boolean } = {}): string {
  return JSON.stringify({
    contractVersion: '1.0', workspaceId: document.workspaceId, revision: document.revision,
    settings: document.settings, categories: document.categories,
    blocks: document.blocks.map(({ notes, ...block }) => options.includeNotes ? { ...block, notes } : block),
    tasks: document.tasks, stats: computeStats(document), planVsActual: planVsActual(document.actuals),
  })
}
export function proposalJsonSchema() { return z.toJSONSchema(proposalInputSchema) }
