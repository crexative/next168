<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateOf } from '@/core/time'
import type { Category } from '@/core/model'
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
import { formatHours, formatTotal, formatWholeHours, formatWholeNumber } from '@/ui/format'
import { goalHours, goalProgress } from './goalLine'

const { t } = useI18n()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const freeHours = computed(() => (document.value ? freeHoursWhole(document.value, now.value, document.value.settings.timeZone) : 0))
const stats = computed(() => (document.value ? computeStats(document.value) : null))
const plannedMinutes = computed(() => Object.fromEntries((stats.value?.categories ?? []).map((row) => [row.categoryId, row.plannedMinutes])))

// One row per goal or retained actual, including history whose category has been removed.
const rows = computed(() => {
  const doc = document.value
  if (!doc || !stats.value) return []
  const actuals = planVsActual(doc.actuals)
  const categoryIds = new Set([...doc.categories.map((category) => category.id), ...Object.keys(actuals)])
  return [...categoryIds].flatMap((categoryId) => {
    const category: Category = doc.categories.find((candidate) => candidate.id === categoryId) ?? {
      id: categoryId, name: t('insights.goals.deletedCategory'), colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 },
    }
    const actual = actuals[categoryId]
    if (category.goal.type === 'none' && !actual) return []
    const planned = plannedMinutes.value[categoryId] ?? 0
    const progress = goalProgress(category.goal, planned)
    return [{ category, progress, hours: goalHours(progress.line, planned), actual }]
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

type Row = (typeof rows.value)[number]

function lineText(row: Row): string {
  const { line } = row.progress
  if (line.kind === 'none') return ''
  const { planned, goal, amount } = row.hours
  const params = {
    planned: formatWholeNumber(planned), goal: formatWholeHours(goal),
    left: formatWholeHours(amount), over: formatWholeHours(amount), count: amount,
  }
  return t(`insights.goals.line.${line.kind}`, params)
}

function doneText(row: Row): string {
  return t('insights.goals.done', { actual: formatTotal(row.actual!.actualMinutes), planned: formatTotal(row.actual!.plannedMinutes) })
}
</script>

<template>
  <div v-if="document && stats" class="insights">
    <AssistantEntryButton />
    <EmptyState
      v-if="document.categories.length === 0 && rows.length === 0"
      icon="chart-no-axes-column"
      :title="t('insights.empty.title')"
      :description="t('insights.empty.description')"
    />
    <template v-else>
      <WeekBar :categories="document.categories" :planned-minutes="plannedMinutes">
        <p class="t-subhead live-line" data-testid="free-hours-live">{{ t('insights.bar.live', { hours: formatHours(freeHours), count: freeHours }) }}</p>
      </WeekBar>

      <section class="goals" :aria-label="t('insights.goals.title')">
        <h2 class="t-headline">{{ t('insights.goals.title') }}</h2>
        <ul v-if="rows.length" class="rows">
          <li v-for="row in rows" :key="row.category.id" class="row" :data-testid="`goal-row-${row.category.id}`">
            <div class="row-head">
              <span class="swatch" :style="{ background: categoryColor(row.category) }" aria-hidden="true" />
              <span class="t-body name">{{ row.category.name }}</span>
              <span v-if="row.hours.state" class="state" :class="`is-${row.hours.state}`" aria-hidden="true" data-testid="goal-state">{{ row.hours.state === 'ok' ? '✓' : '!' }}</span>
            </div>
            <template v-if="row.progress.line.kind !== 'none'">
              <p class="t-subhead goal-line" data-testid="goal-line">{{ lineText(row) }}</p>
              <div class="track" aria-hidden="true">
                <span class="fill" :style="{ width: `${row.progress.fillPercent}%`, background: categoryColor(row.category) }" />
                <span v-if="row.progress.markerPercent !== null" class="marker" :style="{ left: `${row.progress.markerPercent}%` }" />
              </div>
            </template>
            <p v-if="row.actual" class="t-footnote t-secondary actual-line" data-testid="actual-line">{{ doneText(row) }}</p>
          </li>
        </ul>
        <p v-else class="t-subhead t-secondary empty-line" data-testid="goals-empty">{{ t('insights.goals.empty') }}</p>
      </section>
    </template>

    <MeasureTiles v-if="measures" :measures="measures" />
  </div>
</template>

<style scoped>
.insights { display: flex; flex-direction: column; gap: var(--space-6); padding: 0 var(--space-4) var(--space-6); }
.live-line { margin: var(--space-1) 0 0; }
.goals { display: flex; flex-direction: column; gap: var(--space-3); }
.rows { display: flex; flex-direction: column; gap: 1px; overflow: hidden; margin: 0; padding: 0; list-style: none; background: var(--separator); border-radius: var(--radius-card); }
.row { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3) var(--space-4); background: var(--surface); }
.row-head { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
/* Words wrap between words; only a single word longer than the line is broken. */
.name { flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; }
.swatch { width: 12px; height: 12px; border-radius: 50%; flex: none; }
/* The state is a mark, not colour alone: ✓ or ! inside a tinted disc. */
.state { display: grid; place-items: center; flex: none; width: 1.5rem; height: 1.5rem; border-radius: 50%; font-weight: 700; color: var(--label); }
.state.is-ok { background: color-mix(in srgb, var(--success) 20%, transparent); }
.state.is-attention { background: color-mix(in srgb, var(--warning) 20%, transparent); }
.goal-line, .actual-line { margin: 0; min-width: 0; overflow-wrap: break-word; }
.track { position: relative; height: 8px; border-radius: 4px; background: var(--surface-2); }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.marker { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--label); }
.empty-line { margin: 0; padding: var(--space-3) var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
</style>
