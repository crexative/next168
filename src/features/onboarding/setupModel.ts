import { MINUTES_PER_DAY, MINUTES_PER_WEEK, type DayIndex, type Goal, type PlannerDocument, type TimeBlock } from '@/core/model'
import { occurrences, overlaps } from '@/core/time'
import {
  COMMUTE_FALLBACK, EXTRA_TOPICS, OWN_DEFAULT, STUDY_WITH_WORK, TOPICS, TOPIC_IDS, type GoalKind, type TopicId, type TopicRange,
} from './setupTopics'

// The guided setup's draft: everything a person has answered, in a shape that survives a reload. Pure data and pure
// functions, so the whole flow is testable without a screen.

export type Tri = 'unanswered' | 'yes' | 'no'
export type WorkStudy = 'unanswered' | 'work' | 'study' | 'both' | 'neither'
export type RangeLabel = 'there' | 'back' | 'weeknights' | 'weekend'
export type ScreenId =
  | 'sleep' | 'workStudy' | 'work' | 'study' | 'commute' | 'commuteRanges' | 'exercise' | 'exerciseRanges' | 'more' | 'summary'
  | `extra:${string}`

export interface Answers { sleep: Tri; workStudy: WorkStudy; commute: Tri; exercise: Tri; more: string[] | null }

export interface RangeDraft {
  key: string
  // The stored block this range edits; absent for a range the flow adds.
  blockId?: string
  // Sleep ranges list nights (the evening a sleep starts); every other range lists the days it starts on.
  days: DayIndex[]
  start: number
  end: number
  // True once the person edited it, left its screen forward, or it came from a stored block: it never moves again.
  accepted: boolean
  // Edited in this session: only touched or new ranges can block a save.
  touched: boolean
  // The person picked the end in this session: moving the start then leaves it where they put it.
  endSet?: boolean
  label?: RangeLabel
}

export interface CategoryDraft {
  // A topic's id, or "custom:<n>" for a category of the person's own.
  key: string
  categoryId?: string
  topic?: TopicId
  name: string
  ranges: RangeDraft[]
  // The default range was already offered (or the category came with blocks): it is never offered again.
  suggested: boolean
  removed: boolean
  // "Undo" on a category an answer removed: it stays whatever the answers say.
  keepOverride: boolean
}

export interface SetupState {
  screen: ScreenId
  answers: Answers
  sleepSplit: boolean
  categories: CategoryDraft[]
  counter: number
}

export interface SetupEnv {
  topicName(topic: TopicId): string
}

export const MAX_NAME_LENGTH = 60
const SLEEP_NIGHT_CUTOFF = 6 * 60
const WINDOW_END = 22 * 60
const STEP = 30

export function emptyState(): SetupState {
  return { screen: 'sleep', answers: { sleep: 'unanswered', workStudy: 'unanswered', commute: 'unanswered', exercise: 'unanswered', more: null }, sleepSplit: false, categories: [], counter: 0 }
}

// The draft is plain JSON; cloning through JSON also strips any reactive proxy the screens wrapped it in.
export function cloneState<T extends SetupState>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

export function nextKey(state: SetupState, prefix: string): string {
  state.counter += 1
  return `${prefix}${state.counter}`
}

// ---------- Sleep: nights and blocks ----------

export interface Slot { days: DayIndex[]; start: number; end: number }

const wrapDay = (day: number) => (((day % 7) + 7) % 7) as DayIndex

// A sleep that starts after midnight (before 06:00) belongs to the night before: the block's day is the next one.
export function sleepToBlock(slot: Slot): Slot {
  return { days: slot.start < SLEEP_NIGHT_CUTOFF ? slot.days.map((day) => wrapDay(day + 1)) : [...slot.days], start: slot.start, end: slot.end }
}

export function blockToSleep(slot: Slot): Slot {
  return { days: slot.start < SLEEP_NIGHT_CUTOFF ? slot.days.map((day) => wrapDay(day - 1)) : [...slot.days], start: slot.start, end: slot.end }
}

