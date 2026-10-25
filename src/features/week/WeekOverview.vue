<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import DayColumn from './DayColumn.vue'
import TimeAxis from './TimeAxis.vue'
import { categoryColor } from './categoryColor'
import { formatDate } from './localTime'
import { COMPACT_HOUR_HEIGHT_PX, type BlockSegment, type BusySegment, type TaskSegment } from './weekLayout'

const props = defineProps<{
  dates: string[]
  today: string
  segments: Record<string, BlockSegment[]>
  busy: Record<string, BusySegment[]>
  tasks: Record<string, TaskSegment[]>
  actuals: BlockActual[]
  categories: Category[]
  timeZone: string
  nowMinute: number
}>()
const emit = defineEmits<{ pick: [index: number] }>()

const { t, locale } = useI18n()

// Colour alone cannot say which block is which, so the categories on screen are named below the grid.
const legend = computed(() => {
  const used = new Set(props.dates.flatMap((date) => [
    ...(props.segments[date] ?? []).map((segment) => segment.occurrence.categoryId),
    ...(props.tasks[date] ?? []).map((task) => task.categoryId ?? ''),
  ]))
  return props.categories.filter((category) => used.has(category.id))
})
</script>

<template>
  <div class="overview" data-testid="week-overview" :style="{ '--hour-height': `${COMPACT_HOUR_HEIGHT_PX}px` }">
    <div class="overview-head sticky-header" role="group" :aria-label="t('week.overview.days')">
      <span />
      <button
        v-for="(date, index) in dates"
        :key="date"
        type="button"
        class="overview-day"
        :class="{ 'is-today': date === today }"
        :aria-current="date === today ? 'date' : undefined"
        :aria-label="t('week.overview.open', { day: formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })"
        @click="emit('pick', index)"
      >
        <span class="t-caption weekday">{{ formatDate(date, locale, { weekday: 'narrow' }) }}</span>
        <span class="number">{{ formatDate(date, locale, { day: 'numeric' }) }}</span>
      </button>
    </div>
    <div class="overview-body">
      <TimeAxis compact />
      <DayColumn
        v-for="date in dates"
        :key="date"
        :class="{ 'is-today': date === today }"
        :date="date"
        :label="formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' })"
        :segments="segments[date] ?? []"
        :busy="busy[date] ?? []"
        :tasks="tasks[date] ?? []"
        :actuals="actuals"
        :categories="categories"
        :time-zone="timeZone"
        :now-minute="date === today ? nowMinute : null"
        :editable="false"
        :hour-height="COMPACT_HOUR_HEIGHT_PX"
        compact
      />
    </div>
    <ul class="legend t-footnote" :aria-label="t('week.overview.legend')">
      <li v-for="category in legend" :key="category.id" class="legend-item">
        <span class="swatch" :style="{ background: categoryColor(category) }" aria-hidden="true" />{{ category.name }}
      </li>
      <li class="legend-item"><span class="swatch is-task" aria-hidden="true" />{{ t('week.overview.task') }}</li>
      <li class="legend-item"><span class="swatch is-event" aria-hidden="true" />{{ t('week.overview.event') }}</li>
    </ul>
  </div>
</template>

<style scoped src="./stickyHeader.css"></style>
<style scoped>
.overview { padding: 0 var(--page-gutter) var(--space-4) var(--space-2); }
.overview-head, .overview-body { display: grid; grid-template-columns: 2.5rem repeat(7, minmax(0, 1fr)); }
.overview-head {
  position: sticky;
  top: calc(var(--safe-top) + var(--toolbar-height));
  z-index: 5;
  padding-block: var(--space-1);
}
.overview-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: var(--tap-target);
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--label);
  touch-action: manipulation;
  transition: opacity 0.1s;
}
.overview-day:active { opacity: 0.6; }
.weekday { color: var(--label-2); }
.number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.875rem;
  font-size: 1.0625rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.is-today .weekday { color: var(--danger-label); }
.is-today .number { background: var(--danger); color: #fff; }
.overview-body { padding-top: var(--space-2); }
.overview-body > .is-today { background-color: color-mix(in srgb, var(--tint) 5%, transparent); }
.overview-body :deep(.time-axis .hour-label) { padding-inline-end: 2px; }

.legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); margin: var(--space-4) 0 0; padding: 0; list-style: none; color: var(--label-2); }
.legend-item { display: inline-flex; align-items: center; gap: var(--space-2); }
.swatch { flex: none; width: 0.75rem; height: 0.75rem; border-radius: 3px; }
.swatch.is-task { border: 1.5px dashed var(--label-2); }
.swatch.is-event { border: 1px dashed var(--label-2); background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--label-2) 25%, transparent) 0 2px, transparent 2px 4px); }
@media (prefers-reduced-motion: reduce) {
  .overview-day:active { opacity: 0.6; }
}
</style>
