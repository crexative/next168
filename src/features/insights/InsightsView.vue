<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateOf } from '@/core/time'
import { computeStats, planVsActual, sevenDayMeasures } from '@/core/stats'
import EmptyState from '@/ui/EmptyState.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import AssistantEntryButton from '@/features/assistant/AssistantEntryButton.vue'
import { freeHoursWhole } from '@/features/capacity/freeHours'
import { useNow } from '@/features/week/useNow'
import { EXERCISE_ICON } from './exercise'
import MeasureTiles from './MeasureTiles.vue'
import WeekBar from './WeekBar.vue'
import { categoryColor } from './categoryColor'
import { formatDuration, formatHours } from '@/ui/format'
import { goalProgress, type GoalProgress } from './goalLine'

const { t } = useI18n()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const freeHours = computed(() => (document.value ? freeHoursWhole(document.value, now.value, document.value.settings.timeZone) : 0))
const stats = computed(() => (document.value ? computeStats(document.value) : null))
const plannedMinutes = computed(() => Object.fromEntries((stats.value?.categories ?? []).map((row) => [row.categoryId, row.plannedMinutes])))

const rows = computed(() => {
  const doc = document.value
  if (!doc || !stats.value) return []
  return stats.value.categories.map((row) => {
    const category = doc.categories.find((candidate) => candidate.id === row.categoryId)!
    const progress = goalProgress(category.goal, row.plannedMinutes)
    return { category, plannedMinutes: row.plannedMinutes, goal: row.goal, progress, markerAlign: markerAlign(progress.markerPercent) }
  })
})

// A label at either end of the bar is anchored to that end so it is never clipped.
function markerAlign(percent: number | null): 'start' | 'center' | 'end' {
  if (percent === null) return 'center'
  if (percent <= 20) return 'start'
  return percent >= 80 ? 'end' : 'center'
}

const planVsActualRows = computed(() => {
  const doc = document.value
  if (!doc) return []
  return Object.entries(planVsActual(doc.actuals)).map(([categoryId, totals]) => {
    const category = doc.categories.find((candidate) => candidate.id === categoryId)
    return { categoryId, name: category?.name ?? t('insights.planVsActual.removed'), color: category ? categoryColor(category) : 'var(--cat-gray)', ...totals }
  })
})

const measures = computed(() => {
  const doc = document.value
  if (!doc) return null
  const exerciseTarget = doc.blocks
    .filter((block) => doc.categories.find((category) => category.id === block.categoryId)?.icon === EXERCISE_ICON)
    .reduce((sum, block) => sum + block.days.length, 0)
  return sevenDayMeasures(doc.checkIns, localDateOf(new Date(), doc.settings.timeZone), exerciseTarget, doc.settings.timeZone)
})

function chipText(row: { goal: { kind: string; minutes: number }; progress: GoalProgress }): string {
  const { goal } = row
  if (goal.kind === 'over') return t('insights.goal.over')
  if (goal.kind === 'missing') return t('insights.goal.missing', { duration: formatDuration(goal.minutes) })
  return t('insights.goal.ok')
}

function lineText(row: { plannedMinutes: number; progress: GoalProgress }): string {
  const { line } = row.progress
  const planned = formatDuration(row.plannedMinutes)
  if (line.kind === 'none') return t('insights.goal.none')
  if (line.kind === 'minMet') return t('insights.goal.line.minMet')
  if (line.kind === 'over') return t('insights.goal.line.over', { over: formatDuration(line.overMinutes) })
  const params = { planned, goal: formatDuration(line.goalMinutes), left: formatDuration(line.leftMinutes) }
  return t(`insights.goal.line.${line.kind}`, params)
}

function markerText(row: { category: { goal: { type: string } }; progress: GoalProgress }): string {
  const line = row.progress.line
  if (line.kind === 'none') return ''
  return t(row.category.goal.type === 'max' ? 'insights.goal.markerMax' : 'insights.goal.markerMin', { duration: formatDuration(line.goalMinutes) })
}
</script>

