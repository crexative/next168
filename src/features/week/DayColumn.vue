<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import CategoryMark from '@/ui/CategoryMark.vue'
import Icon from '@/ui/Icon.vue'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale } from '@/ui/format'
import './registerIcons'
import { statusOf } from './blockStatus'
import { categoryColor } from './categoryColor'
import { formatMinute, formatTime } from './localTime'
import { HOUR_HEIGHT_PX, SLOT_MINUTES, STACK_EVENT_INSET_PERCENT, layoutDaySegments, nearestHitTarget, type BlockSegment, type HitTarget, type BusySegment, type DayPart, type LanePosition, type TaskSegment } from './weekLayout'
import type { BusyDetails } from './busyDetails'

const props = withDefaults(defineProps<{
  date: string
  label: string
  segments: BlockSegment[]
  busy: BusySegment[]
  tasks?: TaskSegment[]
  actuals?: BlockActual[]
  categories: Category[]
  timeZone: string
  nowMinute: number | null
  editable: boolean
  hourHeight?: number
  // The whole-week overview: shapes only, the text lives in the accessible names and the legend.
  compact?: boolean
}>(), { tasks: () => [], actuals: () => [], hourHeight: HOUR_HEIGHT_PX, compact: false })
const emit = defineEmits<{ select: [blockId: string]; 'select-task': [taskId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails] }>()

const { t } = useI18n()
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const layout = computed(() => layoutDaySegments(props.segments, props.busy))

// A calendar event conflicts when it overlaps a planned block of the same day.
const conflicting = computed(() => new Set(props.busy
  .filter((item) => item.kind === 'external' && props.segments.some((segment) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute))
  .map((item) => item.key)))

const SHORT_EVENT_MINUTES = 45

// A block's title row; a task that starts with its block begins below it so the title stays readable. A block that
// shares its width (lanes, or an event beside it) wraps its title onto two lines, so the strip holds both.
const TITLE_LINE_PX = 16
const TITLE_STRIP_PX = 4 + TITLE_LINE_PX
const MIN_TASK_PX = 12
// From this height a task chunk shows its title on one caption line; below it the box keeps its title as a tooltip.
const TASK_LABEL_MIN_PX = 16
const TASK_ROOMY_PX = 24

const STATUS_ICON = { done: 'check', skipped: 'x', partial: 'minus' } as const

function verticalStyle(startMinute: number, endMinute: number) {
  return { top: `${(startMinute / 60) * props.hourHeight}px`, height: `${((endMinute - startMinute) / 60) * props.hourHeight}px` }
}

function isBesideEvent(segment: BlockSegment): boolean {
  return props.busy.some((item) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute)
}

function isLaned(segment: BlockSegment & LanePosition): boolean {
  return segment.lanes > 1 || isBesideEvent(segment)
}

function itemStyle(item: DayPart & LanePosition) {
  return {
    ...verticalStyle(item.startMinute, item.endMinute),
    insetInlineStart: `calc(${item.left}% + 2px)`,
    width: `calc(${item.width}% - 4px)`,
    // Used instead of the shared lanes when the column is too narrow for readable lanes (see the container query below).
    '--stack-left': `${item.stackLeft}%`,
    '--stack-width': `${item.stackWidth}%`,
  }
}

function segmentStyle(segment: BlockSegment & LanePosition) {
  return {
    ...itemStyle(segment),
    '--block-color': categoryColor(categoriesById.value.get(segment.occurrence.categoryId)),
    '--block-stroke': categoryStroke(categoriesById.value.get(segment.occurrence.categoryId)),
    '--title-strip': `${STACK_EVENT_INSET_PERCENT}cqw`,
  }
}

const statuses = computed(() => new Map(props.segments.map((segment) => [segment.key, statusOf(props.actuals, segment.occurrence)])))

function statusText(segment: BlockSegment): string | undefined {
  const status = statuses.value.get(segment.key)
  return status ? t(`week.status.${status}`) : undefined
}

function categoryName(segment: BlockSegment): string {
  return categoriesById.value.get(segment.occurrence.categoryId)?.name ?? ''
}

// The accessible name follows the visible text: title, time, the category when it differs from the title, then the status.
function blockLabel(segment: BlockSegment): string {
  const name = categoryName(segment)
  const status = statusText(segment)
  return [segment.occurrence.title, timeRange(segment), name !== segment.occurrence.title ? name : ''].filter(Boolean).join(' ') + (status ? `, ${status}` : '')
}

