<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { buildCapacity, WEEK_MINUTES } from './capacity'
import { categoryColor } from './categoryColor'
import { formatDuration } from '@/ui/format'

const props = defineProps<{ categories: Category[]; plannedMinutes: Record<string, number> }>()

const { t } = useI18n()

const capacity = computed(() => buildCapacity(props.categories, props.plannedMinutes))
const segments = computed(() => capacity.value.segments.map((segment) => {
  const category = props.categories.find((candidate) => candidate.id === segment.categoryId)!
  return { ...segment, name: category.name, color: categoryColor(category), duration: formatDuration(segment.minutes) }
}))
const availableDuration = computed(() => formatDuration(capacity.value.availableMinutes))
const headline = computed(() => t('insights.bar.available', { duration: availableDuration.value }))
const weekLabel = computed(() => formatDuration(WEEK_MINUTES))
</script>

<template>
  <section class="week-bar" :aria-label="t('insights.bar.title')">
    <h2 class="t-headline">{{ t('insights.bar.title') }}</h2>
    <p class="available" data-testid="capacity-available">{{ headline }}</p>
    <div class="cells" role="group" :aria-label="`${t('insights.bar.title')} (${weekLabel})`" data-testid="week-bar">
      <i
        v-for="segment in segments"
        :key="segment.categoryId"
        class="segment"
        role="img"
        :aria-label="t('insights.bar.segment', { name: segment.name, duration: segment.duration })"
        :data-segment="segment.categoryId"
        :style="{ flexGrow: segment.minutes, background: segment.color }"
      />
      <i
        v-if="capacity.availableMinutes > 0"
        class="segment is-available"
        role="img"
        :aria-label="t('insights.bar.availableSegment', { duration: availableDuration })"
        data-segment="available"
        :style="{ flexGrow: capacity.availableMinutes }"
      />
    </div>
    <ul class="legend" :aria-label="t('insights.bar.legend')" data-testid="capacity-legend">
      <li v-for="segment in segments" :key="segment.categoryId" class="legend-item t-footnote" :data-testid="`legend-${segment.categoryId}`">
        <span class="swatch" :style="{ background: segment.color }" aria-hidden="true" />
        <span class="legend-name">{{ segment.name }}</span>
        <span class="t-secondary">{{ segment.duration }}</span>
      </li>
      <li class="legend-item t-footnote" data-testid="legend-available">
        <span class="swatch is-available" aria-hidden="true" />
        <span class="legend-name">{{ t('insights.bar.availableName') }}</span>
        <span class="t-secondary">{{ availableDuration }}</span>
      </li>
    </ul>
    <p v-if="capacity.overbooked" class="t-footnote t-secondary" data-testid="capacity-overlap">{{ t('insights.bar.overlap') }}</p>
  </section>
</template>

<style scoped>
.week-bar { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.available { margin: 0; font-size: 1.75rem; line-height: 1.15; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.cells { display: flex; gap: 2px; height: 28px; overflow: hidden; border-radius: 8px; }
.segment { display: block; flex: 0 1 auto; flex-basis: 0; min-width: 2px; }
.is-available { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--separator); }
.legend { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-1) 0 0; padding: 0; list-style: none; }
.legend-item { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.legend-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.swatch.is-available { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--separator); }
</style>
