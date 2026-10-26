<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import CategoryMark from '@/ui/CategoryMark.vue'
import Icon from '@/ui/Icon.vue'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale, rangeText } from '@/ui/format'
import './registerIcons'
import { statusOf } from './blockStatus'
import { categoryColor } from './categoryColor'
import { formatMinute, formatTime } from './localTime'
import { useColumnMeasure } from './columnMeasure'
import { ELLIPSIS } from './itemText'
import { BLOCK_INSET, LANE_GAP_PX, SMALL_INSET, planDayColumn, type PlannedBlock, type PlannedBusy, type PlannedTask } from './dayColumnPlan'
import { hitAreas, sharedTargets, type Box, type PressItem } from './hitAreas'
import type { PressOption } from './pressOption'
import { HOUR_HEIGHT_PX, SLOT_MINUTES, type BlockSegment, type BusySegment, type TaskSegment } from './weekLayout'
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
const emit = defineEmits<{ select: [blockId: string]; 'select-task': [taskId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails]; choose: [options: PressOption[]] }>()

const { t } = useI18n()
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))

const root = ref<HTMLElement | null>(null)
const probes = ref<HTMLElement | null>(null)
const measure = useColumnMeasure(root, probes, () => !props.compact)

// A calendar event conflicts when it overlaps a planned block of the same day; one marked free never does.
const conflicting = computed(() => new Set(props.busy
  .filter((item) => item.kind === 'external' && !item.free && props.segments.some((segment) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute))
  .map((item) => item.key)))

const STATUS_ICON = { done: 'check', skipped: 'x', partial: 'minus' } as const

const statuses = computed(() => new Map(props.segments.map((segment) => [segment.key, statusOf(props.actuals, segment.occurrence)])))

function statusText(segment: BlockSegment): string | undefined {
  const status = statuses.value.get(segment.key)
  return status ? t(`week.status.${status}`) : undefined
}

function categoryName(segment: BlockSegment): string {
  return categoriesById.value.get(segment.occurrence.categoryId)?.name ?? ''
}

// The category is shown when it says more than the title.
function categoryLine(segment: BlockSegment): string | undefined {
  const name = categoryName(segment)
  return name && name !== segment.occurrence.title ? name : undefined
}

// The accessible name follows the visible text: title, time, the category when it differs from the title, then the status.
function blockLabel(segment: BlockSegment): string {
  const status = statusText(segment)
  return [segment.occurrence.title, timeRange(segment), categoryLine(segment) ?? ''].filter(Boolean).join(' ') + (status ? `, ${status}` : '')
}

function taskRange(task: TaskSegment): string {
  return rangeText(formatMinute(task.startMinute, displayLocale.value), formatMinute(task.endMinute % 1440, displayLocale.value))
}

// Where every item goes and which of its words it draws: one decision for the whole column (dayColumnPlan.ts).
const plan = computed(() => planDayColumn({
  blocks: props.segments,
  busy: props.busy,
  tasks: props.tasks,
  hourHeight: props.hourHeight,
  compact: props.compact,
  measure: measure.value,
  words: {
    block: (segment) => ({ title: segment.occurrence.title, time: timeRange(segment), category: categoryLine(segment), status: statusText(segment) }),
    busy: (item) => ({ title: item.title, conflict: conflicting.value.has(item.key) ? t('week.grid.conflict') : undefined }),
    task: (task) => ({ title: task.title, late: task.late }),
  },
}))

// A title the plan cut after its last whole word: the words, and whether the generated "…" follows. It is drawn in an
// element of its own marked `data-cut`, apart from the words, so it is never confused with a "…" that belongs to the
// title ("Pausa…") and the visible words stay a prefix of the accessible name.
function drawn(show: { text?: string; cut?: boolean }, full: string): { words: string; cut: boolean } {
  if (!show.cut || !show.text) return { words: show.text ?? full, cut: false }
  return { words: show.text.slice(0, -ELLIPSIS.length), cut: true }
}