// A task sits in the lane of the planned block it was fitted into; one that fits any free time has no block around it.
function hostOf(task: TaskSegment) {
  if (task.categoryId === undefined) return undefined
  return layout.value.blocks.find((block) => block.occurrence.categoryId === task.categoryId && block.startMinute <= task.startMinute && task.endMinute <= block.endMinute)
}

// A block whose first half hour already holds a task keeps only its title: the task is drawn under the title row
// and a second line (its time range) would print under the task's own title.
const EARLY_TASK_MINUTES = 30
const crowdedBlocks = computed(() => new Set(props.tasks.flatMap((task) => {
  const host = hostOf(task)
  return host && task.startMinute - host.startMinute < EARLY_TASK_MINUTES ? [host.key] : []
})))

const taskBoxes = computed(() => props.tasks.map((task) => {
  const host = hostOf(task)
  // A task that starts under its block's title begins below the title lines, never over them; a short one keeps at least
  // MIN_TASK_PX and stays inside its block (its exact time is in its accessible name and tooltip).
  const px = (minute: number) => (minute / 60) * props.hourHeight
  const titleStrip = host && isLaned(host) ? TITLE_STRIP_PX + TITLE_LINE_PX : TITLE_STRIP_PX
  const strip = host && !props.compact ? Math.max(0, titleStrip - (px(task.startMinute) - px(host.startMinute))) : 0
  let top = px(task.startMinute) + strip
  let bottom = props.compact ? px(task.endMinute) : Math.max(px(task.endMinute), top + MIN_TASK_PX)
  // A block too short for its title and a task below it is outlined whole instead: the dashed edge says it holds a task
  // and never crosses the title.
  const outline = Boolean(host && !props.compact && px(host.endMinute) - top < MIN_TASK_PX)
  if (host && !props.compact) bottom = Math.min(bottom, px(host.endMinute))
  if (outline) top = px(host!.startMinute)
  const height = bottom - top
  const lanes = host ? itemStyle(host) : { insetInlineStart: '2px', width: 'calc(100% - 4px)', '--stack-left': '0%', '--stack-width': '100%' }
  return {
    task,
    height,
    outline,
    range: `${formatMinute(task.startMinute, displayLocale.value)} – ${formatMinute(task.endMinute % 1440, displayLocale.value)}`,
    style: {
      ...lanes,
      top: `${top}px`,
      height: `${height}px`,
      '--block-color': categoryColor(task.categoryId === undefined ? undefined : categoriesById.value.get(task.categoryId)),
    },
  }
}))

function timeRange(segment: BlockSegment): string {
  const range = `${formatTime(segment.occurrence.start, displayLocale.value, props.timeZone)} – ${formatTime(segment.occurrence.end, displayLocale.value, props.timeZone)}`
  return segment.continuesAfter || segment.continuesBefore ? t('week.grid.crossesMidnight', { range }) : range
}

function inspect(item: BusySegment): void {
  const range = `${formatTime(item.start, displayLocale.value, props.timeZone)} – ${formatTime(item.end, displayLocale.value, props.timeZone)}`
  emit('inspect', {
    title: item.title,
    date: item.date,
    range: item.continuesBefore || item.continuesAfter ? t('week.grid.crossesMidnight', { range }) : range,
    calendar: item.kind === 'event' ? t('week.details.ownEvent') : item.calendar ?? t('week.details.calendarFallback'),
    conflictsWith: props.segments
      .filter((segment) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute)
      .map((segment) => ({ blockId: segment.occurrence.blockId, title: segment.occurrence.title })),
  })
}

// The pressable things of this column with the lane each one occupies, for the 44 px hit rule below.
const hitTargets = computed<HitTarget[]>(() => [
  ...props.tasks.map((task) => {
    const host = hostOf(task)
    return { kind: 'task' as const, id: task.taskId, startMinute: task.startMinute, endMinute: task.endMinute, left: host?.left ?? 0, width: host?.width ?? 100 }
  }),
  ...layout.value.blocks.map((block) => ({ kind: 'block' as const, id: block.occurrence.blockId, startMinute: block.startMinute, endMinute: block.endMinute, left: block.left, width: block.width })),
])

