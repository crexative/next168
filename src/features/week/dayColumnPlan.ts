import { fitPieces, fitTitle, type TextMetrics, type TextPiece, type TitleFit } from './itemText'
import { layoutDaySegments, placeTasks, type BlockSegment, type BusySegment, type LanePosition, type TaskSegment } from './weekLayout'

// One decision for a whole day column (docs/design/visual-design.md › Week items): where every routine, event and task
// goes, and which of its words it draws. DayColumn.vue only draws what this returns.

// Insets in px between an item's box and its text. The component draws the boxes with these values, so the text
// measured here is the text drawn there.
export const LANE_GAP_PX = 2
export const BLOCK_INSET = { top: 2, bottom: 2, start: 7, end: 4 }
// An event keeps 2 px beside its 1 px dashed border: its hatching already sets it apart.
export const BUSY_INSET = { top: 2, bottom: 2, start: 3, end: 3 }
// The task outline sits 4 px in from its routine's edge (clear of its 3 px bar) and 2 px from its end; 1.5 px border,
// 1 px / 2 px padding: narrow lanes keep room for words.
export const TASK_BOX_INSET = { start: 4, end: 2 }
export const TASK_INSET = { top: 2.5, bottom: 2.5, start: 7.5, end: 5.5 }
// A title in the small caption size (`compact` role) in a box too short for a line of its own size is centred with no
// padding above or below: a 20-minute routine (16 px) reads "Desayuno…" instead of a nameless strip. In a taller box
// (a narrow lane) it keeps the box's own insets, at the top.
// A task's outline is 1 px instead of 1.5 px around a title in the small size, so a 20-minute task (16 px) holds one.
export const SMALL_INSET = {
  block: { top: 0, bottom: 0, start: BLOCK_INSET.start, end: BLOCK_INSET.end },
  busy: { top: 1, bottom: 1, start: BUSY_INSET.start, end: BUSY_INSET.end },
  task: { top: 1, bottom: 1, start: TASK_INSET.start - 0.5, end: TASK_INSET.end - 0.5 },
}
export const PIECE_GAP_PX = 1
export const MIN_TASK_PX = 12
export const ICON_PX = 12
// A routine that holds tasks keeps this many title lines above them, more when a hyphenated first word needs them.
export const HOST_TITLE_LINES = 2
export const HOST_TITLE_MAX_LINES = 4
// A task asks for at most this many lines of its title before the tasks under it.
export const TASK_TITLE_LINES = 2
// In the seven-day overview a short item keeps at least this height, as far as the next item in its lane allows.
export const COMPACT_MIN_PX = 8
// Without measurements (no layout engine) a routine keeps one 16 px title line above its tasks.
const UNMEASURED_STRIP_PX = BLOCK_INSET.top + 16 + 2

export interface ColumnMeasure {
  // The day column's width in px.
  width: number
  // What this measure was taken for: the column's width and the root text size ("176.5px 32px", the width to a tenth of a pixel). The column exposes it
  // so a check can tell a plan drawn for the current size from one still waiting for its re-measure.
  basis: string
  metrics: TextMetrics
  // A routine's category mark with the space after it, and a 12 px icon with the space after it.
  markLead: number
  iconLead: number
  // The category glyph a mark shows when its box holds it (a circled initial or emoji in the small mark size).
  glyph: { width: number; height: number }
}

export interface BlockWords { title: string; time: string; category?: string; status?: string }
export interface BusyWords { title: string; conflict?: string }
export interface TaskWords { title: string; late: boolean }

// `text` is the title as drawn: whole, or (when `cut`) its first whole words and the generated "…". Undefined draws the
// whole title. A title may itself contain "…" ("Pausa…"); only `cut` says the plan left words out.
// `small` draws the title in the small caption size, centred (`center`) unless tasks sit under it.
export interface BlockShow { title: boolean; glyph?: boolean; glyphAt?: { top: number; height: number }; text?: string; cut?: boolean; hyphenate?: boolean; small?: boolean; center?: boolean; mark: boolean; time: boolean; category: boolean; status: boolean; statusIcon: boolean }
export interface BusyShow { icon: boolean; glyph?: boolean; word: boolean; title: boolean; text?: string; cut?: boolean; hyphenate?: boolean; small?: boolean }
export interface TaskShow { icon: boolean; glyph?: boolean; title: boolean; text?: string; cut?: boolean; hyphenate?: boolean; small?: boolean }

