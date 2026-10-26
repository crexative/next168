<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import AllDayCell from './AllDayCell.vue'
import DayColumn from './DayColumn.vue'
import TimeAxis from './TimeAxis.vue'
import { formatDate } from './localTime'
import type { BusyDetails } from './busyDetails'
import type { PressOption } from './pressOption'
import type { AllDayItem, BlockSegment, BusySegment, TaskSegment } from './weekLayout'

const props = defineProps<{
  dates: string[]
  today: string
  segments: Record<string, BlockSegment[]>
  busy: Record<string, BusySegment[]>
  allDay: Record<string, AllDayItem[]>
  tasks: Record<string, TaskSegment[]>
  actuals: BlockActual[]
  categories: Category[]
  timeZone: string
  nowMinute: number
  editable: boolean
}>()
const emit = defineEmits<{ select: [blockId: string]; 'select-task': [taskId: string]; create: [date: string, minute: number]; inspect: [details: BusyDetails]; choose: [options: PressOption[]] }>()

const { t, locale } = useI18n()
// The all-day row shows only in a week that has all-day events.
const hasAllDay = computed(() => props.dates.some((date) => (props.allDay[date]?.length ?? 0) > 0))
</script>

<template>
  <div class="week-grid">
    <!-- The day headings and the all-day row stay under the toolbar together, so a holiday shows wherever the grid is
         scrolled (it opens on the current hour). -->
    <div class="grid-header sticky-header" data-toolbar-extension>
      <div class="grid-days" aria-hidden="true">
        <span />
        <span v-for="date in dates" :key="date" class="day-heading" :class="{ 'is-today': date === today }">
          <span class="t-caption weekday">{{ formatDate(date, locale, { weekday: 'short' }) }}</span>
          <span class="day-number">{{ formatDate(date, locale, { day: 'numeric' }) }}</span>
        </span>
      </div>
      <div v-if="hasAllDay" class="all-day-row" role="group" :aria-label="t('week.grid.allDay')" data-testid="all-day-row">
        <span class="all-day-label t-caption" aria-hidden="true">{{ t('week.grid.allDay') }}</span>
        <AllDayCell v-for="date in dates" :key="date" :date="date" :items="allDay[date] ?? []" @inspect="(details) => emit('inspect', details)" />
      </div>
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
        @select-task="(id) => emit('select-task', id)"
        @create="(day, minute) => emit('create', day, minute)"
        @inspect="(details) => emit('inspect', details)"
        @choose="(options) => emit('choose', options)"
      />
    </div>
  </div>
</template>

<style scoped src="./stickyHeader.css"></style>
<style scoped>
.week-grid { padding: 0 var(--page-gutter) var(--space-4) var(--space-2); }
.grid-days, .grid-body, .all-day-row { display: grid; grid-template-columns: 3.25rem repeat(7, minmax(0, 1fr)); }
.all-day-row { margin-top: var(--space-2); padding-top: var(--space-1); border-top: 0.5px solid var(--separator); }
.all-day-label { align-self: center; color: var(--label-2); text-align: end; padding-inline-end: var(--space-1); overflow-wrap: anywhere; }
.grid-header {
  position: sticky;
  top: calc(var(--safe-top) + var(--toolbar-height) + var(--week-head-height, 0px));
  z-index: 5;
  /* Full bleed: the strip spans the toolbar's width, the columns stay on the grid. */
  margin-inline: calc(var(--space-2) * -1) calc(var(--page-gutter) * -1);
  padding: var(--space-2) var(--page-gutter) var(--space-2) var(--space-2);
}
.day-heading { display: flex; flex-direction: column; align-items: center; gap: 2px; }
/* Seven days share the header: like the system calendar (and the phone's day strip), it stops growing at large text
   sizes, so "MON" and "TUE" never run into each other in a narrow column. */
.day-heading { min-width: 0; }
.weekday { color: var(--label-2); text-transform: uppercase; font-size: min(0.75rem, 13px); }
.day-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: min(2rem, 36px);
  height: min(2rem, 36px);
  border-radius: min(1rem, 18px);
  font-size: min(1.25rem, 20px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.is-today .weekday { color: var(--danger-label); }
.is-today .day-number { background: var(--danger); color: #fff; }
.grid-body { padding-top: var(--space-2); }
.grid-body > .is-today { background-color: color-mix(in srgb, var(--tint) 5%, transparent); }
</style>
