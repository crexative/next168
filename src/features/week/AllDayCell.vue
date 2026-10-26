<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import WholeWordText from '@/ui/WholeWordText.vue'
import type { BusyDetails } from './busyDetails'
import type { AllDayItem } from './weekLayout'

// One day's all-day events (holidays, birthdays, days off) under the day headers: whole words and "…", each a
// 44 px target that opens the event's details.
const props = defineProps<{ date: string; items: AllDayItem[] }>()
const emit = defineEmits<{ inspect: [details: BusyDetails] }>()
const { t } = useI18n()

function inspect(item: AllDayItem): void {
  emit('inspect', {
    title: item.title,
    date: props.date,
    range: t('week.grid.allDay'),
    calendar: item.kind === 'event' ? t('week.details.ownEvent') : item.calendar ?? t('week.details.calendarFallback'),
    ...(item.location ? { location: item.location } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    conflictsWith: [],
  })
}
</script>

<template>
  <div class="all-day-cell" :data-date="date" data-testid="all-day-cell">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="all-day-item"
      :aria-label="t('week.grid.allDayItem', { title: item.title })"
      data-testid="all-day-item"
      @click="inspect(item)"
    >
      <span class="all-day-pill t-caption" :class="`is-${item.kind}`" aria-hidden="true"><WholeWordText :text="item.title" :lines="2" /></span>
    </button>
  </div>
</template>

<style scoped>
.all-day-cell { display: flex; flex-direction: column; min-width: 0; padding-inline: 2px; border-inline-start: 0.5px solid var(--separator); }
/* The press area is the full 44 px row; the drawn pill sits inside it. */
.all-day-item {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: var(--tap-target);
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--label);
  text-align: start;
  cursor: pointer;
}
.all-day-pill {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 2px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--label-2) 14%, var(--surface));
  font-weight: 500;
}
.all-day-pill.is-event { background: color-mix(in srgb, var(--tint) 16%, var(--surface)); }
</style>