// A press on empty time in the column: close to a short block or task (inside its 44 px target) it opens that one,
// anywhere else it starts a new block.
function onColumnClick(event: MouseEvent, blockId?: string): void {
  if (!props.editable || (!blockId && event.target !== event.currentTarget)) return
  // Native keyboard activation has no pointer coordinates and always opens the focused routine.
  if (blockId && (event.detail === 0 || props.compact)) { emit('select', blockId); return }
  const column = (event.currentTarget as HTMLElement).closest<HTMLElement>('.day-column')!
  const bounds = column.getBoundingClientRect()
  const y = event.clientY - bounds.top
  const hit = props.compact ? undefined : nearestHitTarget(hitTargets.value, y, ((event.clientX - bounds.left) / bounds.width) * 100, props.hourHeight)
  // A press on a routine's own area opens the routine; a task inside it opens only from the task's own box.
  if (hit?.kind === 'task' && !blockId) emit('select-task', hit.id)
  else if (hit?.kind === 'task') emit('select', blockId!)
  else if (hit) emit('select', hit.id)
  else if (blockId) emit('select', blockId)
  else {
    const minute = Math.floor((y / props.hourHeight) * 60 / SLOT_MINUTES) * SLOT_MINUTES
    emit('create', props.date, Math.max(0, Math.min(1440 - SLOT_MINUTES, minute)))
  }
}
</script>