// The room the guard checks a word against in a box drawn with no text: the insets of the small caption size.
const insetAttribute = (inset: { top: number; end: number; bottom: number; start: number }) => `${inset.top} ${inset.end} ${inset.bottom} ${inset.start}`
const SMALL_INSETS = { block: insetAttribute(SMALL_INSET.block), busy: insetAttribute(SMALL_INSET.busy), task: insetAttribute(SMALL_INSET.task) }

// A box with no words shows its category's glyph centred in the room inside its small-caption insets; `border` is the
// width of the box's own border, which the absolutely placed glyph sits inside.
function glyphSlot(inset: { top: number; end: number; bottom: number; start: number }, border = 0) {
  return { top: `${inset.top - border}px`, bottom: `${inset.bottom - border}px`, insetInlineStart: `${inset.start - border}px`, insetInlineEnd: `${inset.end - border}px` }
}

// A glyph scaled down to a box shorter than it (dayColumnPlan.ts › glyphScale): the small mark size times the scale.
function glyphSize(show: { glyphScale?: number }) {
  return show.glyphScale !== undefined && show.glyphScale < 1 ? { fontSize: `calc(0.6875rem * ${show.glyphScale})` } : {}
}

function verticalStyle(item: { top: number; bottom: number }) {
  return { top: `${item.top}px`, height: `${item.bottom - item.top}px` }
}

function laneStyle(lane: { left: number; width: number }) {
  return { insetInlineStart: `calc(${lane.left}% + ${LANE_GAP_PX}px)`, width: `calc(${lane.width}% - ${2 * LANE_GAP_PX}px)` }
}

function segmentStyle(segment: PlannedBlock) {
  return {
    ...verticalStyle(segment),
    ...laneStyle(segment),
    // A box that draws no words needs no inset; without it a lane narrower than the inset stays inside its lane.
    padding: props.compact || !segment.show.title ? '0' : segment.show.center
      ? `${SMALL_INSET.block.top}px ${SMALL_INSET.block.end}px ${SMALL_INSET.block.bottom}px ${SMALL_INSET.block.start}px`
      : `${BLOCK_INSET.top}px ${BLOCK_INSET.end}px ${BLOCK_INSET.bottom}px ${BLOCK_INSET.start}px`,
    '--block-color': categoryColor(categoriesById.value.get(segment.occurrence.categoryId)),
    '--block-stroke': categoryStroke(categoriesById.value.get(segment.occurrence.categoryId)),
  }
}

function busyStyle(item: PlannedBusy) {
  return { ...verticalStyle(item), ...laneStyle(item), padding: item.show.title || item.show.icon ? undefined : '0' }
}

function taskStyle(planned: PlannedTask) {
  const task = planned.task
  return {
    ...laneStyle(planned),
    top: `${planned.top}px`,
    height: `${planned.bottom - planned.top}px`,
    '--block-color': categoryColor(task.categoryId === undefined ? undefined : categoriesById.value.get(task.categoryId)),
  }
}

function timeRange(segment: BlockSegment): string {
  const range = rangeText(formatTime(segment.occurrence.start, displayLocale.value, props.timeZone), formatTime(segment.occurrence.end, displayLocale.value, props.timeZone))
  return segment.continuesAfter || segment.continuesBefore ? t('week.grid.crossesMidnight', { range }) : range
}

