import { plannerDocumentSchema, type Clock, type LoadResult, type PlannerDocument } from './model'

export interface DocumentEnvironment {
  now: Date
  timeZone: string
  locale: string
  tutorialCompleted?: boolean
  idGen?: () => string
}

export function createEmptyDocument(env: DocumentEnvironment): PlannerDocument {
  return plannerDocumentSchema.parse({
    schemaVersion: 2, workspaceId: (env.idGen ?? (() => crypto.randomUUID()))(),
    revision: 0, updatedAt: env.now.toISOString(),
    settings: { locale: env.locale, timeZone: env.timeZone, weekStartsOn: 1, onboardingDone: env.tutorialCompleted ?? false, theme: 'system' },
    categories: [], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
  })
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) throw new Error(`document.duplicate:${field}`)
}

export function validateDocument(raw: unknown): PlannerDocument {
  const doc = plannerDocumentSchema.parse(raw)
  new Intl.DateTimeFormat('en', { timeZone: doc.settings.timeZone }).format(0)
  for (const key of ['categories', 'blocks', 'tasks', 'events', 'calendarSources'] as const) {
    assertUnique(doc[key].map((item) => item.id), key)
  }
  assertUnique(doc.checkIns.map((item) => item.date), 'checkIns')
  assertUnique(doc.actuals.map((item) => JSON.stringify([item.blockId, Date.parse(item.plannedStartAt)])), 'actuals')
  assertUnique(doc.appliedProposalIds, 'appliedProposalIds')
  const categoryIds = new Set(doc.categories.map((category) => category.id))
  for (const item of [...doc.blocks, ...doc.tasks]) {
    if (!categoryIds.has(item.categoryId)) throw new Error('document.missingCategory')
  }
  // Actuals deliberately retain references to deleted template blocks and categories.
  return doc
}

export function parseDocument(json: string | null | undefined): LoadResult {
  if (json == null) return { kind: 'empty' }
  try {
    const raw: unknown = JSON.parse(json)
    if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && typeof raw.schemaVersion === 'number' && raw.schemaVersion > 2) {
      return { kind: 'unsupported', schemaVersion: raw.schemaVersion }
    }
    return { kind: 'ok', document: validateDocument(raw) }
  } catch (error) {
    return { kind: 'corrupt', raw: json, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function nextRevision(document: PlannerDocument, clock: Clock): PlannerDocument {
  return validateDocument({ ...document, revision: document.revision + 1, updatedAt: clock.now().toISOString() })
}