<template>
  <div class="day-column" :class="{ 'is-compact': compact }" :data-date="date" :aria-label="label" role="group" @click="onColumnClick">
    <button
      v-for="item in layout.busy"
      :key="item.key"
      type="button"
      class="busy"
      :class="[`is-${item.kind}`, { 'is-conflict': conflicting.has(item.key), 'is-short': item.endMinute - item.startMinute < SHORT_EVENT_MINUTES }]"
      :style="itemStyle(item)"
      :title="item.title"
      data-testid="busy-overlay"
      @click.stop="inspect(item)"
    >
      <span v-if="conflicting.has(item.key)" class="conflict-mark t-caption" data-testid="calendar-conflict"><Icon name="triangle-alert" :size="12" /><span class="conflict-text">{{ t('week.grid.conflict') }}</span></span>
      <span class="busy-title t-caption">{{ item.title }}</span>
    </button>
    <button
      v-for="segment in layout.blocks"
      :key="segment.key"
      type="button"
      class="block"
      :class="{ 'is-short': segment.endMinute - segment.startMinute < 45, 'is-beside': isBesideEvent(segment), 'is-laned': isLaned(segment), 'is-crowded': crowdedBlocks.has(segment.key), 'is-done': statuses.get(segment.key) === 'done', 'is-skipped': statuses.get(segment.key) === 'skipped', 'continues-before': segment.continuesBefore, 'continues-after': segment.continuesAfter }"
      :style="segmentStyle(segment)"
      :data-block-id="segment.occurrence.blockId"
      :data-start-minute="segment.startMinute"
      :data-end-minute="segment.endMinute"
      :data-status="statuses.get(segment.key)"
      :aria-label="blockLabel(segment)"
      :disabled="!editable"
      :tabindex="compact ? -1 : undefined"
      @click.stop="onColumnClick($event, segment.occurrence.blockId)"
    >
      <span class="block-title"><CategoryMark class="block-mark" :category="categoriesById.get(segment.occurrence.categoryId)" />{{ ' ' }}{{ segment.occurrence.title }}</span>{{ ' ' }}
      <span class="block-time">{{ timeRange(segment) }}</span>{{ ' ' }}
      <span v-if="categoryName(segment) && categoryName(segment) !== segment.occurrence.title" class="block-category">{{ categoryName(segment) }}</span>
      <span v-if="statuses.get(segment.key)" class="block-status t-caption" data-testid="block-status">
        <Icon :name="STATUS_ICON[statuses.get(segment.key)!]" :size="12" /><span class="status-text">{{ statusText(segment) }}</span>
      </span>
    </button>
    <button
      v-for="box in taskBoxes"
      :key="box.task.key"
      type="button"
      class="task-chunk"
      :class="{ 'is-outline': box.outline }"
      :style="box.style"
      data-layered
      data-testid="week-task"
      :data-task-id="box.task.taskId"
      :data-start-minute="box.task.startMinute"
      :data-end-minute="box.task.endMinute"
      :data-late="box.task.late || undefined"
      :aria-label="t('week.task.label', { title: box.task.title, range: box.range }) + (box.task.late ? `, ${t('week.task.late')}` : '')"
      :title="box.task.title"
      :disabled="!editable"
      :tabindex="compact ? -1 : undefined"
      @click.stop="emit('select-task', box.task.taskId)"
    >
      <span class="task-box" :class="{ 'is-late': box.task.late, 'is-tight': box.height < TASK_ROOMY_PX, 'is-outline': box.outline }">
        <Icon v-if="box.task.late && box.height >= TASK_LABEL_MIN_PX && !box.outline" name="triangle-alert" :size="12" />
        <span v-if="box.height >= TASK_LABEL_MIN_PX && !box.outline" class="task-title t-caption">{{ box.task.title }}</span>
      </span>
    </button>
    <div v-if="nowMinute !== null" class="now-line" :style="{ top: `${(nowMinute / 60) * hourHeight}px` }" data-testid="now-line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.day-column {
  
  position: relative;
  height: calc(var(--hour-height) * 24);
  background-image: linear-gradient(to bottom, var(--separator) 0.5px, transparent 0.5px);
  background-size: 100% var(--hour-height);
  border-inline-start: 0.5px solid var(--separator);
  cursor: cell;
  container: day-column / inline-size;
}
.block {
  position: absolute;
  display: flex;
  flex-direction: column;
  /* Lines that do not fit the block's height (large text, short blocks) wrap into a second column outside the
     block and are hidden whole, instead of being cut in half. */
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: flex-start;
  /* The column gap exceeds the inline padding, so a wrapped column never peeks in. */
  gap: 1px var(--space-2);
  overflow: hidden;
  padding: 2px var(--space-1) 2px calc(3px + var(--space-1));
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--block-color) var(--cat-fill-strength), var(--surface));
  color: var(--label);
  text-align: start;
  cursor: pointer;
  transition: transform 0.1s var(--ease-out);
}
.block::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
  background: var(--block-stroke);
}
.block:active { transform: scale(0.97); }
.block:disabled { cursor: default; }
.continues-before { border-start-start-radius: 0; border-start-end-radius: 0; }
.continues-after { border-end-start-radius: 0; border-end-end-radius: 0; }
.block-title { font-size: 0.8125rem; font-weight: 600; line-height: 1.25; }
.block-time { font-size: 0.75rem; line-height: 1.25; font-variant-numeric: tabular-nums; }
.block-category { font-size: 0.75rem; line-height: 1.25; }
.block-title, .block-time, .block-category { flex-shrink: 0; width: 100%; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Labels are drawn above the now-line (z-index 2): the line crosses the fill of a block, never its words. */
.block-title, .block-time, .block-category, .block-status, .task-title { position: relative; z-index: 3; }
.is-crowded .block-time, .is-crowded .block-category { display: none; }
.is-laned .block-mark { display: none; }
/* A block that shares its width wraps its title at word boundaries onto two lines ("Deep / work") instead of cutting it
   to a letter; the task strip under it leaves room for both lines. */
.is-laned:not(.is-short) .block-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: normal;
  overflow-wrap: normal;
  hyphens: auto;
}
.block-mark { margin-inline-end: 1px; }
.is-short { flex-direction: row; gap: var(--space-1); align-items: center; }
.is-short .block-time, .is-short .block-category { display: none; }