// `top` and `bottom` are the drawn box in px from the top of the column.
export type PlannedBlock = BlockSegment & LanePosition & { top: number; bottom: number; show: BlockShow }
export type PlannedBusy = BusySegment & LanePosition & { top: number; bottom: number; show: BusyShow }
export interface PlannedTask {
  task: TaskSegment
  // The routine it was fitted into; undefined for a task in free time, which has its own lane.
  hostKey: string | undefined
  left: number
  width: number
  top: number
  bottom: number
  outline: boolean
  show: TaskShow
}

export interface DayColumnPlan { blocks: PlannedBlock[]; busy: PlannedBusy[]; tasks: PlannedTask[] }

export interface DayColumnInput {
  blocks: BlockSegment[]
  busy: BusySegment[]
  tasks: TaskSegment[]
  hourHeight: number
  // The seven-day overview draws shapes only.
  compact: boolean
  // Null until the column has been measured on a page (and where there is no layout engine): every word is drawn.
  measure: ColumnMeasure | null
  words: {
    block(segment: BlockSegment): BlockWords
    busy(item: BusySegment): BusyWords
    task(task: TaskSegment): TaskWords
  }
}

const NOTHING = { block: { title: false, mark: false, time: false, category: false, status: false, statusIcon: false }, busy: { icon: false, word: false, title: false }, task: { icon: false, title: false } }
// A box that draws no words still says something when its room inside `inset` holds the glyph: a blank box never
// appears where a glyph would fit (docs/design/visual-design.md › Week items).
function glyphFits(width: number, height: number, inset: { top: number; bottom: number; start: number; end: number }, measure: ColumnMeasure): boolean {
  return width - inset.start - inset.end >= measure.glyph.width - 0.01 && height - inset.top - inset.bottom >= measure.glyph.height - 0.01
}

// The tallest span of a routine its tasks leave free, relative to its top: where its glyph goes when no word fits.
function freestSpan(top: number, bottom: number, tasks: { top: number; bottom: number }[]): { top: number; height: number } {
  let best = { top: 0, height: 0 }
  let from = top
  for (const task of [...tasks].sort((a, b) => a.top - b.top).concat({ top: bottom, bottom })) {
    if (task.top - from > best.height) best = { top: from - top, height: task.top - from }
    from = Math.max(from, task.bottom)
  }
  return best
}

const EVERYTHING = { block: { title: true, mark: true, time: true, category: true, status: true, statusIcon: true }, busy: { icon: true, word: true, title: true }, task: { icon: true, title: true } }

// A task fits the routine of its category whose occurrence holds it.
export function hostOf<B extends BlockSegment>(task: TaskSegment, blocks: readonly B[]): B | undefined {
  if (task.categoryId === undefined) return undefined
  return blocks.find((block) => block.occurrence.categoryId === task.categoryId && block.startMinute <= task.startMinute && task.endMinute <= block.endMinute)
}

function blockPieces(words: BlockWords, measure: ColumnMeasure): TextPiece[] {
  const pieces: TextPiece[] = [{ text: words.title, role: 'blockTitle', lead: measure.markLead }, { text: words.time, role: 'blockDetail', maxLines: 1 }]
  if (words.category) pieces.push({ text: words.category, role: 'blockDetail' })
  if (words.status) pieces.push({ text: words.status, role: 'caption', lead: measure.iconLead })
  return pieces
}

