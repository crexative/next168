import { fitPieces, fittedHeight, lineCount, type PieceFit, type TextMetrics, type TextPiece } from './itemText'
import { layoutDaySegments, placeTasks, type BlockSegment, type BusySegment, type LanePosition, type TaskSegment } from './weekLayout'

// One decision for a whole day column (docs/design/visual-design.md › Week items): where every routine, event and task
// goes, and which of its words it draws. DayColumn.vue only draws what this returns.

// Insets in px between an item's box and its text. The component draws the boxes with these values, so the text
// measured here is the text drawn there.
export const LANE_GAP_PX = 2
export const BLOCK_INSET = { top: 2, bottom: 2, start: 7, end: 4 }
export const BUSY_INSET = { top: 2, bottom: 2, start: 5, end: 5 }
// The task outline sits 8 px in from its routine's bar and 4 px from its end; 1.5 px border, 1 px / 4 px padding.
export const TASK_BOX_INSET = { start: 8, end: 4 }
export const TASK_INSET = { top: 2.5, bottom: 2.5, start: 13.5, end: 9.5 }
export const PIECE_GAP_PX = 1
export const MIN_TASK_PX = 12
export const ICON_PX = 12
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

export interface BlockShow { title: boolean; mark: boolean; time: boolean; category: boolean; status: boolean }
export interface BusyShow { icon: boolean; word: boolean; title: boolean }
export interface TaskShow { icon: boolean; title: boolean }

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

const NOTHING = { block: { title: false, mark: false, time: false, category: false, status: false }, busy: { icon: false, word: false, title: false }, task: { icon: false, title: false } }
const EVERYTHING = { block: { title: true, mark: true, time: true, category: true, status: true }, busy: { icon: true, word: true, title: true }, task: { icon: true, title: true } }

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

function blockShow(words: BlockWords, fits: readonly PieceFit[]): BlockShow {
  const category = Boolean(words.category) && fits.length > 2
  return {
    title: fits.length > 0,
    mark: fits[0]?.lead ?? false,
    time: fits.length > 1,
    category,
    status: Boolean(words.status) && fits.length > (words.category ? 3 : 2),
  }
}

// An event's words flow on from its conflict mark: "⚠ Conflict Vendor call", then "⚠ Vendor call", then the title alone,
// then the icon alone. The word stays in the accessible name when it is not drawn.
function busyShow(words: BusyWords, box: { width: number; height: number }, measure: ColumnMeasure): BusyShow {
  const { metrics } = measure
  const fits = (lead: number) => {
    const lines = lineCount({ text: words.title, role: 'caption', lead }, box.width, metrics)
    return lines !== null && lines * metrics.lineHeight('caption') <= box.height + 0.01
  }
  if (words.conflict) {
    const wordLead = ICON_PX + 2 + metrics.width(words.conflict, 'caption') + metrics.width(' ', 'caption')
    if (fits(wordLead)) return { icon: true, word: true, title: true }
    if (fits(measure.iconLead)) return { icon: true, word: false, title: true }
  }
  if (fits(0)) return { icon: false, word: false, title: true }
  const iconFits = Boolean(words.conflict) && box.width >= ICON_PX && box.height >= ICON_PX
  return { icon: iconFits, word: false, title: false }
}

// The height a task's own title needs in a box of `width` px, or undefined when the title cannot fit that width.
function taskTextHeight(words: TaskWords, width: number, measure: ColumnMeasure): number | undefined {
  const piece: TextPiece = { text: words.title, role: 'taskTitle', lead: words.late ? measure.iconLead : 0 }
  const textWidth = width - TASK_INSET.start - TASK_INSET.end
  const lines = lineCount(piece, textWidth, measure.metrics) ?? lineCount({ ...piece, lead: 0 }, textWidth, measure.metrics)
  return lines === null ? undefined : lines * measure.metrics.lineHeight('taskTitle') + TASK_INSET.top + TASK_INSET.bottom
}

function taskShow(words: TaskWords, width: number, height: number, outline: boolean, measure: ColumnMeasure): TaskShow {
  if (outline) return NOTHING.task
  const box = { width: width - TASK_INSET.start - TASK_INSET.end, height: height - TASK_INSET.top - TASK_INSET.bottom }
  const fit = fitPieces([{ text: words.title, role: 'taskTitle', lead: words.late ? measure.iconLead : 0 }], box, measure.metrics)[0]
  return { icon: Boolean(fit?.lead), title: Boolean(fit) }
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
    const pieces = blockPieces(words.block(block), measure)
    const width = boxWidth(block) - BLOCK_INSET.start - BLOCK_INSET.end
    const height = px(block.endMinute) - px(block.startMinute) - BLOCK_INSET.top - BLOCK_INSET.bottom
    const title = fitPieces(pieces.slice(0, 1), { width, height }, measure.metrics, PIECE_GAP_PX)
    titleStrip.set(block.key, title.length ? BLOCK_INSET.top + fittedHeight(pieces, title, measure.metrics) + PIECE_GAP_PX : 0)
  }

  // Tasks of one host are placed together: each first gets the height its title needs, then at least MIN_TASK_PX,
  // else they become one outline around the host.
  const tasks: PlannedTask[] = []
  const groups = new Map<string, { bounds: { top: number; bottom: number; strip: number }; lane: LanePosition; hostKey?: string; members: TaskSegment[] }>()
  for (const task of input.tasks) {
    const host = hosts.get(task)
    if (host) {
      const lane = lanes.blocks.find((block) => block.key === host.key)!
      const group = groups.get(host.key) ?? { bounds: { top: px(host.startMinute), bottom: px(host.endMinute), strip: titleStrip.get(host.key)! }, lane, hostKey: host.key, members: [] }
      group.members.push(task)
      groups.set(host.key, group)
      continue
    }
    // A task in free time grows only within the free stretch around it, never into the item before or after.
    const lane = lanes.loose.find((item) => item.task === task)!
    const others = [...input.blocks, ...input.busy]
    const top = Math.max(0, ...others.filter((item) => item.endMinute <= task.startMinute).map((item) => item.endMinute))
    const bottom = Math.min(1440, ...others.filter((item) => item.startMinute >= task.endMinute).map((item) => item.startMinute))
    const key = `free@${top}-${bottom}@${lane.left}`
    const group = groups.get(key) ?? { bounds: { top: px(top), bottom: px(bottom), strip: 0 }, lane, members: [] }
    group.members.push(task)
    groups.set(key, group)
  }
  for (const { bounds, lane, hostKey, members } of groups.values()) {
    const natural = members.map((task) => ({ top: px(task.startMinute), bottom: px(task.endMinute) }))
    const width = boxWidth(lane)
    const needed = members.map((task) => {
      const height = measure ? taskTextHeight(words.task(task), width, measure) : undefined
      return Math.max(MIN_TASK_PX, height ?? MIN_TASK_PX)
    })
    let boxes = placeTasks(natural, bounds, needed)
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
    const pieces = blockPieces(words.block(block), measure)
    const box = { width: boxWidth(block) - BLOCK_INSET.start - BLOCK_INSET.end, height: bottom - top - BLOCK_INSET.top }
    return { ...block, top, bottom: px(block.endMinute), show: blockShow(words.block(block), fitPieces(pieces, box, measure.metrics, PIECE_GAP_PX)) }
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