function inspect(item: BusySegment): void {
  emit('inspect', {
    title: item.title,
    date: item.date,
    range: busyRange(item),
    calendar: item.kind === 'event' ? t('week.details.ownEvent') : item.calendar ?? t('week.details.calendarFallback'),
    ...(item.location ? { location: item.location } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    conflictsWith: item.free ? [] : props.segments
      .filter((segment) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute)
      .map((segment) => ({ blockId: segment.occurrence.blockId, title: segment.occurrence.title })),
  })
}

// The pressable area of every item outside its own box (hitAreas.ts): a short or narrow one grown to 44 px, a task over
// its routine, and every item over the lane gaps beside it, so no press near an item falls between lanes. Each part is
// drawn as an invisible box above the items; none covers another item's box.
interface HitArea { key: string; for: string; area: Box; activate: () => void }
interface Presses { hits: HitArea[]; shared: { key: string; box: Box; keys: string[]; options: PressOption[] }[] }
const presses = computed<Presses>(() => {
  const width = measure.value?.width
  if (props.compact || !width) return { hits: [], shared: [] }
  const across = (lane: { left: number; width: number }) => ({ left: (width * lane.left) / 100 + LANE_GAP_PX, right: (width * (lane.left + lane.width)) / 100 - LANE_GAP_PX, gap: LANE_GAP_PX })
  const items: (PressItem & { option: PressOption })[] = [
    ...(props.editable ? plan.value.blocks : []).map((segment) => ({
      key: `b:${segment.key}`, top: segment.top, bottom: segment.bottom, ...across(segment),
      option: { key: `b:${segment.key}`, kind: 'block' as const, title: segment.occurrence.title, range: timeRange(segment), activate: () => emit('select', segment.occurrence.blockId), anchor: () => itemControl(`b:${segment.key}`) },
    })),
    ...plan.value.busy.map((item) => ({
      key: `e:${item.key}`, top: item.top, bottom: item.bottom, ...across(item),
      option: { key: `e:${item.key}`, kind: 'event' as const, title: item.title, range: busyRange(item), activate: () => inspect(item), anchor: () => itemControl(`e:${item.key}`) },
    })),
    ...plan.value.tasks.filter(() => props.editable).map((planned) => ({
      key: `t:${planned.task.key}`, top: planned.top, bottom: planned.bottom, ...across(planned),
      ...(planned.hostKey ? { hostKey: `b:${planned.hostKey}` } : {}),
      ...(planned.outline ? { outline: true } : {}),
      option: { key: `t:${planned.task.key}`, kind: 'task' as const, title: planned.task.title, range: taskRange(planned.task), activate: () => emit('select-task', planned.task.taskId), anchor: () => itemControl(`t:${planned.task.key}`) },
    })),
  ]
  const bounds = { width, height: 24 * props.hourHeight }
  const pressable = items.filter((item) => !item.outline)
  const areas = hitAreas(pressable, bounds)
  const options = new Map(items.map((item) => [item.key, item.option]))
  return {
    hits: pressable.flatMap((item) => areas.get(item.key)!.map((area, index) => ({ key: `${item.key}#${index}`, for: item.key, area, activate: item.option.activate }))),
    shared: sharedTargets(items, areas, bounds).map((target, index) => ({ key: `shared#${index}`, box: target.box, keys: target.keys, options: target.keys.map((key) => options.get(key)!) })),
  }
})

function itemControl(key: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-hit-key="${CSS.escape(key)}"]`) ?? null
}

function boxStyle(area: Box) {
  return { top: `${area.top}px`, left: `${area.left}px`, width: `${area.right - area.left}px`, height: `${area.bottom - area.top}px` }
}

function busyRange(item: BusySegment): string {
  const range = rangeText(formatTime(item.start, displayLocale.value, props.timeZone), formatTime(item.end, displayLocale.value, props.timeZone))
  return item.continuesBefore || item.continuesAfter ? t('week.grid.crossesMidnight', { range }) : range
}

// A press on empty time in the column starts a new block; a press on a routine opens it. Presses near a short item
// land on its hit area above.
function onColumnClick(event: MouseEvent, blockId?: string): void {
  if (!props.editable || (!blockId && event.target !== event.currentTarget)) return
  if (blockId) { emit('select', blockId); return }
  const column = (event.currentTarget as HTMLElement).closest<HTMLElement>('.day-column')!
  const y = event.clientY - column.getBoundingClientRect().top
  const minute = Math.floor((y / props.hourHeight) * 60 / SLOT_MINUTES) * SLOT_MINUTES
  emit('create', props.date, Math.max(0, Math.min(1440 - SLOT_MINUTES, minute)))
}
</script>

<template>
  <div ref="root" class="day-column" :class="{ 'is-compact': compact }" :data-date="date" :aria-label="label" role="group" :data-whole-text="compact ? 'shapes' : ''" :data-planned-for="measure?.basis" @click="onColumnClick">
    <!-- Hidden copies of each text style: the page's own fonts, measured for the plan. -->
    <div v-if="!compact" ref="probes" class="text-probes" aria-hidden="true">
      <span data-role="blockTitle" />
      <span data-role="blockDetail" />
      <span class="t-caption" data-role="caption" />
      <span data-role="taskTitle" />
      <span data-role="compact" data-min-text />
      <span data-role="blockTitle" data-lead="mark"><CategoryMark class="block-mark" :category="undefined" />{{ ' ' }}</span>
      <span class="item-glyph"><CategoryMark :category="undefined" data-glyph-probe="category" /></span>
      <span class="item-glyph is-smallest"><CategoryMark :category="undefined" data-glyph-probe="category-min" /></span>
      <span><Icon name="triangle-alert" :size="12" data-glyph-probe="warning" /></span>
      <span class="t-caption" data-lead="icon"><Icon name="check" :size="12" />{{ ' ' }}</span>
      <span class="t-caption" data-sentinel>M</span>
      <span class="hyphen-probe" data-role="blockTitle" data-hyphen="blockTitle" />
      <span class="hyphen-probe t-caption" data-hyphen="caption" />
      <span class="hyphen-probe" data-role="taskTitle" data-hyphen="taskTitle" />
      <span class="hyphen-probe" data-role="compact" data-hyphen="compact" />
    </div>
    <button
      v-for="item in plan.busy"
      :key="item.key"
      type="button"
      class="busy t-caption"
      :data-text-inset="SMALL_INSETS.busy"
      :class="[`is-${item.kind}`, { 'is-small': item.show.small }, { 'is-conflict': conflicting.has(item.key) }, { 'is-free': item.free }, { 'is-icon-only': item.show.icon && !item.show.title }, { 'is-stacked': item.show.stacked }]"
      :data-glyph-kind="conflicting.has(item.key) ? 'warning' : undefined"
      :style="busyStyle(item)"
      :title="item.title"
      data-testid="busy-overlay"
      :data-event-id="item.kind === 'event' ? item.key.slice(0, item.key.lastIndexOf('@')) : undefined"
      :data-hit-key="`e:${item.key}`"
      @click.stop="inspect(item)"
    >
      <span v-if="conflicting.has(item.key)" class="conflict-mark" :class="{ 'visually-hidden': !item.show.icon }" :data-glyph="item.show.icon ? 'warning' : undefined" data-testid="calendar-conflict"><Icon name="triangle-alert" :size="12" /><span class="conflict-text" :class="{ 'visually-hidden': !item.show.word }">{{ t('week.grid.conflict') }}</span></span>{{ item.show.icon ? ' ' : '' }}<span class="busy-title" :class="{ 'visually-hidden': !item.show.title, 'is-hyphenated': item.show.hyphenate, 'is-small-text': item.show.small }" :aria-hidden="drawn(item.show, item.title).cut || undefined">{{ drawn(item.show, item.title).words }}<span v-if="drawn(item.show, item.title).cut" class="cut" data-cut>{{ ELLIPSIS }}</span></span><span v-if="drawn(item.show, item.title).cut" class="visually-hidden">{{ item.title }}</span>
      <span v-if="item.show.glyph" class="item-glyph" :style="{ ...glyphSlot(SMALL_INSET.busy, 1), ...glyphSize(item.show) }" data-glyph="category"><CategoryMark :category="{ name: item.title, colorKey: 'gray' }" /></span>
    </button>
    <button
      v-for="segment in plan.blocks"
      :key="segment.key"
      type="button"
      class="block"
      :data-text-inset="SMALL_INSETS.block"
      :class="{ 'is-centered': segment.show.center, 'is-done': statuses.get(segment.key) === 'done', 'is-skipped': statuses.get(segment.key) === 'skipped', 'continues-before': segment.continuesBefore, 'continues-after': segment.continuesAfter }"
      :style="segmentStyle(segment)"
      :data-block-id="segment.occurrence.blockId"
      :data-hit-key="`b:${segment.key}`"
      :data-start-minute="segment.startMinute"
      :data-end-minute="segment.endMinute"
      :data-status="statuses.get(segment.key)"
      :aria-label="blockLabel(segment)"
      :disabled="!editable"
      :tabindex="compact ? -1 : undefined"
      @click.stop="onColumnClick($event, segment.occurrence.blockId)"
    >
      <span v-if="segment.show.title" class="block-title" :class="{ 'is-hyphenated': segment.show.hyphenate, 'is-small-text': segment.show.small }"><CategoryMark v-if="segment.show.mark" class="block-mark" :category="categoriesById.get(segment.occurrence.categoryId)" />{{ segment.show.mark ? ' ' : '' }}{{ drawn(segment.show, segment.occurrence.title).words }}<span v-if="drawn(segment.show, segment.occurrence.title).cut" class="cut" data-cut aria-hidden="true">{{ ELLIPSIS }}</span></span>{{ ' ' }}
      <span v-if="segment.show.time" class="block-detail block-time">{{ timeRange(segment) }}</span>{{ ' ' }}
      <span v-if="segment.show.category" class="block-detail block-category">{{ categoryLine(segment) }}</span>{{ ' ' }}
      <span v-if="statuses.get(segment.key)" class="block-status t-caption" :class="{ 'visually-hidden': !segment.show.status }" data-testid="block-status"><template v-if="segment.show.statusIcon"><Icon :name="STATUS_ICON[statuses.get(segment.key)!]" :size="12" />{{ ' ' }}</template>{{ statusText(segment) }}</span>
      <span v-if="segment.show.glyph" class="item-glyph" :style="{ ...glyphSlot(SMALL_INSET.block), ...glyphSize(segment.show), top: `${segment.show.glyphAt!.top}px`, height: `${segment.show.glyphAt!.height}px`, bottom: 'auto' }" data-glyph="category"><CategoryMark :category="categoriesById.get(segment.occurrence.categoryId)" /></span>
    </button>
    <button
      v-for="planned in plan.tasks"
      :key="planned.task.key"
      type="button"
      class="task-chunk"
      :class="{ 'is-outline': planned.outline }"
      :style="taskStyle(planned)"
      data-layered
      data-testid="week-task"
      :data-text-inset="SMALL_INSETS.task"
      :data-task-id="planned.task.taskId"
      :data-hit-key="`t:${planned.task.key}`"
      :data-start-minute="planned.task.startMinute"
      :data-end-minute="planned.task.endMinute"
      :data-late="planned.task.late || undefined"
      :aria-label="t('week.task.label', { title: planned.task.title, range: taskRange(planned.task) }) + (planned.task.late ? `, ${t('week.task.late')}` : '')"
      :title="planned.task.title"
      :disabled="!editable"
      :tabindex="compact ? -1 : undefined"
      @click.stop="emit('select-task', planned.task.taskId)"
    >
      <span class="task-box task-text" :class="{ 'is-late': planned.task.late, 'is-outline': planned.outline, 'is-small': planned.show.small }"><Icon v-if="planned.show.icon" class="task-icon" name="triangle-alert" :size="12" />{{ planned.show.icon ? ' ' : '' }}<span v-if="planned.show.title" class="task-title" :class="{ 'is-hyphenated': planned.show.hyphenate, 'is-small-text': planned.show.small }">{{ drawn(planned.show, planned.task.title).words }}<span v-if="drawn(planned.show, planned.task.title).cut" class="cut" data-cut aria-hidden="true">{{ ELLIPSIS }}</span></span></span>
      <span v-if="planned.show.glyph" class="item-glyph" :style="{ ...glyphSlot(SMALL_INSET.task), ...glyphSize(planned.show) }" data-glyph="category"><CategoryMark :category="categoriesById.get(planned.task.categoryId ?? '')" /></span>
    </button>
    <!-- Decorative for assistive technology: every item is reachable by its own button; these only widen presses. -->
    <span v-for="hit in presses.hits" :key="hit.key" class="hit-area" :data-hit-for="hit.for" aria-hidden="true" :style="boxStyle(hit.area)" @click.stop="hit.activate" />
    <!-- Where items crowd each other: one 44 px target that asks which of them to open (keyboard reaches each item). -->
    <span v-for="target in presses.shared" :key="target.key" class="shared-target" data-shared-target :data-shared-items="target.keys.join(' ')" aria-hidden="true" :style="boxStyle(target.box)" @click.stop="emit('choose', target.options)" />
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
}
.text-probes { position: absolute; inset: 0 auto auto 0; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
.text-probes > span { position: absolute; top: 0; left: 0; width: auto; max-width: none; white-space: pre; }
.text-probes > .hyphen-probe { display: block; overflow: hidden; white-space: normal; overflow-wrap: normal; hyphens: auto; }


/* What each box shows is decided by dayColumnPlan.ts; the styles below only draw it. Every text style here is one of
   the probes above, so the plan measures exactly what is drawn: whole words, never an ellipsis or a clamp. */
.block-title, [data-role='blockTitle'] { font-size: 0.8125rem; font-weight: 600; line-height: 1.25; }
.block-detail, [data-role='blockDetail'] { font-size: 0.75rem; line-height: 1.25; font-variant-numeric: tabular-nums; }
.task-text, [data-role='taskTitle'] { font-size: 0.75rem; font-weight: 500; line-height: 1.1; letter-spacing: 0.01em; }
/* The small caption size (11 px at 100 % text): a short box's title on a tight line, centred, before the box becomes
   a mark. Same weight and tracking as the caption. */
.block-title.is-small-text, .busy-title.is-small-text, .task-title.is-small-text, [data-role='compact'] { font-size: 0.6875rem; font-weight: 500; line-height: 1.2; letter-spacing: 0.01em; }
.block.is-centered { justify-content: center; }
/* The glyph a box shows when it holds no word: the category mark at the small caption size, centred (the plan measures
   it from the probe of the same class). Decorative: the box's label and title carry its name. */
.item-glyph { font-size: 0.6875rem; line-height: 1; }
/* The smallest a glyph is drawn: 10 px at 100 % text (the glyph is 1.125 times its font size), scaling with text size. */
.item-glyph.is-smallest { font-size: calc(0.625rem / 1.125); }
.block > .item-glyph, .busy > .item-glyph, .task-chunk > .item-glyph { position: absolute; z-index: 3; display: flex; align-items: center; justify-content: center; pointer-events: none; }
/* Centred in a column, the title spans the whole line width, so it wraps (and hyphenates) exactly as it was measured. */
.busy.is-small { display: flex; flex-direction: column; justify-content: center; padding-block: 0; }
.task-box.is-small { display: flex; flex-direction: column; justify-content: center; padding-block: 0; border-width: 1px; padding-inline: 2px; }
/* A time range is one unit: on one line or not drawn (dayColumnPlan.ts gives it one line). */
.block-time { white-space: nowrap; }
.block-title, .block-detail, .block-status, .busy, .task-text { white-space: normal; overflow-wrap: normal; word-break: normal; hyphens: manual; }
/* Only a first word longer than a line is hyphenated, in the page's language (dayColumnPlan.ts decides). */
.block-title.is-hyphenated, .busy-title.is-hyphenated, .task-title.is-hyphenated { hyphens: auto; }

.block {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  overflow: hidden;
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
.block-title, .block-detail, .block-status { flex: none; display: block; min-width: 0; }
/* Labels are drawn above the now-line (z-index 2): the line crosses the fill of a block, never its words. */
.block-title, .block-detail, .block-status, .task-title, .task-icon { position: relative; z-index: 3; }
/* Inline marks sit at the top of their line and are no taller than it, so they never make a line taller than measured. */
.block-mark { margin-inline-end: 1px; vertical-align: top; }
.block-status { color: var(--label-2); }
.block-status :deep(svg), .task-icon { vertical-align: top; }

.busy {
  position: absolute;
  display: block;
  overflow: hidden;
  padding: 1px 2px;
  border: 1px dashed var(--label-2);
  border-radius: 6px;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 10%, transparent) 0 4px, transparent 4px 8px);
  /* Events paint above planned blocks and tasks and open their details when tapped. */
  z-index: 2;
  color: var(--label);
  text-align: start;
  cursor: pointer;
}
/* A calendar event marked free: drawn as an outline only, with no hatching; it takes no time from the plan. */
.busy.is-free { border-style: solid; background: transparent; }
.is-conflict {
  border-color: var(--danger);
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 10%, var(--surface)) 0 4px, var(--surface) 4px 8px);
}
.conflict-mark { display: inline-flex; align-items: center; gap: 2px; vertical-align: top; color: var(--danger-label); }
/* A conflict with no room for words keeps its ⚠, centred like a glyph (dayColumnPlan.ts measures it there). */
.busy.is-icon-only { display: flex; align-items: center; justify-content: center; padding: 0; }
/* A conflict too narrow for "⚠ title" on one line draws its ⚠ on a line of its own above the title (ICON_PX + 1 px). */
.busy.is-stacked .conflict-mark { display: flex; height: 12px; margin-block-end: 1px; }
/* In the small caption size the title sits beside the ⚠, both centred on the line, 2 px apart
   (dayColumnPlan.ts › SMALL_ICON_GAP_PX). */
.busy.is-small:has(> .conflict-mark:not(.visually-hidden)) { flex-direction: row; align-items: center; justify-content: flex-start; }
.busy.is-small > .conflict-mark { margin-inline-end: 2px; }

/* A placed task: a dashed outline inside the lane of its block; tapping it opens the task. It has no z-index, so its
   words can be drawn above the now-line while the box stays under it. */
/* Above every item's words (z-index 3, earlier in the column): an area covers its own item's neighbourhood and, for a
   task, its routine; never another item's box (hitAreas.ts gives neighbours the room on their side of the midpoint). */
.hit-area { position: absolute; z-index: 3; cursor: pointer; }
/* Above the items and their own areas: a press there asks which of the crowded items to open. */
.shared-target { position: absolute; z-index: 4; cursor: pointer; }
.task-chunk { position: absolute; padding: 0; border: 0; background: transparent; color: inherit; text-align: start; cursor: pointer; }
.task-chunk:disabled { cursor: default; }
.task-box {
  position: absolute;
  inset: 0 2px 0 4px;
  display: block;
  overflow: hidden;
  padding: 1px 2px;
  border: 1.5px dashed var(--block-color);
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  color: var(--label);
}
/* Around a block too short to hold it below its title: an outline only, the block's title shows through, and a press
   there opens the routine (the task stays reachable by keyboard here and from Tasks). */
.task-box.is-outline { inset: 1px; background: transparent; }
.task-chunk.is-outline { pointer-events: none; }
.task-box.is-late { border-color: var(--danger); color: var(--danger-label); }

/* One visual, one meaning: done is dimmed with its check mark; only "No" is struck through. */
.block.is-done { opacity: 0.6; }
.is-skipped .block-title { text-decoration: line-through; }

.is-compact .block { padding: 0; border-radius: 3px; }
/* A short block or commute keeps a drawn height where its lane has room (dayColumnPlan.ts › COMPACT_MIN_PX). */
.is-compact .block::before { width: 2px; }
.is-compact .busy { padding: 0; }
.is-compact .task-box { inset: 0 2px 0 4px; padding: 0; border-width: 1px; }
.is-compact .busy > *, .is-compact .block > * { display: none; }
.is-compact .now-line::before { display: none; }

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