// Title first (whole, or its first whole words and "…"), then the time, the category and the status, each whole, while
// the box has room. A cut title means the box is full: nothing follows it. A title that does not fit at its own size
// is tried in the small caption size (`small`, one box of `smallBox` with no padding above or below), then the box is a
// mark.
function blockShow(words: BlockWords, box: { width: number; height: number }, smallBox: { width: number; height: number }, center: boolean, measure: ColumnMeasure): BlockShow {
  const pieces = blockPieces(words, measure)
  const title = fitTitle(pieces[0]!, box, measure.metrics)
  if (!title) {
    const small = fitTitle({ text: words.title, role: 'compact' }, smallBox, measure.metrics)
    return small ? { ...NOTHING.block, title: true, text: small.text, cut: small.truncated, hyphenate: small.hyphenated, small: true, center } : NOTHING.block
  }
  const shown: BlockShow = { ...NOTHING.block, title: true, text: title.text, cut: title.truncated, hyphenate: title.hyphenated, mark: title.lead }
  if (title.truncated) return shown
  const rest = fitPieces(pieces.slice(1), { width: box.width, height: box.height - title.lines * measure.metrics.lineHeight('blockTitle') - PIECE_GAP_PX }, measure.metrics, PIECE_GAP_PX)
  const statusIndex = words.category ? 2 : 1
  return {
    ...shown,
    time: rest.length > 0,
    category: Boolean(words.category) && rest.length > 1,
    status: Boolean(words.status) && rest.length > statusIndex,
    // The status icon is drawn only where it was measured; the word alone may fit where icon and word do not.
    statusIcon: Boolean(words.status) && (rest[statusIndex]?.lead ?? false),
  }
}

function titleHeight(fit: TitleFit | null, role: 'blockTitle' | 'taskTitle' | 'compact', measure: ColumnMeasure): number {
  return fit ? fit.lines * measure.metrics.lineHeight(role) : 0
}

// An event's words flow on from its conflict mark: "⚠ Conflict Vendor call", then "⚠ Vendor call", then the title alone,
// each whole first, then the most whole words with "…", then the icon alone. A word not drawn stays in the accessible name.
function busyShow(words: BusyWords, box: { width: number; height: number }, smallBox: { width: number; height: number }, measure: ColumnMeasure): BusyShow {
  const { metrics } = measure
  const options: { lead: number; icon: boolean; word: boolean }[] = words.conflict
    ? [
        { lead: ICON_PX + 2 + metrics.width(words.conflict, 'caption') + metrics.width(' ', 'caption'), icon: true, word: true },
        { lead: measure.iconLead, icon: true, word: false },
        { lead: 0, icon: false, word: false },
      ]
    : [{ lead: 0, icon: false, word: false }]
  const fits = options.map((option) => ({ option, fit: fitTitle({ text: words.title, role: 'caption', lead: option.lead }, box, metrics) }))
  // fitTitle may fall back to no lead; keep only fits that drew the lead they were asked for.
  const honest = fits.filter(({ option, fit }) => fit && fit.lead === option.lead > 0)
  const chosen = honest.find(({ fit }) => !fit!.truncated) ?? honest.find(({ option }) => option.icon) ?? honest[0]
  if (chosen) return { icon: chosen.option.icon, word: chosen.option.word, title: true, text: chosen.fit!.text, cut: chosen.fit!.truncated, hyphenate: chosen.fit!.hyphenated }
  const small = fitTitle({ text: words.title, role: 'compact' }, smallBox, metrics)
  if (small) return { icon: false, word: false, title: true, text: small.text, cut: small.truncated, hyphenate: small.hyphenated, small: true }
  // With no word, a conflict keeps its ⚠ wherever the icon fits, centred in the room inside the small insets; it never
  // takes the plain glyph, which would hide the conflict. Smaller still, the red border and hatching mark it.
  const iconFits = Boolean(words.conflict) && smallBox.width >= ICON_PX - 0.01 && smallBox.height >= ICON_PX - 0.01
  return { icon: iconFits, word: false, title: false }
}

function taskTitle(words: TaskWords, width: number, height: number, measure: ColumnMeasure, small = false): TitleFit | null {
  const inset = small ? SMALL_INSET.task : TASK_INSET
  const box = { width: width - inset.start - inset.end, height: height - inset.top - inset.bottom }
  // A task's title in the small size is never hyphenated: in a task's outline the browser drew it unbroken where a
  // probe of the same text broke it ("Pau-" / "se……"), so it could not be measured reliably.
  return small
    ? fitTitle({ text: words.title, role: 'compact' }, box, { ...measure.metrics, hyphenatedLines: undefined })
    : fitTitle({ text: words.title, role: 'taskTitle', lead: words.late ? measure.iconLead : 0 }, box, measure.metrics)
}

