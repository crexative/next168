<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import DayColumn from './DayColumn.vue'
import TimeAxis from './TimeAxis.vue'
import { formatDate } from './localTime'
import type { BusyDetails } from './busyDetails'
import type { BlockSegment, BusySegment, TaskSegment } from './weekLayout'

defineProps<{
  dates: string[]
  today: string
  segments: Record<string, BlockSegment[]>
  busy: Record<string, BusySegment[]>
  tasks: Record<string, TaskSegment[]>
  actuals: BlockActual[]
  categories: Category[]
  timeZone: string
  nowMinute: number
  editable: boolean
}>()
const emit = defineEmits<{ select: [blockId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails] }>()

const { locale } = useI18n()
</script>

<template>
  <div class="week-grid">
    <div class="grid-header" aria-hidden="true" data-toolbar-extension>
      <span />
      <span v-for="date in dates" :key="date" class="day-heading" :class="{ 'is-today': date === today }">
        <span class="t-caption weekday">{{ formatDate(date, locale, { weekday: 'short' }) }}</span>
        <span class="day-number">{{ formatDate(date, locale, { day: 'numeric' }) }}</span>
      </span>
    </div>
    <div class="grid-body">
      <TimeAxis />
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
        :editable="editable"
        @select="(id) => emit('select', id)"
        @create="(day, minute) => emit('create', day, minute)"
        @inspect="(details) => emit('inspect', details)"
      />
    </div>
  </div>
</template>

<style scoped>
.week-grid { padding: 0 var(--space-4) var(--space-4) var(--space-2); }
.grid-header, .grid-body { display: grid; grid-template-columns: 3.25rem repeat(7, minmax(0, 1fr)); }
.grid-header {
  position: sticky;
  top: calc(var(--safe-top) + var(--toolbar-height));
  z-index: 5;
  /* Full bleed: the strip spans the toolbar's width, the columns stay on the grid. */
  margin-inline: calc(var(--space-2) * -1) calc(var(--space-4) * -1);
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-2);
  background: var(--material);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
}
.day-heading { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.weekday { color: var(--label-2); text-transform: uppercase; }
.day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 2rem;
  border-radius: 1rem;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.is-today .weekday { color: var(--danger-label); }
.is-today .day-number { background: var(--danger); color: #fff; }
.grid-body { padding-top: var(--space-2); }
.grid-body > .is-today { background-color: color-mix(in srgb, var(--tint) 5%, transparent); }
</style>
