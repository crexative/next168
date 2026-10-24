<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TOTAL_WEEK_HOURS, type PlannerDocument } from '@/core/model'
import { formatDate } from '@/features/week/localTime'
import { formatHours } from '@/ui/format'
import { weekEnd, weekSplit, weekSplitHours } from './freeHours'

// `framed` draws the badge as its own pill; a parent that groups it with other figures turns it off and supplies the surface.
const props = withDefaults(defineProps<{ document: PlannerDocument; now: Date; framed?: boolean }>(), { framed: true })
const { t, locale } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
const hours = computed(() => formatHours(weekSplitHours(weekSplit(props.document, props.now, timeZone.value)).freeAhead))
const lastDay = computed(() => formatDate(weekEnd(props.document, props.now, timeZone.value).lastDate, locale.value, { weekday: 'long' }))
</script>

<template>
  <p class="free-hours t-subhead" :class="{ 'is-framed': framed }" data-testid="free-hours">
    {{ t('capacity.badge', { hours, day: lastDay, total: TOTAL_WEEK_HOURS }) }}
  </p>
</template>

<style scoped>
.free-hours { margin: 0; font-variant-numeric: tabular-nums; text-wrap: balance; }
.free-hours.is-framed { padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
</style>
