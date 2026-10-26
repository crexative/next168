import { z } from 'zod'

// Contract for planner document schema v3 (docs/architecture/deliverable-1.md §3; tasks design rev 2.1 §5 and
// addendum 6.1). Slices implement behavior against these schemas; changing them is an architecture change.
// A stored v2 document is widened in memory on every load (core/migrations.ts) and written as v3 on its first commit.

export const SCHEMA_VERSION = 3 as const
export const MINUTES_PER_DAY = 1440
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY
export const TOTAL_WEEK_HOURS = 168

const id = z.string().min(1).max(64)
const text = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) => z.string().max(max).optional()
const isoDate = z.iso.date()
const isoDateTime = z.iso.datetime({ offset: true })

export const minuteSchema = z.number().int().min(0).max(MINUTES_PER_DAY - 1)
export const dayIndexSchema = z.number().int().min(0).max(6)

export const COLOR_KEYS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow', 'red', 'gray'] as const
export const colorKeySchema = z.enum(COLOR_KEYS)

export const goalSchema = z.object({
  type: z.enum(['max', 'min', 'none']),
  hoursPerWeek: z.number().min(0).max(TOTAL_WEEK_HOURS),
})

export const categorySchema = z.object({
  id,
  name: text(60),
  colorKey: colorKeySchema,
  customColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // preserved legacy v1 hex; overrides colorKey when present
  icon: optionalText(16),
  goal: goalSchema,
})

export const timeBlockSchema = z.object({
  id,
  categoryId: id,
  title: text(120), // v1 accepted 100; keep headroom so migration is lossless
  notes: optionalText(500),
  days: z.array(dayIndexSchema).min(1).max(7),
  start: minuteSchema,
  end: minuteSchema,
}).refine((b) => b.start !== b.end, { message: 'block.zeroLength', path: ['end'] })
  .refine((b) => new Set(b.days).size === b.days.length, { message: 'block.duplicateDays', path: ['days'] })

// Task lengths: a flexible task is total effort, placed in pieces of at most MAX_FLEX_MIN_PER_DAY per local date; a
// task with a fixed start (`at`, on its `dueDate`) is one contiguous interval of at most MAX_FIXED_MIN elapsed minutes.
// No duration is a to-do: it is never placed and never overflows.
export const MIN_TASK_MIN = 5
export const MAX_TASK_MIN = 1260
export const MAX_FIXED_MIN = 720
export const MAX_FLEX_MIN_PER_DAY = 180

export const taskSchema = z.object({
  id,
  title: text(120),
  categoryId: id.optional(),
  durationMin: z.number().int().min(MIN_TASK_MIN).max(MAX_TASK_MIN).optional(),
  dueDate: isoDate.optional(),
  at: minuteSchema.optional(), // a one-off fixed start on dueDate (validateDocument: needs dueDate, at most MAX_FIXED_MIN)
  notes: optionalText(2000), // never read by any AI (core/aiProjection.ts)
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  doneAt: isoDateTime.optional(),
  createdAt: isoDateTime,
})

export const checkInSchema = z.object({
  date: isoDate,
  bedtime: minuteSchema.optional(),
  wake: minuteSchema.optional(),
  workEnd: minuteSchema.optional(),
  exercise: z.enum(['yes', 'no', 'not-planned']).optional(),
  stress: z.number().int().min(1).max(5).optional(),
  note: optionalText(280),
})

// A dated occurrence snapshot: history stays correct after the template block is edited or deleted.
// plannedMinutes = elapsed minutes between the zoned instants (handles overnight and DST).
// Counted minutes: done = plannedMinutes; partial = actualMinutes (required, <= plannedMinutes); skipped = 0.
// Unique per (blockId, plannedStartAt); `date` is the local date the occurrence starts on.
export const blockActualSchema = z.object({
  date: isoDate,
  blockId: id,
  categoryId: id,
  plannedStartAt: isoDateTime,
  plannedEndAt: isoDateTime,
  plannedMinutes: z.number().int().min(1).max(MINUTES_PER_DAY + 60),
  status: z.enum(['done', 'partial', 'skipped']),
  actualMinutes: z.number().int().min(0).max(MINUTES_PER_DAY + 60).optional(),
}).refine((a) => Math.round((Date.parse(a.plannedEndAt) - Date.parse(a.plannedStartAt)) / 60000) === a.plannedMinutes, { message: 'actual.plannedMinutesMismatch', path: ['plannedMinutes'] })
  .refine((a) => a.status !== 'partial' || (a.actualMinutes !== undefined && a.actualMinutes <= a.plannedMinutes), { message: 'actual.partialNeedsMinutes', path: ['actualMinutes'] })

