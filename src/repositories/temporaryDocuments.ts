// TODO(#3): replace with core documents (src/core/documents.ts `parseDocument`, `createEmptyDocument`)
import { SCHEMA_VERSION, plannerDocumentSchema, type PlannerDocument } from '@/core/model'

export type ParseResult = { ok: true; document: PlannerDocument } | { ok: false; reason: string }

export function parseDocument(raw: unknown): ParseResult {
  const result = plannerDocumentSchema.safeParse(raw)
  if (result.success) return { ok: true, document: result.data }
  const issue = result.error.issues[0]
  return { ok: false, reason: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}` }
}

export function createEmptyDocument(options: { now: Date; locale: string; timeZone: string; workspaceId: string }): PlannerDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: options.workspaceId,
    revision: 0,
    updatedAt: options.now.toISOString(),
    settings: { locale: options.locale, weekStartsOn: 1, timeZone: options.timeZone, onboardingDone: false, theme: 'system' },
    categories: [], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
  }
}
