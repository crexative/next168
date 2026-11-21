<script setup lang="ts">
import { inlineSeparators } from '@/ui/inlineText'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateOf } from '@/core/time'
import type { Category } from '@/core/model'
import { computeStats, planVsActual, sevenDayMeasures } from '@/core/stats'
import EmptyState from '@/ui/EmptyState.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import AssistantEntryButton from '@/features/assistant/AssistantEntryButton.vue'
import ShareWeekButton from '@/features/share/ShareWeekButton.vue'
import { freeHoursWhole } from '@/features/capacity/freeHours'
import { useNow } from '@/features/week/useNow'
import { weekDates } from '@/features/week/localTime'
import { weekRangeLabel } from '@/features/week/weekNavigation'
import Icon from '@/ui/Icon.vue'
import { EXERCISE_ICON } from './exercise'
import MeasureTiles from './MeasureTiles.vue'
import WeekBar from './WeekBar.vue'
import { categoryColor } from './categoryColor'
import { formatDate, formatTotal, formatWholeHours, totalCount } from '@/ui/format'
import { goalFigures, goalProgress } from './goalLine'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const freeHours = computed(() => (document.value ? freeHoursWhole(document.value, now.value, document.value.settings.timeZone) : 0))
// "Semana del 16 al 22 nov": the week the free hours and the goals are about. The first day names its month only when
// the week crosses into another one.
const subtitle = computed(() => {
  const doc = document.value
  if (!doc) return ''
  const today = localDateOf(now.value, doc.settings.timeZone)
  const dates = weekDates(today, doc.settings.weekStartsOn)
  const first = dates[0]!, last = dates[6]!
  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  return t('insights.subtitle', {
    from: formatDate(first, locale.value, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }),
    to: formatDate(last, locale.value, { day: 'numeric', month: 'short' }),
    // For a language whose words do not fit "from … to …" ("Week of Oct 19–25").
    range: weekRangeLabel(dates, locale.value, today),
  })
})
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
    return [{ category, progress, hours: goalFigures(progress.line, planned), actual }]
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
  // One rule with the week's legend: every figure goes through formatTotal.
  const { plannedMinutes, goalMinutes, amountMinutes } = row.hours
  const amount = formatTotal(amountMinutes)
  // Nothing planned yet reads "0 h", like the week's other totals, rather than "0 min".
  const planned = plannedMinutes === 0 ? formatWholeHours(0) : formatTotal(plannedMinutes)
  const params = { planned, goal: formatTotal(goalMinutes), left: amount, over: amount, count: totalCount(amountMinutes) }
  return inlineSeparators(t(`insights.goals.line.${line.kind}`, params))
}

function doneText(row: Row): string {
  return t('insights.goals.done', { actual: formatTotal(row.actual!.actualMinutes), planned: formatTotal(row.actual!.plannedMinutes) })
}
</script>

<template>
  <div v-if="document && stats" class="insights">
    <p class="insights-subtitle t-subhead t-secondary" data-testid="insights-subtitle">{{ subtitle }}</p>
    <AssistantEntryButton />
    <EmptyState
      v-if="document.categories.length === 0 && rows.length === 0"
      icon="chart-no-axes-column"
      :title="t('insights.empty.title')"
      :description="t('insights.empty.description')"
    />
    <template v-else>
      <section class="week" :aria-label="t('insights.bar.title')">
        <h2 class="headline t-title-1" data-testid="free-hours-live">{{ t('capacity.badge', { hours: freeHours }, freeHours) }}</h2>
        <WeekBar :categories="document.categories" :planned-minutes="plannedMinutes" />
        <ShareWeekButton v-if="document.blocks.length > 0" />
      </section>

      <section class="goals" :aria-label="t('insights.goals.title')">
        <h2 class="section-title">{{ t('insights.goals.title') }}</h2>
        <ul v-if="rows.length" class="rows">
          <li v-for="row in rows" :key="row.category.id" class="row" :data-testid="`goal-row-${row.category.id}`">
            <div class="row-head">
              <span class="swatch" :style="{ background: categoryColor(row.category) }" aria-hidden="true" />
              <span class="t-body name">{{ row.category.name }}</span>
            </div>
            <template v-if="row.progress.line.kind !== 'none'">
              <!-- Calm when on track: only a goal that needs attention speaks, in amber with its icon (principle 7). -->
              <p class="t-subhead goal-line" :class="{ 'is-attention': row.hours.state === 'attention' }" data-testid="goal-line">
                <Icon v-if="row.hours.state === 'attention'" name="triangle-alert" :size="16" class="goal-icon" data-testid="goal-state" />{{ lineText(row) }}
              </p>
              <div class="track" aria-hidden="true">
                <span class="fill" :style="{ width: `${row.progress.fillPercent}%`, background: categoryColor(row.category) }" />
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
.insights { display: flex; flex-direction: column; gap: var(--section-gap); padding: 0 var(--page-gutter) var(--space-6); }
.insights-subtitle { margin: calc(var(--header-gap) * -1) 0 calc(var(--space-5) - var(--section-gap)); font-variant-numeric: tabular-nums; }
.week { display: flex; flex-direction: column; gap: var(--space-3); }
/* The week's headline: what is free, the figure people come for (R_Resumen). */
.headline { margin: 0; min-width: 0; overflow-wrap: normal; text-wrap: balance; font-variant-numeric: tabular-nums; }
.section-title { margin: 0; font-size: 1.25rem; font-weight: 700; }
.goals { display: flex; flex-direction: column; gap: var(--space-1); }
.rows { margin: 0; padding: 0; list-style: none; }
.row { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3) 0; }
.row + .row { border-top: 0.5px solid var(--separator); }
.row-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
/* Words wrap between words; only a single word longer than the line is broken. */
.name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: break-word; }
.swatch { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.goal-line, .actual-line { margin: 0; min-width: 0; color: var(--label-2); overflow-wrap: break-word; }
.goal-line.is-attention { color: var(--warning-label); }
.goal-icon { margin-inline-end: var(--space-1); vertical-align: -2px; }
.track { position: relative; height: 4px; border-radius: 2px; background: var(--fill); }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; }
.empty-line { margin: 0; }
</style>