<template>
  <div v-if="document && stats" class="insights">
    <AssistantEntryButton />
    <EmptyState
      v-if="document.categories.length === 0"
      icon="chart-no-axes-column"
      :title="t('insights.empty.title')"
      :description="t('insights.empty.description')"
    />
    <template v-else>
      <WeekBar :categories="document.categories" :planned-minutes="plannedMinutes" />
      <p class="t-subhead t-secondary live-line" data-testid="free-hours-live">{{ t('insights.live', { hours: formatHours(freeHours), count: freeHours }) }}</p>

      <section class="goals" :aria-label="t('insights.goal.title')">
        <h2 class="t-headline">{{ t('insights.goal.title') }}</h2>
        <ul class="rows">
          <li v-for="row in rows" :key="row.category.id" class="row" :data-testid="`goal-row-${row.category.id}`">
            <div class="row-head">
              <span class="swatch" :style="{ background: categoryColor(row.category) }" aria-hidden="true" />
              <span class="t-body name">{{ row.category.name }}</span>
              <span class="t-subhead t-secondary" data-testid="planned">{{ formatDuration(row.plannedMinutes) }}</span>
            </div>
            <div class="scale" aria-hidden="true">
              <div class="track">
                <span class="fill" :style="{ width: `${row.progress.fillPercent}%`, background: categoryColor(row.category) }" />
                <span v-if="row.progress.markerPercent !== null" class="marker" :style="{ left: `${row.progress.markerPercent}%` }" />
              </div>
              <span
                v-if="row.progress.markerPercent !== null"
                class="marker-label t-caption"
                :class="`align-${row.markerAlign}`"
                :style="{ left: `${row.progress.markerPercent}%` }"
                data-testid="goal-marker"
              >{{ markerText(row) }}</span>
            </div>
            <p class="t-subhead goal-line" data-testid="goal-line">{{ lineText(row) }}</p>
            <p v-if="row.goal.kind !== 'none'" class="chip t-footnote" :class="`is-${row.goal.kind}`" data-testid="goal-chip">
              <span aria-hidden="true">{{ row.goal.kind === 'ok' ? '✓' : '!' }}</span>
              {{ chipText(row) }}
            </p>
          </li>
        </ul>
      </section>

      <section class="actuals" :aria-label="t('insights.planVsActual.title')">
        <h2 class="t-headline">{{ t('insights.planVsActual.title') }}</h2>
        <ul v-if="planVsActualRows.length" class="rows">
          <li v-for="row in planVsActualRows" :key="row.categoryId" class="row" :data-testid="`actual-row-${row.categoryId}`">
            <div class="row-head">
              <span class="swatch" :style="{ background: row.color }" aria-hidden="true" />
              <span class="t-body name">{{ row.name }}</span>
              <span class="t-subhead t-secondary" data-testid="actual-value">
                {{ t('insights.planVsActual.value', { actual: formatDuration(row.actualMinutes), planned: formatDuration(row.plannedMinutes) }) }}
              </span>
            </div>
          </li>
        </ul>
        <p v-else class="t-subhead t-secondary empty-line">{{ t('insights.planVsActual.empty') }}</p>
      </section>
    </template>

    <MeasureTiles v-if="measures" :measures="measures" />
  </div>
</template>

<style scoped>
.insights { display: flex; flex-direction: column; gap: var(--space-6); padding: 0 var(--space-4) var(--space-6); }
.live-line { margin: 0; }
.goals, .actuals { display: flex; flex-direction: column; gap: var(--space-3); }
.rows { display: flex; flex-direction: column; gap: 1px; overflow: hidden; background: var(--separator); border-radius: var(--radius-card); }
.row { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4); background: var(--surface); }
/* With large text the figure moves under the name instead of squeezing it. */
.row-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); }
.name { flex: 1 1 6rem; min-width: 0; overflow-wrap: anywhere; }
.swatch { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.scale { position: relative; padding-bottom: var(--space-4); }
.track { position: relative; height: 8px; border-radius: 4px; background: var(--surface-2); }
.marker-label { position: absolute; top: 14px; white-space: nowrap; color: var(--label-2); }
.marker-label.align-center { transform: translateX(-50%); }
.marker-label.align-end { transform: translateX(-100%); }
.goal-line { margin: 0; overflow-wrap: anywhere; }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.marker { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--label); }
.chip { align-self: flex-start; padding: 2px var(--space-2); border-radius: 999px; background: var(--surface-2); color: var(--label-2); }
.chip.is-over, .chip.is-missing { background: color-mix(in srgb, var(--warning) 20%, transparent); color: var(--label); }
.chip.is-ok { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--label); }
.empty-line { padding: var(--space-3) var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
</style>
