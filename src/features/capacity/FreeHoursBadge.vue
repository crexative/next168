<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TOTAL_WEEK_HOURS, type PlannerDocument } from '@/core/model'
import { formatDate } from '@/features/week/localTime'
import { freeHoursAhead, weekEnd } from './freeHours'

const props = defineProps<{ document: PlannerDocument; now: Date }>()
const { t, locale } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
const hours = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(freeHoursAhead(props.document, props.now, timeZone.value)))
const lastDay = computed(() => formatDate(weekEnd(props.document, props.now, timeZone.value).lastDate, locale.value, { weekday: 'long' }))
</script>

<template>
  <p class="free-hours t-subhead" data-testid="free-hours">
    {{ t('capacity.badge', { hours, day: lastDay, total: TOTAL_WEEK_HOURS }) }}
  </p>
</template>

<style scoped>
.free-hours {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--surface);
  font-variant-numeric: tabular-nums;
}
</style>
