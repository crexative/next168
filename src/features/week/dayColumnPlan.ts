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
// The task outline sits 8 px in from its routine's bar and 4 px from its end; 1.5 px border, 1 px / 4 px padding.
export const TASK_BOX_INSET = { start: 8, end: 4 }
export const TASK_INSET = { top: 2.5, bottom: 2.5, start: 13.5, end: 9.5 }
export const PIECE_GAP_PX = 1
export const MIN_TASK_PX = 12
export const ICON_PX = 12
// A routine that holds tasks keeps at most this many title lines above them.
export const HOST_TITLE_LINES = 2
// A task asks for at most this many lines of its title before the tasks under it.
export const TASK_TITLE_LINES = 2
// In the seven-day overview a short item keeps at least this height, as far as the next item in its lane allows.
export const COMPACT_MIN_PX = 8
// Without measurements (no layout engine) a routine keeps one 16 px title line above its tasks.
const UNMEASURED_STRIP_PX = BLOCK_INSET.top + 16 + 2

export interface ColumnMeasure {
  // The day column's width in px.
  width: number
  metrics: TextMetrics
  // A routine's category mark with the space after it, and a 12 px icon with the space after it.
  markLead: number
  iconLead: number
}

export interface BlockWords { title: string; time: string; category?: string; status?: string }
export interface BusyWords { title: string; conflict?: string }
export interface TaskWords { title: string; late: boolean }

// `text` is the title as drawn: whole, or its first whole words and "…". Undefined draws the whole title.
export interface BlockShow { title: boolean; text?: string; mark: boolean; time: boolean; category: boolean; status: boolean; statusIcon: boolean }
export interface BusyShow { icon: boolean; word: boolean; title: boolean; text?: string }
export interface TaskShow { icon: boolean; title: boolean; text?: string }

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
const EVERYTHING = { block: { title: true, mark: true, time: true, category: true, status: true, statusIcon: true }, busy: { icon: true, word: true, title: true }, task: { icon: true, title: true } }

// A task fits the routine of its category whose occurrence holds it.
export function hostOf<B extends BlockSegment>(task: TaskSegment, blocks: readonly B[]): B | undefined {
  if (task.categoryId === undefined) return undefined
  return blocks.find((block) => block.occurrence.categoryId === task.categoryId && block.startMinute <= task.startMinute && task.endMinute <= block.endMinute)
}

function blockPieces(words: BlockWords, measure: ColumnMeasure): TextPiece[] {
  const pieces: TextPiece[] = [{ text: words.title, role: 'blockTitle', lead: measure.markLead }, { text: words.time, role: 'blockDetail' }]
  if (words.category) pieces.push({ text: words.category, role: 'blockDetail' })
  if (words.status) pieces.push({ text: words.status, role: 'caption', lead: measure.iconLead })
  return pieces
}