.busy {
  position: absolute;
  overflow: hidden;
  padding: 1px var(--space-1);
  border: 1px dashed var(--label-2);
  border-radius: 6px;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 10%, transparent) 0 4px, transparent 4px 8px);
  /* Events paint above planned blocks and tasks and open their details when tapped. */
  z-index: 2;
  color: var(--label);
  text-align: start;
  cursor: pointer;
}
.busy-title { display: block; overflow: hidden; color: var(--label); text-overflow: ellipsis; white-space: nowrap; }
/* An event tall enough for more than one line wraps its title at word boundaries ("Vendor / call"). */
.busy:not(.is-short) .busy-title { white-space: normal; overflow-wrap: normal; hyphens: auto; }
.is-conflict {
  container-type: inline-size;
  border-color: var(--danger);
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 10%, var(--surface)) 0 4px, var(--surface) 4px 8px);
}
.conflict-mark { display: flex; flex: none; align-items: center; gap: 2px; color: var(--danger-label); }
/* Short events fit the mark and the title on one line at the minimum height. */
.busy.is-short { display: flex; align-items: center; gap: var(--space-1); padding-block: 0; }
.busy.is-short .busy-title { flex: 1; min-width: 0; }
/* In a lane too narrow for the word, the icon alone stays; its text remains as the accessible name. */
@container (max-width: 4.5rem) {
  .conflict-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
/* In narrow columns the event band leaves the block's leading title strip available for pointer input. */
@container day-column (max-width: 9.5rem) {
  .block, .busy, .task-chunk {
    inset-inline-start: calc(var(--stack-left) + 2px) !important;
    width: calc(var(--stack-width) - 4px) !important;
  }
  .is-beside .block-time, .is-beside .block-category, .is-beside .block-mark { display: none; }
  .block.is-beside { padding-inline: 3px 0; }
  /* A word is never broken in the middle: in the narrow strip the title is cut with an ellipsis. */
  .is-beside .block-title {
    max-width: calc(var(--title-strip) - 4px);
    min-width: 0;
    overflow-wrap: normal;
    word-break: normal;
  }
  .busy.is-short { gap: 2px; padding-inline: 2px; }
  .busy.is-short .busy-title { text-overflow: clip; }
  /* A one-line band keeps the title; the word lives in the details and the accessible name. */
  .busy.is-short .conflict-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .busy.is-conflict:not(.is-short) { display: flex; flex-direction: column; justify-content: center; }
}
/* A placed task: a dashed outline inside the lane of its block; tapping it opens the task. It has no z-index, so its
   words can be drawn above the now-line while the box stays under it. */
.task-chunk { position: absolute; padding: 0; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
.task-chunk:disabled { cursor: default; }
.task-box {
  position: absolute;
  inset: 0 4px 0 8px;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  overflow: hidden;
  padding: 1px var(--space-1);
  border: 1.5px dashed var(--block-color);
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  color: var(--label);
}
/* Around a block too short to hold it below its title: an outline only, the block's title shows through, and a press
   there opens the routine (the task stays reachable by keyboard here and from Tasks). */
.task-box.is-outline { inset: 1px; background: transparent; }
.task-chunk.is-outline { pointer-events: none; }
/* A chunk of 16 to 24 px: the caption line fills the box between its dashed edges. */
.task-box.is-tight { align-items: center; padding-block: 0; }
.task-box.is-late { border-color: var(--danger); color: var(--danger-label); }
/* One tight caption line, so a 20-minute chunk (16 px) still carries its title. */
.task-title { min-width: 0; overflow: hidden; line-height: 13px; text-overflow: ellipsis; white-space: nowrap; }

.block-status { display: inline-flex; align-items: center; gap: 2px; color: var(--label-2); }
/* One visual, one meaning: done is dimmed with its check mark; only "No" is struck through. */
.block.is-done { opacity: 0.6; }
.is-skipped .block-title { text-decoration: line-through; }
.is-short .status-text, .is-beside .status-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.is-short .block-status { flex: none; }

.is-compact .block { padding: 0; border-radius: 3px; }
/* A short block or commute stays visible instead of shrinking to a sliver. */
.is-compact .block, .is-compact .busy, .is-compact .task-chunk { min-height: 8px; }
.is-compact .block::before { width: 2px; }
.is-compact .block-title, .is-compact .block-time, .is-compact .block-status, .is-compact .conflict-text, .is-compact .busy-title { display: none; }
.is-compact .busy { padding: 0; }
.is-compact .task-box { inset: 0 2px 0 4px; padding: 0; border-width: 1px; }
.is-compact .task-title { display: none; }
.is-compact .now-line::before { display: none; }

.is-beside { padding-block: 1px; gap: 0; }
.is-beside .block-title, .is-beside .block-time { line-height: 1.2; }
.is-beside .block-time { white-space: normal; overflow-wrap: anywhere; }

.now-line {
  position: absolute;
  inset-inline: 0;
  z-index: 2;
  height: 2px;
  margin-top: -1px;
  background: var(--danger);
  pointer-events: none;
}
.now-line::before {
  content: '';
  position: absolute;
  inset-inline-start: -5px;
  top: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--danger);
}

@media (prefers-reduced-motion: reduce) {
  .block:active { transform: none; opacity: 0.7; }
}
</style>
