<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MeasureState } from '@/core/stats'
import Button from '@/ui/Button.vue'
import { formatDuration, formatWholeNumber } from '@/ui/format'

type Day = { date: string; sleep: MeasureState; exercise: MeasureState; lateWork: MeasureState; stress: MeasureState }
type Measures = {
  averageSleepMinutes: number | null
  exerciseCount: number
  exerciseTarget: number
  lateWorkNights: number
  averageStress: number | null
  days: Day[]
}

const props = defineProps<{ measures: Measures }>()
const { t, locale } = useI18n()

const hasData = computed(() => props.measures.days.some((day) => day.sleep || day.exercise || day.lateWork || day.stress))

function weekday(date: string, style: 'short' | 'narrow'): string {
  return new Intl.DateTimeFormat(locale.value, { weekday: style, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

// The window rolls (today and the six days before), so it is named by its dates, not by a weekday.
const range = computed(() => {
  const first = props.measures.days[0]?.date
  const last = props.measures.days.at(-1)?.date
  if (!first || !last) return ''
  // formatRange is in every supported browser but not yet in the project's TypeScript lib.
  const format = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }) as Intl.DateTimeFormat & { formatRange(start: Date, end: Date): string }
  return format.formatRange(new Date(`${first}T12:00:00Z`), new Date(`${last}T12:00:00Z`))
})

const tiles = computed(() => {
  const { measures } = props
  return [
    {
      id: 'sleep', key: 'averageSleep',
      value: measures.averageSleepMinutes === null ? t('insights.measures.none') : formatDuration(measures.averageSleepMinutes),
      pick: (day: Day) => day.sleep,
    },
    {
      id: 'exercise', key: 'exercise',
      value: measures.exerciseTarget > 0
        ? t('insights.measures.exerciseOfTarget', { count: measures.exerciseCount, target: measures.exerciseTarget })
        : String(measures.exerciseCount),
      pick: (day: Day) => day.exercise,
    },
    { id: 'late-work', key: 'lateWork', value: String(measures.lateWorkNights), pick: (day: Day) => day.lateWork },
    {
      id: 'stress', key: 'stress',
      value: measures.averageStress === null ? t('insights.measures.none') : formatWholeNumber(measures.averageStress, locale.value),
      pick: (day: Day) => day.stress,
    },
  ]
})
</script>

<template>
  <section class="measures" :aria-label="t('insights.measures.title')">
    <h2 class="t-headline">{{ t('insights.measures.title') }}</h2>
    <p v-if="range" class="t-footnote t-secondary range" data-testid="measures-range">{{ range }}</p>
    <div v-if="hasData" class="tiles">
      <article v-for="tile in tiles" :key="tile.id" class="tile" :data-testid="`measure-${tile.id}`">
        <h3 class="t-footnote t-secondary">{{ t(`insights.measures.${tile.key}`) }}</h3>
        <p class="t-title-2" data-testid="measure-value">{{ tile.value }}</p>
        <ul class="dots">
          <li v-for="day in measures.days" :key="day.date" class="dot-item">
            <span class="dot" :class="tile.pick(day) ? `is-${tile.pick(day)}` : 'is-empty'" aria-hidden="true" />
            <span class="t-caption t-secondary" aria-hidden="true">{{ weekday(day.date, 'narrow') }}</span>
            <span class="visually-hidden">{{ weekday(day.date, 'short') }}: {{ t(`insights.measures.state.${tile.pick(day) ?? 'none'}`) }}</span>
          </li>
        </ul>
      </article>
    </div>
    <div v-else class="empty" data-testid="measures-empty">
      <p class="t-subhead">{{ t('insights.measures.emptyBody') }}</p>
      <Button variant="tinted" href="#/checkin">{{ t('insights.measures.emptyAction') }}</Button>
    </div>
  </section>
</template>

<style scoped>
.measures { display: flex; flex-direction: column; gap: var(--space-3); }
.measures h2 { margin-bottom: calc(var(--space-2) * -1); }
.range { margin: 0; }
/* min() lets a tile shrink to the column: at 200 % text 14rem is wider than a phone screen. */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr)); gap: var(--space-3); }
.tile { display: flex; min-width: 0; flex-direction: column; gap: var(--space-1); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
.dots { display: flex; justify-content: space-between; margin-top: var(--space-2); }
.dot-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--label-3); box-sizing: border-box; }
.dot.is-good { background: var(--success); border-color: var(--success); }
.dot.is-amber { background: var(--warning); border-color: var(--warning); border-radius: 3px; }
.dot.is-bad { background: var(--danger); border-color: var(--danger); border-radius: 0; transform: rotate(45deg); }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
</style>
