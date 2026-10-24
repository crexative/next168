<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { categoryColor } from './categoryColor'
import { formatTime } from './localTime'
import { HOUR_HEIGHT_PX, SLOT_MINUTES, type BlockSegment, type BusySegment } from './weekLayout'

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
const emit = defineEmits<{ select: [blockId: string]; create: [date: string, minute: number] }>()

const { t, locale } = useI18n()
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))

function verticalStyle(startMinute: number, endMinute: number) {
  return { top: `${(startMinute / 60) * HOUR_HEIGHT_PX}px`, height: `${((endMinute - startMinute) / 60) * HOUR_HEIGHT_PX}px` }
}

function segmentStyle(segment: BlockSegment) {
  return {
    ...verticalStyle(segment.startMinute, segment.endMinute),
    insetInlineStart: `calc(${(segment.lane / segment.lanes) * 100}% + 2px)`,
    width: `calc(${100 / segment.lanes}% - 4px)`,
    '--block-color': categoryColor(categoriesById.value.get(segment.occurrence.categoryId)),
  }
}

function timeRange(segment: BlockSegment): string {
  const range = `${formatTime(segment.occurrence.start, locale.value, props.timeZone)} – ${formatTime(segment.occurrence.end, locale.value, props.timeZone)}`
  return segment.continuesAfter || segment.continuesBefore ? t('week.grid.crossesMidnight', { range }) : range
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
    <div
      v-for="item in busy"
      :key="item.key"
      class="busy"
      :class="`is-${item.kind}`"
      :style="verticalStyle(item.startMinute, item.endMinute)"
      :title="item.title"
      data-testid="busy-overlay"
    >
      <span class="busy-title t-caption">{{ item.title }}</span>
    </div>
    <button
      v-for="segment in segments"
      :key="segment.key"
      type="button"
      class="block"
      :class="{ 'is-short': segment.endMinute - segment.startMinute < 45, 'continues-before': segment.continuesBefore, 'continues-after': segment.continuesAfter }"
      :style="segmentStyle(segment)"
      :data-block-id="segment.occurrence.blockId"
      :data-start-minute="segment.startMinute"
      :data-end-minute="segment.endMinute"
      :aria-label="`${segment.occurrence.title}, ${timeRange(segment)}`"
      :disabled="!editable"
      @click="emit('select', segment.occurrence.blockId)"
    >
      <span class="block-title">{{ segment.occurrence.title }}</span>
      <span class="block-time">{{ timeRange(segment) }}</span>
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
  background: var(--block-color);
}
.block:active { transform: scale(0.97); }
.block:disabled { cursor: default; }
.continues-before { border-start-start-radius: 0; border-start-end-radius: 0; }
.continues-after { border-end-start-radius: 0; border-end-end-radius: 0; }
.block-title { font-size: 0.8125rem; font-weight: 600; line-height: 1.25; }
.block-time { font-size: 0.75rem; line-height: 1.25; font-variant-numeric: tabular-nums; }
.block-title, .block-time { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-short { flex-direction: row; gap: var(--space-1); align-items: center; }
.is-short .block-time { display: none; }

.busy {
  position: absolute;
  inset-inline: 1px;
  overflow: hidden;
  padding: 1px var(--space-1);
  border: 1px dashed var(--label-2);
  border-radius: 6px;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 10%, transparent) 0 4px, transparent 4px 8px);
  pointer-events: none;
}
.busy-title { color: var(--label); }

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