export const plannerEventFields = z.object({
  id,
  title: text(120),
  start: isoDateTime,
  end: isoDateTime,
  allDay: z.boolean(),
  location: optionalText(200),
  notes: optionalText(2000),
  attendees: z.array(z.email()).max(50),
})
export const plannerEventSchema = plannerEventFields.refine((e) => Date.parse(e.end) > Date.parse(e.start), { message: 'event.endBeforeStart', path: ['end'] })

export const calendarSourceSchema = z.object({
  id,
  name: text(80),
  kind: z.enum(['file', 'url']),
  url: z.url({ protocol: /^(https?|webcal)$/ }).optional(),
  colorKey: colorKeySchema,
  lastSyncedAt: isoDateTime.optional(),
  lastError: optionalText(200),
})

// Derived on demand from the stored source text for a requested range; never persisted in the document.
// Identity = sourceId + uid + recurrenceId. allDay events use local dates and an exclusive end date.
export interface ExternalOccurrence {
  sourceId: string
  uid: string
  recurrenceId?: string
  title: string
  start: string // ISO instant, or YYYY-MM-DD when allDay
  end: string   // exclusive
  allDay: boolean
  busy: boolean
}

// A routine block's fields without its id and without the cross-field checks (zero length, duplicate days).
export const blockFields = z.object({
  categoryId: id,
  title: text(120),
  notes: optionalText(500),
  days: z.array(dayIndexSchema).min(1).max(7),
  start: minuteSchema,
  end: minuteSchema,
})

// AI contract 1.1 (tasks design rev 2.1 §11.2, rev 4 §2.2, rev 5 §2.4): the only contract. Every op and every object in
// it is strict, so an unknown or forbidden key (an `authority`, a `human`, notes on a task update) is rejected, never
// stripped. Contract 1.0 records stay readable history (legacy/v2.ts) and never execute.
export const CONTRACT_VERSION = '1.1' as const
const strictGoal = z.strictObject(goalSchema.shape)
// A category the proposal creates. Its `ref` is a temporary id chosen by the assistant (for example "new-sleep"):
// later ops in the SAME proposal use it wherever a category id goes (categoryId, update_category_goal.id), and the
// app gives the category its real id and an unused palette colour when the person approves.
export const newCategorySchema = z.strictObject({ name: text(60), goal: strictGoal.optional() })
const categoryRef = id.describe('Temporary id of the new category; later ops in this proposal use it as categoryId')
// A task without a category fits any free time: an assistant leaves it out rather than inventing a category for it.
export const ANY_FREE_TIME_TASK = 'Optional. Leave it out for a task that fits any free time; never create a category only to hold a task'
const strictBlockFields = z.strictObject(blockFields.shape)
const taskDuration = z.number().int().min(MIN_TASK_MIN).max(MAX_TASK_MIN)
// A new task: notes may be written by an assistant (they are never read back by one); a fixed start needs a due date and
// holds at most MAX_FIXED_MIN.
const newTaskFields = z.strictObject({
  title: text(120),
  categoryId: id.optional().describe(ANY_FREE_TIME_TASK),
  durationMin: taskDuration.optional().describe('Optional. Leave it out for a to-do with no time'),
  dueDate: isoDate.optional(),
  at: minuteSchema.optional().describe('Optional fixed start, minutes after local midnight of dueDate; needs dueDate'),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  notes: optionalText(2000),
}).superRefine((task, context) => {
  if (task.at !== undefined && task.dueDate === undefined) context.addIssue({ code: 'custom', message: 'task.atNeedsDueDate', path: ['at'] })
  if (task.at !== undefined && task.durationMin !== undefined && task.durationMin > MAX_FIXED_MIN) context.addIssue({ code: 'custom', message: 'task.fixedTooLong', path: ['durationMin'] })
})
// What an update may set, and what it may clear. Notes, completion and identity can never be patched by an assistant.
export const TASK_UNSET_KEYS = ['categoryId', 'dueDate', 'at', 'durationMin'] as const
const taskPatch = z.strictObject({
  title: text(120).optional(), categoryId: id.optional(), durationMin: taskDuration.optional(), dueDate: isoDate.optional(),
  at: minuteSchema.optional(), priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
})
const updateTask = z.strictObject({
  op: z.literal('update_task'), id, patch: taskPatch, unset: z.array(z.enum(TASK_UNSET_KEYS)).max(TASK_UNSET_KEYS.length).optional(),
}).superRefine((op, context) => {
  for (const key of op.unset ?? []) if (op.patch[key] !== undefined) context.addIssue({ code: 'custom', message: 'proposal.patchAndUnset', path: ['unset'] })
  if (new Set(op.unset ?? []).size !== (op.unset ?? []).length) context.addIssue({ code: 'custom', message: 'proposal.duplicateUnset', path: ['unset'] })
})

