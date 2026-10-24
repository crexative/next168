<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import CategoryMark from '@/ui/CategoryMark.vue'
import Icon from '@/ui/Icon.vue'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale } from '@/ui/format'
import { categoryColor } from './categoryColor'
import { formatTime } from './localTime'
import { HOUR_HEIGHT_PX, SLOT_MINUTES, STACK_EVENT_INSET_PERCENT, layoutDaySegments, type BlockSegment, type BusySegment, type DayPart, type LanePosition } from './weekLayout'
import type { BusyDetails } from './busyDetails'

const props = defineProps<{
  date: string
  label: string
  segments: BlockSegment[]
  busy: BusySegment[]
  categories: Category[]
  timeZone: string
  nowMinute: number | null
  editable: boolean
}>()
const emit = defineEmits<{ select: [blockId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails] }>()

const { t } = useI18n()
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const layout = computed(() => layoutDaySegments(props.segments, props.busy))

// A calendar event conflicts when it overlaps a planned block of the same day.
const conflicting = computed(() => new Set(props.busy
  .filter((item) => item.kind === 'external' && props.segments.some((segment) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute))
  .map((item) => item.key)))

const SHORT_EVENT_MINUTES = 45

function verticalStyle(startMinute: number, endMinute: number) {
  return { top: `${(startMinute / 60) * HOUR_HEIGHT_PX}px`, height: `${((endMinute - startMinute) / 60) * HOUR_HEIGHT_PX}px` }
}

function isBesideEvent(segment: BlockSegment): boolean {
  return props.busy.some((item) => segment.startMinute < item.endMinute && item.startMinute < segment.endMinute)
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

function categoryName(segment: BlockSegment): string {
  return categoriesById.value.get(segment.occurrence.categoryId)?.name ?? ''
}

// The accessible name follows the visible text (title, time, then the category when it differs from the title).
function blockLabel(segment: BlockSegment): string {
  const name = categoryName(segment)
  return [segment.occurrence.title, timeRange(segment), name !== segment.occurrence.title ? name : ''].filter(Boolean).join(' ')
}

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

function onColumnClick(event: MouseEvent): void {
  if (!props.editable || event.target !== event.currentTarget) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const minute = Math.floor(((event.clientY - bounds.top) / HOUR_HEIGHT_PX) * 60 / SLOT_MINUTES) * SLOT_MINUTES
  emit('create', props.date, Math.max(0, Math.min(1440 - SLOT_MINUTES, minute)))
}
</script>

<template>
  <div class="day-column" :data-date="date" :aria-label="label" role="group" @click="onColumnClick">
    <button
      v-for="item in layout.busy"
      :key="item.key"
      type="button"
      class="busy"
      :class="[`is-${item.kind}`, { 'is-conflict': conflicting.has(item.key), 'is-short': item.endMinute - item.startMinute < SHORT_EVENT_MINUTES }]"
      :style="itemStyle(item)"
      :title="item.title"
      data-testid="busy-overlay"
      @click="inspect(item)"
    >
      <span v-if="conflicting.has(item.key)" class="conflict-mark t-caption" data-testid="calendar-conflict"><Icon name="triangle-alert" :size="12" /><span class="conflict-text">{{ t('week.grid.conflict') }}</span></span>
      <span class="busy-title t-caption">{{ item.title }}</span>
    </button>
    <button
      v-for="segment in layout.blocks"
      :key="segment.key"
      type="button"
      class="block"
      :class="{ 'is-short': segment.endMinute - segment.startMinute < 45, 'is-beside': isBesideEvent(segment), 'continues-before': segment.continuesBefore, 'continues-after': segment.continuesAfter }"
      :style="segmentStyle(segment)"
      :data-block-id="segment.occurrence.blockId"
      :data-start-minute="segment.startMinute"
      :data-end-minute="segment.endMinute"
      :aria-label="blockLabel(segment)"
      :disabled="!editable"
      @click="emit('select', segment.occurrence.blockId)"
    >
      <span class="block-title"><CategoryMark class="block-mark" :category="categoriesById.get(segment.occurrence.categoryId)" />{{ ' ' }}{{ segment.occurrence.title }}</span>{{ ' ' }}
      <span class="block-time">{{ timeRange(segment) }}</span>{{ ' ' }}
      <span v-if="categoryName(segment) && categoryName(segment) !== segment.occurrence.title" class="block-category">{{ categoryName(segment) }}</span>
    </button>
    <div v-if="nowMinute !== null" class="now-line" :style="{ top: `${(nowMinute / 60) * HOUR_HEIGHT_PX}px` }" data-testid="now-line" aria-hidden="true" />
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
  align-items: flex-start;
  gap: 1px;
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
.block-title, .block-time, .block-category { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  /* Events paint above planned blocks and open their details when tapped. */
  z-index: 1;
  color: var(--label);
  text-align: start;
  cursor: pointer;
}
.busy-title { display: block; overflow: hidden; color: var(--label); text-overflow: ellipsis; white-space: nowrap; }
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
  .block, .busy {
    inset-inline-start: calc(var(--stack-left) + 2px) !important;
    width: calc(var(--stack-width) - 4px) !important;
  }
  .is-beside .block-time, .is-beside .block-category, .is-beside .block-mark { display: none; }
  .block.is-beside { padding-inline: 3px 0; }
  .is-beside .block-title {
    max-width: calc(var(--title-strip) - 4px);
    white-space: normal;
    word-break: break-all;
  }
  .busy:not(.is-short) .busy-title { white-space: normal; overflow-wrap: anywhere; }
  .busy.is-short { gap: 2px; padding-inline: 2px; }
  .busy.is-short .busy-title { text-overflow: clip; }
  /* A one-line band keeps the title; the word lives in the details and the accessible name. */
  .busy.is-short .conflict-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .busy.is-conflict:not(.is-short) { display: flex; flex-direction: column; justify-content: center; }
}
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
