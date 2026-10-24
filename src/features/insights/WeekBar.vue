<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { categoryColor } from './categoryColor'
import { formatDuration } from './format'
import { allocateCells } from './segments'

const props = defineProps<{ categories: Category[]; plannedMinutes: Record<string, number> }>()

const UNASSIGNED = 'unassigned'
const { t } = useI18n()

const cells = computed(() => allocateCells(
  props.categories.map((category) => ({ key: category.id, minutes: props.plannedMinutes[category.id] ?? 0 })),
  UNASSIGNED,
))
const colors = computed(() => new Map(props.categories.map((category) => [category.id, categoryColor(category)])))
const plannedTotal = computed(() => Object.values(props.plannedMinutes).reduce((sum, minutes) => sum + minutes, 0))
const unassignedMinutes = computed(() => Math.max(0, 168 * 60 - plannedTotal.value))
const summary = computed(() => t('insights.bar.summary', {
  planned: formatDuration(t, plannedTotal.value),
  unassigned: formatDuration(t, unassignedMinutes.value),
}))
</script>

<template>
  <section class="week-bar" :aria-label="t('insights.bar.title')">
    <h2 class="t-headline">{{ t('insights.bar.title') }}</h2>
    <div class="cells" role="img" :aria-label="summary" data-testid="week-bar">
      <i
        v-for="(key, index) in cells"
        :key="index"
        class="cell"
        :data-segment="key"
        :style="{ background: colors.get(key) ?? 'var(--surface-2)' }"
      />
    </div>
    <p class="t-footnote t-secondary" data-testid="week-bar-summary">{{ summary }}</p>
  </section>
</template>

<style scoped>
.week-bar { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.cells { display: grid; grid-template-columns: repeat(168, 1fr); height: 28px; overflow: hidden; border-radius: 8px; background: var(--surface-2); }
.cell { display: block; }
</style>