// The heights a task asks for, most to least: up to TASK_TITLE_LINES lines of its title, one line, then one line in the
// small caption size; each only when at least its first word fits the width.
function taskTextHeights(words: TaskWords, width: number, measure: ColumnMeasure): number[] {
  const heights: number[] = []
  for (const lines of [TASK_TITLE_LINES, 1]) {
    const fit = taskTitle(words, width, lines * measure.metrics.lineHeight('taskTitle') + TASK_INSET.top + TASK_INSET.bottom, measure)
    if (fit) heights.push(titleHeight(fit, 'taskTitle', measure) + TASK_INSET.top + TASK_INSET.bottom)
  }
  const small = taskTitle(words, width, measure.metrics.lineHeight('compact') + SMALL_INSET.task.top + SMALL_INSET.task.bottom, measure, true)
  if (small) heights.push(titleHeight(small, 'compact', measure) + SMALL_INSET.task.top + SMALL_INSET.task.bottom)
  return heights
}

function taskShow(words: TaskWords, width: number, height: number, outline: boolean, measure: ColumnMeasure): TaskShow {
  if (outline) return NOTHING.task
  const fit = taskTitle(words, width, height, measure)
  if (fit) return { icon: fit.lead, title: true, text: fit.text, cut: fit.truncated, hyphenate: fit.hyphenated }
  const small = taskTitle(words, width, height, measure, true)
  if (small) return { icon: false, title: true, text: small.text, cut: small.truncated, hyphenate: small.hyphenated, small: true }
  return glyphFits(width, height, SMALL_INSET.task, measure) ? { ...NOTHING.task, glyph: true } : NOTHING.task
}