export const proposalOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add_category'), ref: categoryRef, category: newCategorySchema }),
  z.strictObject({ op: z.literal('add_block'), block: strictBlockFields }),
  z.strictObject({ op: z.literal('update_block'), id, patch: strictBlockFields.partial() }),
  z.strictObject({ op: z.literal('delete_block'), id }),
  z.strictObject({ op: z.literal('add_task'), task: newTaskFields }),
  updateTask,
  z.strictObject({ op: z.literal('complete_task'), id }),
  z.strictObject({ op: z.literal('add_event'), event: z.strictObject({
    title: text(120), start: isoDateTime, end: isoDateTime, allDay: z.boolean(),
    location: optionalText(200), notes: optionalText(2000), attendees: z.array(z.email()).max(50),
  }) }),
  z.strictObject({ op: z.literal('update_category_goal'), id, goal: strictGoal }),
])

// Room for a whole week moved in at once (categories, goals, one op per routine range and the tasks) even when an
// assistant does not group days; the review sheet groups the changes, and staging stays linear in the op count.
export const MAX_OPS_PER_PROPOSAL = 200

// Stored outside the planner document so recording a proposal never changes the content revision.
// ops/baseRevision/effectiveDate/contentHash are immutable after creation; status moves pending -> applied|rejected|stale once.
// `effectiveDate`: the local date of `createdAt` in the planner's zone; preview and approval both run with it.
export const changeProposalSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  id,
  workspaceId: id,
  source: z.enum(['mcp', 'assistant', 'import']),
  clientName: optionalText(80),
  baseRevision: z.number().int().min(0),
  effectiveDate: isoDate,
  contentHash: z.string().min(16).max(128), // sha256 of canonical {contractVersion, effectiveDate, ops}; approval binds to it
  summary: z.string().max(500),
  ops: z.array(proposalOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL),
  status: z.enum(['pending', 'applied', 'rejected', 'stale']),
  createdAt: isoDateTime,
  decidedAt: isoDateTime.optional(),
  appliedRevision: z.number().int().min(0).optional(),
})

// What an assistant (MCP client, on-device model or pasted JSON) may submit.
export const proposalInputSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  workspaceId: id, // must equal the target document's workspaceId; never relabelled
  baseRevision: z.number().int().min(0),
  summary: z.string().max(500),
  ops: z.array(proposalOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL),
})

export const settingsSchema = z.object({
  locale: z.string().min(2).max(10),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  timeZone: z.string().min(1).max(64),
  onboardingDone: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
})

export const plannerDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  workspaceId: id,                    // random per workspace; imports keep it, proposals bind to it
  revision: z.number().int().min(0),  // content revision: +1 on every committed content change
  // +1 on every write that replaces the whole planner (delete-all, import, backup restore, recovery): an Undo receipt
  // bound to an earlier generation never applies to identical content that came back by a replacement.
  generation: z.number().int().min(0),
  updatedAt: isoDateTime,
  settings: settingsSchema,
  categories: z.array(categorySchema).max(100),
  blocks: z.array(timeBlockSchema).max(1000),
  tasks: z.array(taskSchema).max(5000),
  checkIns: z.array(checkInSchema).max(3660),
  actuals: z.array(blockActualSchema).max(50000),
  events: z.array(plannerEventSchema).max(5000),
  calendarSources: z.array(calendarSourceSchema).max(20),
  // Idempotency record committed atomically with the content change it caused (last 200 kept).
  // Approving a proposal whose id is already here only repairs its status; it never re-applies.
  appliedProposalIds: z.array(id).max(200),
  // The same for person submissions (a capture preview, a step append, an Undo): an attempt whose id is here was
  // committed, so a retry after a lost response reads its result instead of applying it again.
  appliedCaptureIds: z.array(id).max(200),
})

// Transfer bundle for export/import between origins, modes and devices (§7 #7, #10).
export const exportBundleSchema = z.object({
  format: z.literal('next168-export'),
  bundleVersion: z.literal(1),
  exportedAt: isoDateTime,
  document: plannerDocumentSchema,
  calendarSourceTexts: z.record(z.string(), z.string().max(5 * 1024 * 1024)), // sourceId -> raw ICS
})
export type ExportBundle = z.infer<typeof exportBundleSchema>

export type Minute = z.infer<typeof minuteSchema>
export type DayIndex = z.infer<typeof dayIndexSchema>
export type ColorKey = z.infer<typeof colorKeySchema>
export type Goal = z.infer<typeof goalSchema>
export type Category = z.infer<typeof categorySchema>
export type TimeBlock = z.infer<typeof timeBlockSchema>
export type Task = z.infer<typeof taskSchema>
export type CheckIn = z.infer<typeof checkInSchema>
export type BlockActual = z.infer<typeof blockActualSchema>
export type PlannerEvent = z.infer<typeof plannerEventSchema>
export type CalendarSource = z.infer<typeof calendarSourceSchema>
export type ProposalOp = z.infer<typeof proposalOpSchema>
export type ChangeProposal = z.infer<typeof changeProposalSchema>
export type ProposalInput = z.infer<typeof proposalInputSchema>
export type Settings = z.infer<typeof settingsSchema>
export type PlannerDocument = z.infer<typeof plannerDocumentSchema>

