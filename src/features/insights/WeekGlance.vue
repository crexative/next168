<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import { computeStats } from '@/core/stats'
import { freeHoursWhole } from '@/features/capacity/freeHours'
import Icon from '@/ui/Icon.vue'
import { buildCapacity } from './capacity'
import { categoryColor } from './categoryColor'

// The week at a glance (R_EscritorioHoy aside): the 168-hour bar, small, and the free hours left, linking to Resumen.
const props = defineProps<{ document: PlannerDocument; now: Date }>()
const { t } = useI18n()

const capacity = computed(() => {
  const planned = Object.fromEntries(computeStats(props.document).categories.map((row) => [row.categoryId, row.plannedMinutes]))
  return buildCapacity(props.document.categories, planned)
})
const segments = computed(() => capacity.value.segments.map((segment) => ({
  id: segment.categoryId,
  minutes: segment.minutes,
  color: categoryColor(props.document.categories.find((category) => category.id === segment.categoryId)!),
})))
const free = computed(() => {
  const hours = freeHoursWhole(props.document, props.now, props.document.settings.timeZone)
  return t('capacity.badge', { hours }, hours)
})
</script>

<template>
  <a class="week-glance" href="#/insights" data-testid="today-week-glance">
    <span class="title t-headline">{{ t('today.weekGlance') }}</span>
    <span class="bar" aria-hidden="true">
      <i v-for="segment in segments" :key="segment.id" class="segment" :style="{ flexGrow: segment.minutes, background: segment.color }" />
      <i v-if="capacity.availableMinutes > 0" class="segment is-available" :style="{ flexGrow: capacity.availableMinutes }" />
    </span>
    <span class="t-subhead t-secondary">{{ free }}</span>
    <Icon name="chevron-right" :size="16" class="chevron" />
  </a>
</template>

<style scoped>
.week-glance { position: relative; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); border-radius: var(--radius-card); background: var(--surface-2); color: var(--label); text-decoration: none; }
.chevron { position: absolute; top: var(--space-5); inset-inline-end: var(--space-5); color: var(--label-3); }
.bar { display: flex; gap: 2px; height: 12px; overflow: hidden; border-radius: 6px; }
.segment { display: block; flex: 0 1 auto; flex-basis: 0; min-width: 2px; }
.is-available { background: repeating-linear-gradient(135deg, var(--fill) 0 4px, transparent 4px 8px); box-shadow: inset 0 0 0 1px var(--fill); }
</style>