export function planDayColumn(input: DayColumnInput): DayColumnPlan {
  const { hourHeight, measure, words } = input
  const px = (minute: number) => (minute / 60) * hourHeight
  const hosts = new Map(input.tasks.map((task) => [task, hostOf(task, input.blocks)]))
  const loose = input.tasks.filter((task) => !hosts.get(task)).map((task) => ({ key: task.key, startMinute: task.startMinute, endMinute: task.endMinute, task }))
  const lanes = layoutDaySegments(input.blocks, input.busy, loose)
  const boxWidth = (lane: LanePosition) => measure ? (measure.width * lane.width) / 100 - 2 * LANE_GAP_PX : 0

  if (input.compact) return compactPlan(input, lanes, hosts)

  // Each routine keeps its title lines first; its tasks go below them.
  const titleStrip = new Map<string, number>()
  for (const block of lanes.blocks) {
    if (!measure) { titleStrip.set(block.key, UNMEASURED_STRIP_PX); continue }
    const width = boxWidth(block) - BLOCK_INSET.start - BLOCK_INSET.end
    const room = px(block.endMinute) - px(block.startMinute)
    const piece = blockPieces(words.block(block), measure)[0]!
    // Two lines of the title, more for a hyphenated first word ("Tra-" / "ba-" / "jo…"), else the small caption size.
    const body = (lines: number) => fitTitle(piece, { width, height: Math.min(room - BLOCK_INSET.top - BLOCK_INSET.bottom, lines * measure.metrics.lineHeight('blockTitle')) }, measure.metrics)
    const title = body(HOST_TITLE_LINES) ?? body(HOST_TITLE_MAX_LINES)
    // A routine too short for a line of its own size keeps its small title centred with no padding; its tasks then become
    // one outline around it rather than taking its only line.
    const short = room < BLOCK_INSET.top + measure.metrics.lineHeight('blockTitle') + BLOCK_INSET.bottom
    const smallInset = short ? 0 : BLOCK_INSET.top
    const small = title ? null : fitTitle({ text: piece.text, role: 'compact' }, { width, height: Math.min(room - 2 * smallInset, HOST_TITLE_LINES * measure.metrics.lineHeight('compact')) }, measure.metrics)
    titleStrip.set(block.key, title ? BLOCK_INSET.top + titleHeight(title, 'blockTitle', measure) + PIECE_GAP_PX : small ? smallInset + titleHeight(small, 'compact', measure) + PIECE_GAP_PX : 0)
  }

  // Tasks of one host are placed together: each first gets up to two lines of its title, then one line, then at least
  // MIN_TASK_PX, else they become one outline around the host.
  const tasks: PlannedTask[] = []
  const groups = new Map<string, { bounds: { top: number; bottom: number; strip: number }; lane: LanePosition; hostKey: string; members: TaskSegment[] }>()
  for (const task of input.tasks) {
    const host = hosts.get(task)
    if (host) {
      const lane = lanes.blocks.find((block) => block.key === host.key)!
      const group = groups.get(host.key) ?? { bounds: { top: px(host.startMinute), bottom: px(host.endMinute), strip: titleStrip.get(host.key)! }, lane, hostKey: host.key, members: [] }
      group.members.push(task)
      groups.set(host.key, group)
      continue
    }
    // A task in free time grows only downwards, up to the next item (or task) below it, so it never covers another.
    const lane = lanes.loose.find((item) => item.task === task)!
    const below = [...input.blocks, ...input.busy, ...input.tasks.filter((other) => other !== task && !hosts.get(other))].filter((item) => item.startMinute >= task.endMinute)
    const top = px(task.startMinute)
    const limit = px(Math.min(1440, ...below.map((item) => item.startMinute)))
    const width = boxWidth(lane)
    // Two lines of its title, else one, else one in the small caption size, else MIN_TASK_PX, as far as the free stretch
    // allows.
    const heights = measure ? taskTextHeights(words.task(task), width, measure) : []
    const wanted = top + Math.max(MIN_TASK_PX, heights.find((height) => top + height <= limit) ?? MIN_TASK_PX)
    const bottom = Math.max(px(task.endMinute), Math.min(wanted, limit))
    const show = measure ? taskShow(words.task(task), width, bottom - top, false, measure) : EVERYTHING.task
    tasks.push({ task, hostKey: undefined, left: lane.left, width: lane.width, top, bottom, outline: false, show })
  }
  for (const { bounds, lane, hostKey, members } of groups.values()) {
    const natural = members.map((task) => ({ top: px(task.startMinute), bottom: px(task.endMinute) }))
    const width = boxWidth(lane)
    // Every task's best height first, then its next best, down to MIN_TASK_PX: the first round where all of them fit wins.
    const heights = members.map((task) => measure ? taskTextHeights(words.task(task), width, measure) : [])
    const rounds = Math.max(0, ...heights.map((options) => options.length))
    let boxes = placeTasks(natural, bounds, MIN_TASK_PX)
    for (let round = 0; round < rounds; round++) {
      const tried = placeTasks(natural, bounds, heights.map((options) => Math.max(MIN_TASK_PX, options[Math.min(round, options.length - 1)] ?? MIN_TASK_PX)))
      if (!tried.some((box) => box.outline)) { boxes = tried; break }
    }
    members.forEach((task, index) => {
      const box = boxes[index]!
      const show = measure ? taskShow(words.task(task), width, box.bottom - box.top, box.outline, measure) : EVERYTHING.task
      tasks.push({ task, hostKey, left: lane.left, width: lane.width, top: box.top, bottom: box.bottom, outline: box.outline, show })
    })
  }

  // A routine draws its words only above its first task.
  const blocks = lanes.blocks.map((block): PlannedBlock => {
    const top = px(block.startMinute)
    if (!measure) return { ...block, top, bottom: px(block.endMinute), show: EVERYTHING.block }
    const firstTask = Math.min(...tasks.filter((task) => task.hostKey === block.key && !task.outline).map((task) => task.top))
    const bottom = Number.isFinite(firstTask) ? firstTask - PIECE_GAP_PX : px(block.endMinute) - BLOCK_INSET.bottom
    const box = { width: boxWidth(block) - BLOCK_INSET.start - BLOCK_INSET.end, height: bottom - top - BLOCK_INSET.top }
    // Centred with no padding only in a box too short for one line of the routine's own title size, and with no tasks.
    const short = px(block.endMinute) - top < BLOCK_INSET.top + measure.metrics.lineHeight('blockTitle') + BLOCK_INSET.bottom && !Number.isFinite(firstTask)
    const smallBox = { width: boxWidth(block) - SMALL_INSET.block.start - SMALL_INSET.block.end, height: short ? px(block.endMinute) - top : box.height }
    const show = { ...blockShow(words.block(block), box, smallBox, short, measure) }
    const glyphAt = show.title ? undefined : freestSpan(top, px(block.endMinute), tasks.filter((task) => task.hostKey === block.key && !task.outline))
    if (glyphAt && glyphFits(boxWidth(block), glyphAt.height, SMALL_INSET.block, measure)) Object.assign(show, { glyph: true, glyphAt })
    return { ...block, top, bottom: px(block.endMinute), show }
  })

  const busy = lanes.busy.map((item): PlannedBusy => {
    const drawn = { top: px(item.startMinute), bottom: px(item.endMinute) }
    if (!measure) return { ...item, ...drawn, show: EVERYTHING.busy }
    const box = {
      width: boxWidth(item) - BUSY_INSET.start - BUSY_INSET.end,
      height: px(item.endMinute) - px(item.startMinute) - BUSY_INSET.top - BUSY_INSET.bottom,
    }
    const smallBox = {
      width: boxWidth(item) - SMALL_INSET.busy.start - SMALL_INSET.busy.end,
      height: px(item.endMinute) - px(item.startMinute) - SMALL_INSET.busy.top - SMALL_INSET.busy.bottom,
    }
    const show = { ...busyShow(words.busy(item), box, smallBox, measure) }
    const conflict = Boolean(words.busy(item).conflict)
    if (!show.title && !show.icon && !conflict && glyphFits(boxWidth(item), drawn.bottom - drawn.top, SMALL_INSET.busy, measure)) show.glyph = true
    return { ...item, ...drawn, show }
  })

  return { blocks, busy, tasks }
}