// What a range occupies in the stored week.
export function blockSlot(category: CategoryDraft, range: RangeDraft): Slot {
  const slot = { days: range.days, start: range.start, end: range.end }
  return category.topic === 'sleep' ? sleepToBlock(slot) : slot
}

// ---------- Which categories count ----------

export function triOf(state: SetupState, category: CategoryDraft): Tri {
  const { answers } = state
  switch (category.topic) {
    case 'sleep': return answers.sleep
    case 'work': return answers.workStudy === 'unanswered' ? 'unanswered' : answers.workStudy === 'work' || answers.workStudy === 'both' ? 'yes' : 'no'
    case 'study': return answers.workStudy === 'unanswered' ? 'unanswered' : answers.workStudy === 'study' || answers.workStudy === 'both' ? 'yes' : 'no'
    // The commute question is only asked after work or study; without it the answer sleeps.
    case 'commute': return ['work', 'study', 'both'].includes(answers.workStudy) ? answers.commute : 'unanswered'
    case 'exercise': return answers.exercise
    default: return answers.more === null ? 'unanswered' : answers.more.includes(category.key) ? 'yes' : 'no'
  }
}

export type CategoryStatus = 'active' | 'removed' | 'inactive'

// Active categories produce data; removed ones are taken out of the week; inactive ones (never answered, or answered
// "no" and never stored) produce nothing. A stored category nobody answered about stays as it is.
export function statusOf(state: SetupState, category: CategoryDraft): CategoryStatus {
  if (category.removed) return 'removed'
  const stored = category.categoryId !== undefined
  if (stored && category.keepOverride) return 'active'
  const tri = triOf(state, category)
  if (tri === 'yes') return 'active'
  if (tri === 'no') return stored ? 'removed' : 'inactive'
  return stored ? 'active' : 'inactive'
}

export const activeCategories = (state: SetupState): CategoryDraft[] => state.categories.filter((category) => statusOf(state, category) === 'active')
export const categoryOf = (state: SetupState, key: string): CategoryDraft | undefined => state.categories.find((category) => category.key === key)

export interface ActiveRange { category: CategoryDraft; range: RangeDraft; slot: Slot }

export function activeRanges(state: SetupState): ActiveRange[] {
  return activeCategories(state).flatMap((category) => category.ranges.map((range) => ({ category, range, slot: blockSlot(category, range) })))
}

// ---------- Time arithmetic ----------

function asBlock(slot: Slot): TimeBlock {
  return { id: 'slot', categoryId: 'slot', title: 'slot', days: [...new Set(slot.days)], start: slot.start, end: slot.end }
}

export function slotsOverlap(a: Slot, b: Slot): boolean {
  if (a.days.length === 0 || b.days.length === 0 || a.start === a.end || b.start === b.end) return false
  return overlaps(asBlock(a), asBlock(b))
}

export function slotMinutes(slot: Slot): number {
  if (slot.days.length === 0 || slot.start === slot.end) return 0
  return occurrences(asBlock(slot)).reduce((sum, interval) => sum + interval.end - interval.start, 0)
}

// Minutes of the week that at least one slot covers, each minute once.
export function coveredMinutes(slots: readonly Slot[]): number {
  const covered = new Uint8Array(MINUTES_PER_WEEK)
  for (const slot of slots) {
    if (slot.days.length === 0 || slot.start === slot.end) continue
    for (const interval of occurrences(asBlock(slot))) covered.fill(1, interval.start, Math.min(interval.end, MINUTES_PER_WEEK))
  }
  return covered.reduce((sum, minute) => sum + minute, 0)
}

export function categoryMinutes(state: SetupState, category: CategoryDraft): number {
  return category.ranges.reduce((sum, range) => sum + slotMinutes(blockSlot(category, range)), 0)
}

export interface WeekTotals { covered: number; summed: number; overlapping: boolean }

