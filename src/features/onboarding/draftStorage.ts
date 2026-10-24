import type { PlannerDocument } from '@/core/model'
import { isKnownScreen } from './setupFlow'
import type { Answers, CategoryDraft, RangeDraft, SetupState } from './setupModel'
import { cloneState, MAX_NAME_LENGTH } from './setupModel'
import { TOPIC_IDS } from './setupTopics'

// The unfinished setup survives a reload of the tab (sessionStorage). A draft belongs to the exact stored content it was
// started on: when storage no longer holds that, the draft is dropped, never applied to something it was not made for.
const DRAFT_KEY = 'next168-setup-draft'
const TAB_KEY = 'next168-setup-tab'
const DISMISSED_KEY = 'next168-setup-dismissed'
const LEGACY_DRAFT_KEY = 'next168-onboarding-draft'
const LAST_MINUTE = 24 * 60 - 1
// What a finished or discarded draft is overwritten with before it is removed, so a removal that fails can never
// bring the old draft back.
const TOMBSTONE = JSON.stringify({ version: 2, submitted: true })

export type DraftBinding =
  | { kind: 'unsaved'; tabNonce: string }
  | { kind: 'stored'; workspaceId: string; fingerprint: string }

export interface SetupDraft extends SetupState {
  version: 2
  binding: DraftBinding
  // Whether the flow was on screen when the tab went away: a reload then reopens it.
  open: boolean
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function session(): KeyValueStorage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage } catch { return undefined }
}

function local(): KeyValueStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

// One per tab, created on first use: it binds a draft to "storage was proven empty" in this tab only.
export function tabNonce(storage: KeyValueStorage | undefined = session()): string {
  try {
    const existing = storage?.getItem(TAB_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    storage?.setItem(TAB_KEY, fresh)
    return fresh
  } catch {
    return 'no-storage'
  }
}

export function bindingFor(stored: boolean, document: Pick<PlannerDocument, 'workspaceId'>, fingerprint: string, storage?: KeyValueStorage): DraftBinding {
  return stored ? { kind: 'stored', workspaceId: document.workspaceId, fingerprint } : { kind: 'unsaved', tabNonce: tabNonce(storage) }
}

export function sameBinding(a: DraftBinding, b: DraftBinding): boolean {
  if (a.kind === 'unsaved' && b.kind === 'unsaved') return a.tabNonce === b.tabNonce
  if (a.kind === 'stored' && b.kind === 'stored') return a.workspaceId === b.workspaceId && a.fingerprint === b.fingerprint
  return false
}

// ---------- Validation (temporarily invalid input is accepted: a reload mid-edit loses nothing) ----------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isMinute = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= LAST_MINUTE
const TRI = ['unanswered', 'yes', 'no']
const WORK_STUDY = ['unanswered', 'work', 'study', 'both', 'neither']
const LABELS = ['there', 'back', 'weeknights', 'weekend']

function validRange(value: unknown): value is RangeDraft {
  if (!isObject(value)) return false
  const days = value.days
  return typeof value.key === 'string' && value.key !== ''
    && (value.blockId === undefined || (typeof value.blockId === 'string' && value.blockId !== ''))
    && Array.isArray(days) && days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(days).size === days.length
    && isMinute(value.start) && isMinute(value.end)
    && typeof value.accepted === 'boolean' && typeof value.touched === 'boolean'
    && (value.label === undefined || LABELS.includes(value.label as string))
}

function validCategory(value: unknown): value is CategoryDraft {
  if (!isObject(value)) return false
  return typeof value.key === 'string' && value.key !== ''
    && (value.categoryId === undefined || (typeof value.categoryId === 'string' && value.categoryId !== ''))
    && (value.topic === undefined || TOPIC_IDS.includes(value.topic as never))
    && typeof value.name === 'string' && value.name.length <= MAX_NAME_LENGTH
    && typeof value.suggested === 'boolean' && typeof value.removed === 'boolean' && typeof value.keepOverride === 'boolean'
    && Array.isArray(value.ranges) && value.ranges.length <= 50 && value.ranges.every(validRange)
}

function validAnswers(value: unknown, keys: Set<string>): value is Answers {
  if (!isObject(value)) return false
  return TRI.includes(value.sleep as string) && WORK_STUDY.includes(value.workStudy as string) && TRI.includes(value.commute as string) && TRI.includes(value.exercise as string)
    && (value.more === null || (Array.isArray(value.more) && value.more.every((key) => typeof key === 'string' && keys.has(key))))
}

export function parseSetupState(value: unknown): SetupState | null {
  if (!isObject(value) || !Array.isArray(value.categories) || !value.categories.every(validCategory)) return null
  const categories = value.categories as CategoryDraft[]
  const keys = new Set(categories.map((category) => category.key))
  if (keys.size !== categories.length) return null
  if (!validAnswers(value.answers, keys) || typeof value.sleepSplit !== 'boolean' || !Number.isInteger(value.counter) || (value.counter as number) < 0) return null
  const state: SetupState = { screen: 'sleep', answers: value.answers, sleepSplit: value.sleepSplit, categories, counter: value.counter as number }
  if (typeof value.screen !== 'string' || !isKnownScreen(state, value.screen)) return null
  state.screen = value.screen
  return state
}

export function parseDraft(raw: string): SetupDraft | 'submitted' | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!isObject(value) || value.version !== 2) return null
  if (value.submitted === true) return 'submitted'
  const binding = value.binding
  const validBinding = isObject(binding) && (
    (binding.kind === 'unsaved' && typeof binding.tabNonce === 'string')
    || (binding.kind === 'stored' && typeof binding.workspaceId === 'string' && typeof binding.fingerprint === 'string'))
  const state = parseSetupState(value)
  if (!validBinding || !state || typeof value.open !== 'boolean') return null
  return { ...state, version: 2, binding: binding as DraftBinding, open: value.open }
}