// The overview draws shapes at their times. A short one keeps COMPACT_MIN_PX where the next item in its lane (or, for a
// task, the end of its routine and the next task) leaves room, so no shape is drawn over another.
function compactPlan(input: DayColumnInput, lanes: ReturnType<typeof layoutDaySegments<{ key: string; startMinute: number; endMinute: number; task: TaskSegment }>>, hosts: Map<TaskSegment, BlockSegment | undefined>): DayColumnPlan {
  const px = (minute: number) => (minute / 60) * input.hourHeight
  type Shape = { key: string; left: number; width: number; top: number; bottom: number }
  const shapes: Shape[] = [...lanes.blocks, ...lanes.busy, ...lanes.loose].map((item) => ({ key: item.key, left: item.left, width: item.width, top: px(item.startMinute), bottom: px(item.endMinute) }))
  const grown = (shape: Shape, limit: number) => Math.max(shape.bottom, Math.min(shape.top + COMPACT_MIN_PX, limit))
  const sameLane = (a: { left: number; width: number }, b: { left: number; width: number }) => a.left < b.left + b.width - 1e-9 && b.left < a.left + a.width - 1e-9
  const bottoms = new Map(shapes.map((shape) => {
    const next = Math.min(Infinity, ...shapes.filter((other) => other !== shape && other.top >= shape.bottom - 0.01 && sameLane(shape, other)).map((other) => other.top))
    return [shape.key, grown(shape, Math.min(next, px(1440)))]
  }))
  const tasks: PlannedTask[] = []
  for (const block of lanes.blocks) {
    const held = input.tasks.filter((task) => hosts.get(task)?.key === block.key).sort((a, b) => a.startMinute - b.startMinute)
    held.forEach((task, index) => {
      const top = px(task.startMinute)
      const next = held[index + 1] ? px(held[index + 1]!.startMinute) : Infinity
      const bottom = Math.max(px(task.endMinute), Math.min(top + COMPACT_MIN_PX, next, bottoms.get(block.key)!))
      tasks.push({ task, hostKey: block.key, left: block.left, width: block.width, top, bottom, outline: false, show: NOTHING.task })
    })
  }
  for (const item of lanes.loose) {
    tasks.push({ task: item.task, hostKey: undefined, left: item.left, width: item.width, top: px(item.startMinute), bottom: bottoms.get(item.key)!, outline: false, show: NOTHING.task })
  }
  return {
    blocks: lanes.blocks.map((block) => ({ ...block, top: px(block.startMinute), bottom: bottoms.get(block.key)!, show: NOTHING.block })),
    busy: lanes.busy.map((item) => ({ ...item, top: px(item.startMinute), bottom: bottoms.get(item.key)!, show: NOTHING.busy })),
    tasks,
  }
}