// Title first (whole, or its first whole words and "…"), then the time, the category and the status, each whole, while
// the box has room. A cut title means the box is full: nothing follows it.
function blockShow(words: BlockWords, box: { width: number; height: number }, measure: ColumnMeasure): BlockShow {
  const pieces = blockPieces(words, measure)
  const title = fitTitle(pieces[0]!, box, measure.metrics)
  if (!title) return NOTHING.block
  const shown: BlockShow = { ...NOTHING.block, title: true, text: title.text, mark: title.lead }
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

function titleHeight(fit: TitleFit | null, role: 'blockTitle' | 'taskTitle', measure: ColumnMeasure): number {
  return fit ? fit.lines * measure.metrics.lineHeight(role) : 0
}

// An event's words flow on from its conflict mark: "⚠ Conflict Vendor call", then "⚠ Vendor call", then the title alone,
// each whole first, then the most whole words with "…", then the icon alone. A word not drawn stays in the accessible name.
function busyShow(words: BusyWords, box: { width: number; height: number }, measure: ColumnMeasure): BusyShow {
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
  if (chosen) return { icon: chosen.option.icon, word: chosen.option.word, title: true, text: chosen.fit!.text }
  const iconFits = Boolean(words.conflict) && box.width >= ICON_PX && box.height >= ICON_PX
  return { icon: iconFits, word: false, title: false }
}

function taskTitle(words: TaskWords, width: number, height: number, measure: ColumnMeasure): TitleFit | null {
  const box = { width: width - TASK_INSET.start - TASK_INSET.end, height: height - TASK_INSET.top - TASK_INSET.bottom }
  return fitTitle({ text: words.title, role: 'taskTitle', lead: words.late ? measure.iconLead : 0 }, box, measure.metrics)
}

// The height a task asks for: its whole title on up to TASK_TITLE_LINES lines (or those lines ending in "…"), or one
// line, or undefined when not even its first word fits the width.
function taskTextHeight(words: TaskWords, width: number, measure: ColumnMeasure, lines: number): number | undefined {
  const fit = taskTitle(words, width, lines * measure.metrics.lineHeight('taskTitle') + TASK_INSET.top + TASK_INSET.bottom, measure)
  return fit ? titleHeight(fit, 'taskTitle', measure) + TASK_INSET.top + TASK_INSET.bottom : undefined
}

function taskShow(words: TaskWords, width: number, height: number, outline: boolean, measure: ColumnMeasure): TaskShow {
  if (outline) return NOTHING.task
  const fit = taskTitle(words, width, height, measure)
  return { icon: Boolean(fit?.lead), title: Boolean(fit), text: fit?.text }
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
    const height = Math.min(px(block.endMinute) - px(block.startMinute) - BLOCK_INSET.top - BLOCK_INSET.bottom, HOST_TITLE_LINES * measure.metrics.lineHeight('blockTitle'))
    const title = fitTitle(blockPieces(words.block(block), measure)[0]!, { width, height }, measure.metrics)
    titleStrip.set(block.key, title ? BLOCK_INSET.top + titleHeight(title, 'blockTitle', measure) + PIECE_GAP_PX : 0)
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
    // Two lines of its title, else one, else MIN_TASK_PX, as far as the free stretch allows.
    const heights = measure ? [TASK_TITLE_LINES, 1].map((lines) => taskTextHeight(words.task(task), width, measure, lines)).filter((height): height is number => height !== undefined) : []
    const wanted = top + Math.max(MIN_TASK_PX, heights.find((height) => top + height <= limit) ?? MIN_TASK_PX)
    const bottom = Math.max(px(task.endMinute), Math.min(wanted, limit))
    const show = measure ? taskShow(words.task(task), width, bottom - top, false, measure) : EVERYTHING.task
    tasks.push({ task, hostKey: undefined, left: lane.left, width: lane.width, top, bottom, outline: false, show })
  }
  for (const { bounds, lane, hostKey, members } of groups.values()) {
    const natural = members.map((task) => ({ top: px(task.startMinute), bottom: px(task.endMinute) }))
    const width = boxWidth(lane)
    const needed = (lines: number) => members.map((task) => Math.max(MIN_TASK_PX, (measure ? taskTextHeight(words.task(task), width, measure, lines) : undefined) ?? MIN_TASK_PX))
    let boxes = placeTasks(natural, bounds, needed(TASK_TITLE_LINES))
    if (boxes.some((box) => box.outline)) boxes = placeTasks(natural, bounds, needed(1))
    if (boxes.some((box) => box.outline)) boxes = placeTasks(natural, bounds, MIN_TASK_PX)
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
    return { ...block, top, bottom: px(block.endMinute), show: blockShow(words.block(block), box, measure) }
  })

  const busy = lanes.busy.map((item): PlannedBusy => {
    const drawn = { top: px(item.startMinute), bottom: px(item.endMinute) }
    if (!measure) return { ...item, ...drawn, show: EVERYTHING.busy }
    const box = {
      width: boxWidth(item) - BUSY_INSET.start - BUSY_INSET.end,
      height: px(item.endMinute) - px(item.startMinute) - BUSY_INSET.top - BUSY_INSET.bottom,
    }
    return { ...item, ...drawn, show: busyShow(words.busy(item), box, measure) }
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