export function weekTotals(state: SetupState): WeekTotals {
  const slots = activeRanges(state).map((item) => item.slot)
  const covered = coveredMinutes(slots)
  const summed = slots.reduce((sum, slot) => sum + slotMinutes(slot), 0)
  return { covered, summed, overlapping: summed > covered }
}

// ---------- Suggestions ----------

// A suggestion that overlaps nothing stays. Otherwise it keeps its days and length and tries later starts in 30-minute
// steps while it ends by 22:00, then starts from 06:00 up to its own start. Nothing fits: it stays and says so.
export function placeSlot(slot: Slot, taken: readonly Slot[]): { slot: Slot; clash: boolean } {
  const free = (candidate: Slot) => !taken.some((other) => slotsOverlap(candidate, other))
  if (free(slot)) return { slot, clash: false }
  if (slot.end > slot.start) {
    const length = slot.end - slot.start
    const attempts: number[] = []
    for (let start = slot.start + STEP; start + length <= WINDOW_END; start += STEP) attempts.push(start)
    for (let start = 6 * 60; start < slot.start; start += STEP) if (start + length <= WINDOW_END) attempts.push(start)
    for (const start of attempts) {
      const candidate = { days: slot.days, start, end: start + length }
      if (free(candidate)) return { slot: candidate, clash: false }
    }
  }
  return { slot, clash: true }
}

function takenSlots(state: SetupState): Slot[] {
  return activeRanges(state).map((item) => item.slot)
}

function newRange(state: SetupState, slot: Slot, extra: Partial<RangeDraft> = {}): RangeDraft {
  return { key: nextKey(state, 'r'), days: [...slot.days].sort((a, b) => a - b), start: slot.start, end: slot.end, accepted: false, touched: false, ...extra }
}

export function ensureCategory(state: SetupState, key: string, topic: TopicId | undefined, name: string): CategoryDraft {
  let category = categoryOf(state, key)
  if (!category) {
    category = { key, topic, name, ranges: [], suggested: false, removed: false, keepOverride: false }
    state.categories.push(category)
  }
  return category
}

function defaultsFor(state: SetupState, topic: TopicId | undefined): TopicRange[] {
  if (topic === undefined) return [OWN_DEFAULT]
  if (topic === 'study' && state.answers.workStudy === 'both') return [STUDY_WITH_WORK]
  return TOPICS[topic].defaults
}

// Offers a category's default ranges once, placed clear of everything active at that moment.
export function suggestRanges(state: SetupState, category: CategoryDraft): void {
  if (category.suggested) return
  category.suggested = true
  if (category.topic === 'commute') return
  const taken = takenSlots(state)
  for (const base of defaultsFor(state, category.topic)) {
    const { slot } = placeSlot({ days: base.days, start: base.start, end: base.end }, taken)
    category.ranges.push(newRange(state, slot))
    taken.push(category.topic === 'sleep' ? sleepToBlock(slot) : slot)
  }
}

// ---------- Commute ----------