// Legacy localStorage keys (import input only, removed by delete-all; never written) and the commit lock name.
// The browser planner itself lives in IndexedDB `next168` (src/repositories/indexedDbStore.ts).
export const STORAGE_KEYS = {
  legacyV1: 'next168-data',
  document: 'next168-v2',
  backup: 'next168-v2-backup',
  proposals: 'next168-v2-proposals',
  lockName: 'next168-commit',
} as const

export interface Clock { now(): Date }

// Scheduler contract (core/scheduler.ts), consumed by Today (S1) and Tasks (S2).
export interface PlacementChunk { start: string; end: string } // ISO instants, half-open; derive local display values
// outsideCategory: the task's category blocks could not hold it before its due date, so it went to free time instead
// (a category is a preference, not a wall, when the deadline is at stake).
// fixed: a one-off fixed start (`at`) with a duration, one contiguous chunk. at: the instant of a fixed start without a
// duration (a point: no chunk, nothing reserved). key: what the placement was made for (scheduling.placementKey); a
// shown placement is reused only for the same key.
export interface TaskPlacement {
  taskId: string; chunks: PlacementChunk[]; overflowMinutes: number; late: boolean; outsideCategory?: true
  fixed?: true; at?: string; key?: string
}
export interface BusyInterval { start: string; end: string } // ISO instants, half-open

export interface ScheduleInput {
  document: PlannerDocument
  busy: BusyInterval[]
  now: Date
  timeZone: string
  days?: number // default 7
}
// core/scheduler.ts: export function scheduleTasks(input: ScheduleInput): TaskPlacement[]

// Raw calendar source text, one adapter per mode: IndexedDB `next168-calendars` (browser) and
// `~/.next168/calendars/<sourceId>.ics` via `/api/calendars/:id` (companion). Included in ExportBundle.
export interface CalendarSourceStore {
  get(sourceId: string): Promise<string | undefined>
  put(sourceId: string, icsText: string): Promise<void>
  delete(sourceId: string): Promise<void>
  list(): Promise<string[]>
}

// Storage port (D4). Adapters: BrowserPlannerRepository (IndexedDB) and CompanionRepository (HTTP).
export type LoadResult =
  | { kind: 'ok'; document: PlannerDocument; migratedFrom?: number }
  // Nothing stored. `document`: the unsaved planner that pending proposals were made against (browser only).
  | { kind: 'empty'; document?: PlannerDocument }
  | { kind: 'corrupt'; raw: string; reason: string }
  | { kind: 'unsupported'; schemaVersion: unknown }

export type SaveResult =
  | { kind: 'ok'; revision: number }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'error'; reason: string }

// save() must be a serialized compare-and-swap: re-read the stored revision inside an exclusive lock
// (Web Locks in browsers, an in-process mutex + atomic rename in the companion), write the backup of the
// previous bytes and the new bytes atomically; any failure leaves the previous document intact.
export interface PlannerRepository {
  load(): Promise<LoadResult>
  save(document: PlannerDocument, expectedRevision: number): Promise<SaveResult>
  subscribe(onExternalChange: () => void): () => void
}

export type ProposalDecision =
  | { kind: 'applied'; revision: number }
  | { kind: 'rejected' }
  | { kind: 'stale'; currentRevision: number }
  | { kind: 'not-found' }

export interface ProposalCreateOptions {
  clientName?: string
  // The planner the proposal was made against, as the person sees it. Used only while nothing is stored yet, so a
  // proposal can be made on a new, still unsaved planner; a stored planner always wins.
  basis?: PlannerDocument
}

// Everything the proposals store holds: contract 1.1 proposals, contract 1.0 history (never executed) and quarantined
// records (raw text, never executed, projected or sent to an AI).
export interface ProposalHistory {
  proposals: ChangeProposal[]
  legacy: import('./legacy/v2').LegacyChangeProposal[]
  quarantine: string[]
}

export interface ProposalRepository {
  list(status?: ChangeProposal['status']): Promise<ChangeProposal[]>
  history(): Promise<ProposalHistory>
  create(input: ProposalInput, source: ChangeProposal['source'], options?: ProposalCreateOptions): Promise<ChangeProposal>
  // Idempotent: a second approve of an applied proposal returns the recorded result without changing anything.
  approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision>
  reject(id: string): Promise<ProposalDecision>
}
