import { z } from 'zod'

// Contract for planner document schema v2 (docs/architecture/deliverable-1.md §3).
// Slices implement behavior against these schemas; changing them is an architecture change.

export const SCHEMA_VERSION = 2 as const
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

export const taskSchema = z.object({
  id,
  title: text(120),
  categoryId: id,
  durationMin: z.number().int().min(15).max(180),
  dueDate: isoDate.optional(),
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

export const plannerEventSchema = z.object({
  id,
  title: text(120),
  start: isoDateTime,
  end: isoDateTime,
  allDay: z.boolean(),
  location: optionalText(200),
  notes: optionalText(2000),
  attendees: z.array(z.email()).max(50),
}).refine((e) => Date.parse(e.end) > Date.parse(e.start), { message: 'event.endBeforeStart', path: ['end'] })

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

const blockFields = z.object({
  categoryId: id,
  title: text(120),
  notes: optionalText(500),
  days: z.array(dayIndexSchema).min(1).max(7),
  start: minuteSchema,
  end: minuteSchema,
})

export const proposalOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add_block'), block: blockFields }),
  z.object({ op: z.literal('update_block'), id, patch: blockFields.partial() }),
  z.object({ op: z.literal('delete_block'), id }),
  z.object({ op: z.literal('add_task'), task: taskSchema.omit({ id: true, createdAt: true, doneAt: true }) }),
  z.object({ op: z.literal('update_task'), id, patch: taskSchema.omit({ id: true, createdAt: true, doneAt: true }).partial() }),
  z.object({ op: z.literal('complete_task'), id }),
  z.object({ op: z.literal('add_event'), event: z.object({
    title: text(120), start: isoDateTime, end: isoDateTime, allDay: z.boolean(),
    location: optionalText(200), notes: optionalText(2000), attendees: z.array(z.email()).max(50),
  }) }),
  z.object({ op: z.literal('update_category_goal'), id, goal: goalSchema }),
])

export const MAX_OPS_PER_PROPOSAL = 50

// Stored outside the planner document so recording a proposal never changes the content revision.
// ops/baseRevision/contentHash are immutable after creation; status moves pending -> applied|rejected|stale once.
export const changeProposalSchema = z.object({
  id,
  workspaceId: id,
  source: z.enum(['mcp', 'assistant', 'import']),
  clientName: optionalText(80),
  baseRevision: z.number().int().min(0),
  contentHash: z.string().min(16).max(128), // hash of the canonical ops JSON; approval binds to it
  summary: z.string().max(500),
  ops: z.array(proposalOpSchema).min(1).max(MAX_OPS_PER_PROPOSAL),
  status: z.enum(['pending', 'applied', 'rejected', 'stale']),
  createdAt: isoDateTime,
  decidedAt: isoDateTime.optional(),
  appliedRevision: z.number().int().min(0).optional(),
})

// What an assistant (MCP client, on-device model or pasted JSON) may submit.
export const proposalInputSchema = z.object({
  contractVersion: z.literal('1.0'),
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

// Storage keys (browser mode). v1 `next168-data` is read-only migration input and never written.
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
export interface TaskPlacement { taskId: string; chunks: PlacementChunk[]; overflowMinutes: number; late: boolean }
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

// Storage port (D4). Adapters: LocalStorageRepository (browser) and CompanionRepository (HTTP).
export type LoadResult =
  | { kind: 'ok'; document: PlannerDocument; migratedFrom?: number }
  | { kind: 'empty' }
  | { kind: 'corrupt'; raw: string; reason: string }
  | { kind: 'unsupported'; schemaVersion: unknown }

export type SaveResult =
  | { kind: 'ok'; revision: number }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'error'; reason: string }

// save() must be a serialized compare-and-swap: re-read the stored revision inside an exclusive lock
// (Web Locks in browsers, an in-process mutex + atomic rename in the companion), write the backup of the
// previous bytes first, then the new bytes; any failure leaves the previous document intact.
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

export interface ProposalRepository {
  list(status?: ChangeProposal['status']): Promise<ChangeProposal[]>
  create(input: ProposalInput, source: ChangeProposal['source'], clientName?: string): Promise<ChangeProposal>
  // Idempotent: a second approve of an applied proposal returns the recorded result without changing anything.
  approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision>
  reject(id: string): Promise<ProposalDecision>
}