// Every stored id in the draft must exist in the baseline, a block under the category it was drafted for; a draft that
// was made on proven-empty storage holds no ids at all.
export function idsMatchBaseline(draft: SetupState, document: PlannerDocument | null, stored: boolean): boolean {
  const ids = draft.categories.flatMap((category) => [category.categoryId, ...category.ranges.map((range) => range.blockId)]).filter((id) => id !== undefined)
  if (!stored || !document) return ids.length === 0
  return draft.categories.every((category) => {
    if (category.categoryId !== undefined && !document.categories.some((candidate) => candidate.id === category.categoryId)) return false
    return category.ranges.every((range) => range.blockId === undefined
      || document.blocks.some((block) => block.id === range.blockId && block.categoryId === category.categoryId))
  })
}

// ---------- Storage ----------

export function draftOf(state: SetupState, binding: DraftBinding, open: boolean): SetupDraft {
  return { ...cloneState(state), version: 2, binding, open }
}

// False when the browser would not keep it (unavailable or full): the flow works on and says so once.
export function saveDraft(draft: SetupDraft, storage: KeyValueStorage | undefined = session()): boolean {
  try {
    if (!storage) return false
    storage.setItem(DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function loadDraft(storage: KeyValueStorage | undefined = session()): SetupDraft | null {
  try {
    storage?.removeItem(LEGACY_DRAFT_KEY)
    const raw = storage?.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = parseDraft(raw)
    if (parsed === null || parsed === 'submitted') {
      if (parsed === null) clearDraft(storage)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// Invalidates the draft first, then tries to remove it: a removal that throws leaves a tombstone, never a stale draft.
export function clearDraft(storage: KeyValueStorage | undefined = session()): void {
  try { storage?.setItem(DRAFT_KEY, TOMBSTONE) } catch { /* Nothing more can be done. */ }
  try { storage?.removeItem(DRAFT_KEY) } catch { /* The tombstone is already in place. */ }
}

// Closing the flow sets this for the workspace, so it does not open by itself again on this device.
export function markDismissed(workspaceKey: string, storage: KeyValueStorage | undefined = local()): void {
  try { storage?.setItem(DISMISSED_KEY, workspaceKey) } catch { /* A reload may offer the flow once more. */ }
}

export function isDismissed(workspaceKey: string, storage: KeyValueStorage | undefined = local()): boolean {
  try { return storage?.getItem(DISMISSED_KEY) === workspaceKey } catch { return false }
}

export function clearDismissed(storage: KeyValueStorage | undefined = local()): void {
  try { storage?.removeItem(DISMISSED_KEY) } catch { /* Harmless. */ }
}
