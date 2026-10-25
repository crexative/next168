<script setup lang="ts">
import { inlineSeparators } from '@/ui/inlineText'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { buildCapacity, WEEK_MINUTES } from './capacity'
import { categoryColor } from './categoryColor'
import { formatTotal, formatWholeHours, wholeHourParts } from '@/ui/format'

const props = defineProps<{ categories: Category[]; plannedMinutes: Record<string, number> }>()

const { t } = useI18n()

const capacity = computed(() => buildCapacity(props.categories, props.plannedMinutes))
const segments = computed(() => capacity.value.segments.map((segment) => {
  const category = props.categories.find((candidate) => candidate.id === segment.categoryId)!
  return { ...segment, name: category.name, color: categoryColor(category), duration: formatTotal(segment.minutes) }
}))
// Assigned and unassigned hours are rounded together, so the two figures always add up to the 168.
const roundedHours = computed(() => wholeHourParts([capacity.value.plannedMinutes, capacity.value.availableMinutes]) as [number, number])
const unassignedDuration = computed(() => formatWholeHours(roundedHours.value[1]))
const headline = computed(() => {
  const [assigned] = roundedHours.value
  return inlineSeparators(t('insights.bar.summary', { assigned: formatWholeHours(assigned), unassigned: unassignedDuration.value }))
})
const weekLabel = computed(() => formatTotal(WEEK_MINUTES))
</script>

<template>
  <section class="week-bar" :aria-label="t('insights.bar.title')">
    <h2 class="t-headline">{{ t('insights.bar.title') }}</h2>
    <p class="summary t-title-2" data-testid="capacity-available">{{ headline }}</p>
    <div class="cells" :style="{ gap: `min(2px, ${capacity.gapPercent}%)` }" role="group" :aria-label="`${t('insights.bar.title')} (${weekLabel})`" data-testid="week-bar">
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
        :aria-label="t('insights.bar.unassignedSegment', { duration: unassignedDuration })"
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
        <span class="legend-name">{{ t('insights.bar.unassignedName') }}</span>
        <span class="t-secondary">{{ unassignedDuration }}</span>
      </li>
    </ul>
    <p v-if="capacity.overbooked" class="t-footnote t-secondary" data-testid="capacity-overlap">{{ t('insights.bar.overlap') }}</p>
    <slot />
  </section>
</template>

<style scoped>
.week-bar { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
/* Words wrap between words and never inside one, so the figure stays readable at 200 % text. */
/* Like the week's day strip, the headline stops growing at large text (40 px): at 320 px and 200 % text a German word
   ("zugewiesen", 259 px at 44 px) would otherwise be wider than the line, and the figures never break inside a word. */
.summary { margin: 0; min-width: 0; overflow-wrap: normal; font-size: min(1.375rem, 40px); text-wrap: balance; font-variant-numeric: tabular-nums; }
.cells { display: flex; height: 28px; overflow: hidden; border-radius: 8px; }
.segment { display: block; flex: 0 1 auto; flex-basis: 0; min-width: 0; }
.is-available { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--separator); }
.legend { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-1) 0 0; padding: 0; list-style: none; }
/* With large text the hours move under the name instead of squeezing it until a word breaks. */
.legend-item { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-2); min-width: 0; }
.legend-name { flex: 1 1 6rem; min-width: 0; overflow-wrap: break-word; }
.swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.swatch.is-available { background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--separator); }
</style>
