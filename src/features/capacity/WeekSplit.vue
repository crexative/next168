<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import { formatDate } from '@/features/week/localTime'
import { formatHours } from '@/ui/format'
import { weekEnd, weekSplit } from './freeHours'

// The current week split at `now`: what has passed, what blocks still cover, and what is free. Its free figure
// comes from the same function as the free-hours badge, so both always show the same number.
const props = defineProps<{ document: PlannerDocument; now: Date }>()
const { t, locale } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
const split = computed(() => weekSplit(props.document, props.now, timeZone.value))
const lastDay = computed(() => formatDate(weekEnd(props.document, props.now, timeZone.value).lastDate, locale.value, { weekday: 'long' }))
const hours = (minutes: number) => t('capacity.split.hours', { hours: formatHours(minutes / 60) })
const rows = computed(() => [
  { key: 'past', label: t('capacity.split.past'), value: hours(split.value.pastMinutes) },
  { key: 'planned', label: t('capacity.split.planned'), value: hours(split.value.plannedAheadMinutes) },
  { key: 'free', label: t('capacity.split.free', { day: lastDay.value }), value: hours(split.value.freeAheadMinutes) },
])
</script>

<template>
  <section class="week-split" aria-labelledby="week-split-title" data-testid="week-split">
    <h2 id="week-split-title" class="t-headline">{{ t('capacity.split.title') }}</h2>
    <dl class="rows">
      <div v-for="row in rows" :key="row.key" class="row" :class="`is-${row.key}`" :data-testid="`split-${row.key}`">
        <dt class="t-subhead">{{ row.label }}</dt>
        <dd class="t-subhead value">{{ row.value }}</dd>
      </div>
    </dl>
    <p class="t-footnote t-secondary total">{{ t('capacity.split.total', { total: formatHours(split.weekMinutes / 60) }) }}</p>
  </section>
</template>

<style scoped>
.week-split { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.week-split h2 { margin: 0; }
.rows { margin: 0; }
.row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--space-3); padding: var(--space-2) 0; }
.row + .row { border-top: 0.5px solid var(--separator); }
.row dt { flex: 1 1 10rem; min-width: 0; overflow-wrap: anywhere; }
.value { margin: 0; font-variant-numeric: tabular-nums; text-align: end; }
/* The figure people come for: free time ahead, emphasised by weight rather than colour. */
.is-free dt, .is-free .value { font-weight: 600; }
.total { margin: 0; }
</style>
