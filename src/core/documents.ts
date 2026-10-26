import { MAX_FIXED_MIN, plannerDocumentSchema, SCHEMA_VERSION, type Clock, type LoadResult, type PlannerDocument } from './model'
import { widenToCurrent } from './widening'
import { canonicalJson, sha256 } from './canonical'

export interface DocumentEnvironment {
  now: Date
  timeZone: string
  locale: string
  tutorialCompleted?: boolean
  idGen?: () => string
}

export function createEmptyDocument(env: DocumentEnvironment): PlannerDocument {
  return plannerDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION, workspaceId: (env.idGen ?? (() => crypto.randomUUID()))(),
    revision: 0, generation: 0, updatedAt: env.now.toISOString(),
    settings: { locale: env.locale, timeZone: env.timeZone, weekStartsOn: 1, onboardingDone: env.tutorialCompleted ?? false, theme: 'system' },
    categories: [], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
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
  assertUnique(doc.appliedCaptureIds, 'appliedCaptureIds')
  const categoryIds = new Set(doc.categories.map((category) => category.id))
  for (const item of [...doc.blocks, ...doc.tasks]) {
    // A task without a category fits any free time; only a category that is named has to exist.
    if (item.categoryId !== undefined && !categoryIds.has(item.categoryId)) throw new Error('document.missingCategory')
  }
  // A fixed start is on a date and holds one contiguous interval (tasks design rev 2.1 §6.1).
  for (const task of doc.tasks) {
    if (task.at === undefined) continue
    if (task.dueDate === undefined) throw new Error('task.atNeedsDueDate')
    if (task.durationMin !== undefined && task.durationMin > MAX_FIXED_MIN) throw new Error('task.fixedTooLong')
  }
  // All-day events cover whole local dates with an exclusive end (RFC 5545), so they must span at least one date.
  for (const event of doc.events) {
    if (event.allDay && event.end.slice(0, 10) <= event.start.slice(0, 10)) throw new Error('document.allDayEventWithoutDates')
  }
  // Actuals deliberately retain references to deleted template blocks and categories.
  return doc
}

// A stored document of an older schema version is widened in memory (it stays as stored until its first commit).
export function parseDocument(json: string | null | undefined): LoadResult {
  if (json == null) return { kind: 'empty' }
  try {
    const raw: unknown = JSON.parse(json)
    if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw && typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
      return { kind: 'unsupported', schemaVersion: raw.schemaVersion }
    }
    return { kind: 'ok', document: validateDocument(widenToCurrent(raw)) }
  } catch (error) {
    return { kind: 'corrupt', raw: json, reason: error instanceof Error ? error.message : String(error) }
  }
}

// The generation of a planner that replaces `current` with `incoming` (delete-all, import, restore, recovery).
export function nextGeneration(current: Pick<PlannerDocument, 'generation'> | undefined, incoming: Pick<PlannerDocument, 'generation'>): number {
  return Math.max(current?.generation ?? 0, incoming.generation) + 1
}

export function nextRevision(document: PlannerDocument, clock: Clock): PlannerDocument {
  return validateDocument({ ...document, revision: document.revision + 1, updatedAt: clock.now().toISOString() })
}

// The fingerprint a guarded write compares, in the browser and the companion alike: the hash of the canonical document,
// so one comparison covers workspace, content, generation and a replacement that kept the same revision.
export async function documentFingerprint(document: PlannerDocument): Promise<string> {
  return sha256(canonicalJson(validateDocument(document)))
}