const norm = (week: number) => ((week % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK

export interface CommuteRange { days: DayIndex[]; start: number; end: number; label: 'there' | 'back' }

// Going starts 30 minutes before the first work (else study) range starts; coming back starts when it ends. Each runs on a
// 10080-minute circular week, so a night shift's return lands on the next day and a trip before midnight on the day before.
export function deriveCommute(base: Slot | undefined): CommuteRange[] {
  if (!base) {
    return [
      { days: [...COMMUTE_FALLBACK.days], start: COMMUTE_FALLBACK.there.start, end: COMMUTE_FALLBACK.there.end, label: 'there' },
      { days: [...COMMUTE_FALLBACK.days], start: COMMUTE_FALLBACK.back.start, end: COMMUTE_FALLBACK.back.end, label: 'back' },
    ]
  }
  const length = (base.end - base.start + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const result: CommuteRange[] = []
  for (const label of ['there', 'back'] as const) {
    const byMinute = new Map<number, DayIndex[]>()
    for (const day of base.days) {
      const from = norm(day * MINUTES_PER_DAY + base.start + (label === 'there' ? -30 : length))
      const list = byMinute.get(from % MINUTES_PER_DAY) ?? []
      list.push(Math.floor(from / MINUTES_PER_DAY) as DayIndex)
      byMinute.set(from % MINUTES_PER_DAY, list)
    }
    for (const [start, days] of byMinute) result.push({ days: days.sort((a, b) => a - b), start, end: (start + 30) % MINUTES_PER_DAY, label })
  }
  return result
}

export function commuteBase(state: SetupState): Slot | undefined {
  for (const topic of ['work', 'study'] as const) {
    const category = state.categories.find((candidate) => candidate.topic === topic && statusOf(state, candidate) === 'active')
    const range = category?.ranges[0]
    if (range) return { days: range.days, start: range.start, end: range.end }
  }
  return undefined
}

export function suggestCommute(state: SetupState, category: CategoryDraft): void {
  if (category.suggested) return
  category.suggested = true
  for (const item of deriveCommute(commuteBase(state))) category.ranges.push(newRange(state, item, { label: item.label }))
}

// Called when a screen is about to be shown: its category exists and has offered its default ranges.
export function prepareScreen(state: SetupState, screen: ScreenId, env: SetupEnv): void {
  const topic = (['sleep', 'work', 'study', 'exercise'] as const).find((candidate) => candidate === screen || (candidate === 'exercise' && screen === 'exerciseRanges'))
  if (topic) suggestRanges(state, ensureCategory(state, topic, topic, env.topicName(topic)))
  if (screen === 'commuteRanges') suggestCommute(state, ensureCategory(state, 'commute', 'commute', env.topicName('commute')))
  if (screen.startsWith('extra:')) {
    const category = categoryOf(state, screen.slice('extra:'.length))
    if (category) suggestRanges(state, category)
  }
}

// ---------- Sleep split ----------

const WEEKEND_NIGHTS: DayIndex[] = [5, 6]
const WEEKNIGHTS: DayIndex[] = [0, 1, 2, 3, 4]

export function setSleepSplit(state: SetupState, split: boolean): void {
  const sleep = categoryOf(state, 'sleep')
  state.sleepSplit = split
  if (!sleep) return
  const first = sleep.ranges[0]
  if (split) {
    const bed = first?.start ?? TOPICS.sleep.defaults[0]!.start
    const wake = first?.end ?? TOPICS.sleep.defaults[0]!.end
    sleep.ranges = [
      newRange(state, { days: WEEKNIGHTS, start: bed, end: wake }, { label: 'weeknights', touched: true, accepted: true }),
      newRange(state, { days: WEEKEND_NIGHTS, start: 0, end: 8 * 60 }, { label: 'weekend', touched: true, accepted: true }),
    ]
  } else if (first) {
    sleep.ranges = [{ ...first, days: [0, 1, 2, 3, 4, 5, 6], label: undefined, touched: true, accepted: true }]
  }
}

// ---------- Validation ----------

export type IssueCode = 'noDays' | 'sameTime' | 'overlap' | 'nameRequired' | 'nameDuplicate'

export interface Issue {
  code: IssueCode
  categoryKey: string
  rangeKey?: string
  // For an overlap: the other range's category and its slot.
  with?: { categoryKey: string; slot: Slot }
}

// What is wrong with one range, whether or not it blocks a save: shown live on the range itself.
export function rangeProblem(state: SetupState, category: CategoryDraft, range: RangeDraft): Issue | undefined {
  if (range.days.length === 0) return { code: 'noDays', categoryKey: category.key, rangeKey: range.key }
  if (range.start === range.end) return { code: 'sameTime', categoryKey: category.key, rangeKey: range.key }
  const slot = blockSlot(category, range)
  const clash = activeRanges(state).find((other) => other.range.key !== range.key && slotsOverlap(slot, other.slot))
  return clash ? { code: 'overlap', categoryKey: category.key, rangeKey: range.key, with: { categoryKey: clash.category.key, slot: clash.slot } } : undefined
}

// Blocking issues apply only to what this session adds or edits. Stored content that was never touched is left alone.
export function validate(state: SetupState, storedNames: ReadonlyMap<string, string>): Issue[] {
  const issues: Issue[] = []
  const names = activeCategories(state).map((category) => ({ key: category.key, name: category.name.trim().toLowerCase() }))
  for (const category of activeCategories(state)) {
    const renamed = category.categoryId === undefined || category.name.trim() !== (storedNames.get(category.categoryId) ?? category.name.trim())
    if (renamed) {
      if (category.name.trim() === '') issues.push({ code: 'nameRequired', categoryKey: category.key })
      else if (names.some((other) => other.key !== category.key && other.name === category.name.trim().toLowerCase())) {
        issues.push({ code: 'nameDuplicate', categoryKey: category.key })
      }
    }
    for (const range of category.ranges) {
      if (range.blockId !== undefined && !range.touched) continue
      const problem = rangeProblem(state, category, range)
      if (problem) issues.push(problem)
    }
  }
  return issues
}

// ---------- Goals ----------

// A new category never starts out failing its own goal: "at least" and "at most" both follow what its ranges give.
export function automaticGoal(kind: GoalKind, minutes: number): Goal {
  if (kind === 'none') return { type: 'none', hoursPerWeek: 0 }
  const hours = Math.min(168, kind === 'min' ? Math.floor(minutes / 60) : Math.ceil(minutes / 60))
  return hours >= 1 ? { type: kind, hoursPerWeek: hours } : { type: 'none', hoursPerWeek: 0 }
}

// ---------- Pre-fill from what is stored ----------

function topicOf(category: PlannerDocument['categories'][number], taken: Set<TopicId>, env: SetupEnv): TopicId | undefined {
  const byIcon = TOPIC_IDS.find((topic) => !taken.has(topic) && category.icon === TOPICS[topic].icon)
  if (byIcon) return byIcon
  const name = category.name.trim().toLowerCase()
  return TOPIC_IDS.find((topic) => !taken.has(topic) && (name === env.topicName(topic).toLowerCase() || name === topic))
}

export function createState(document: PlannerDocument | null, env: SetupEnv): SetupState {
  const state = emptyState()
  if (!document) return state
  const taken = new Set<TopicId>()
  for (const category of document.categories) {
    const topic = topicOf(category, taken, env)
    if (topic) taken.add(topic)
    const key = topic ?? nextKey(state, 'custom:')
    const draft: CategoryDraft = { key, categoryId: category.id, topic, name: category.name, ranges: [], suggested: true, removed: false, keepOverride: false }
    for (const block of document.blocks.filter((candidate) => candidate.categoryId === category.id)) {
      const slot = topic === 'sleep' ? blockToSleep(block) : block
      draft.ranges.push({ key: nextKey(state, 'r'), blockId: block.id, days: [...slot.days], start: slot.start, end: slot.end, accepted: true, touched: false })
    }
    state.categories.push(draft)
  }
  state.sleepSplit = (categoryOf(state, 'sleep')?.ranges.length ?? 0) > 1
  return state
}

// ---------- Editing helpers the screens use ----------

// Moving the start keeps the range's length, the end moving with it, unless the person picked the end themselves. A range
// never crosses midnight by itself: only one that already does, or one that may (sleep), or an end the person picks.
export function touch(range: RangeDraft, change: Partial<Pick<RangeDraft, 'days' | 'start' | 'end'>>, mayCrossMidnight = false): void {
  const next: Partial<RangeDraft> = { ...change, accepted: true, touched: true }
  if (change.end !== undefined) next.endSet = true
  else if (change.start !== undefined) next.end = endAfterMovingStart(range, change.start, mayCrossMidnight || crossesMidnight(range))
  Object.assign(range, next)
}

// An end exactly at midnight closes the day; only an end after it, earlier than the start, goes on into the next one.
const crossesMidnight = (range: RangeDraft) => range.end !== 0 && range.end < range.start

function endAfterMovingStart(range: RangeDraft, start: number, crosses: boolean): number {
  if (range.endSet && (crosses || start < range.end)) return range.end
  const end = start + (range.end - range.start + MINUTES_PER_DAY) % MINUTES_PER_DAY
  if (end < MINUTES_PER_DAY) return end
  // Past midnight: a night range goes on into the next day; any other range stops at midnight.
  return crosses ? end - MINUTES_PER_DAY : 0
}

export function addRange(state: SetupState, category: CategoryDraft): RangeDraft {
  const base: TopicRange = category.topic === 'commute'
    ? { days: COMMUTE_FALLBACK.days, ...COMMUTE_FALLBACK.there }
    : (category.topic ? defaultsFor(state, category.topic)[0] : undefined) ?? OWN_DEFAULT
  // Sleep is already in nights and crosses midnight, so it is offered as it is; everything else is placed clear of the week.
  const slot = category.topic === 'sleep' ? base : placeSlot(base, takenSlots(state)).slot
  const range = newRange(state, slot, { accepted: true, touched: true })
  category.ranges.push(range)
  return range
}

export function removeRange(category: CategoryDraft, rangeKey: string): void {
  category.ranges = category.ranges.filter((range) => range.key !== rangeKey)
}

export function acceptRanges(category: CategoryDraft): void {
  for (const range of category.ranges) range.accepted = true
}

export function addOwnCategory(state: SetupState, name: string): { category: CategoryDraft; duplicate: boolean } {
  const trimmed = name.trim()
  const same = trimmed === '' ? undefined : state.categories.find((category) => category.name.trim().toLowerCase() === trimmed.toLowerCase() && statusOf(state, category) !== 'removed')
  if (same) return { category: same, duplicate: true }
  const category = ensureCategory(state, nextKey(state, 'custom:'), undefined, trimmed)
  return { category, duplicate: false }
}

export function setAnswer<K extends keyof Answers>(state: SetupState, key: K, value: Answers[K]): void {
  state.answers[key] = value
}

// "No fixed time": the category stays, with no ranges, and its defaults are not offered again.
export function clearRanges(category: CategoryDraft): void {
  category.ranges = []
  category.suggested = true
}

export function renameDraft(category: CategoryDraft, name: string): void {
  category.name = name.slice(0, MAX_NAME_LENGTH)
}

export function setRemoved(state: SetupState, key: string, removed: boolean): void {
  const category = categoryOf(state, key)
  if (!category) return
  category.removed = removed
  // "Undo" on a stored category an answer had removed: the person's undo outranks the answer.
  if (!removed && category.categoryId !== undefined) category.keepOverride = true
}

// What the "more" chips show: the answer once given, otherwise the extras and own categories already stored.
export function moreSelection(state: SetupState): string[] {
  return state.answers.more ?? state.categories
    .filter((category) => category.categoryId !== undefined && !category.removed && (category.topic === undefined || EXTRA_TOPICS.includes(category.topic)))
    .map((category) => category.key)
}

export function toggleMore(state: SetupState, key: string, env: SetupEnv): void {
  const selected = moreSelection(state)
  if ((EXTRA_TOPICS as string[]).includes(key)) ensureCategory(state, key, key as TopicId, env.topicName(key as TopicId))
  state.answers.more = selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]
}

// "Something else" on the "more" screen, or "Add something else" in the summary (with an empty name to type).
export function addOwnToMore(state: SetupState, name: string): { category: CategoryDraft; duplicate: boolean } {
  const selected = moreSelection(state)
  const result = addOwnCategory(state, name)
  if (!selected.includes(result.category.key)) state.answers.more = [...selected, result.category.key]
  return result
}

export { EXTRA_TOPICS }
