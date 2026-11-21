<script setup lang="ts">
import { tightRange } from './dateText'
import { unbreakable } from '@/ui/inlineText'
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

// The key to the shapes (REVIEW M3): colour is never alone, and only "needs attention" is in colour (amber).
const STATES = ['good', 'amber', 'bad', 'none'] as const

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
  // Each date stays whole; a range across months may break after its dash, never inside a date.
  return tightRange(format.formatRange(new Date(`${first}T12:00:00Z`), new Date(`${last}T12:00:00Z`))).split(/(\s+–\s+)/).map((part, index) => (index % 2 ? part : unbreakable(part))).join('')
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
    <h2 class="section-title">{{ t('insights.measures.title') }}<template v-if="range">{{ ' ' }}<span aria-hidden="true">·</span>{{ ' ' }}<span data-testid="measures-range">{{ range }}</span></template></h2>
    <template v-if="hasData">
      <ul class="key t-caption t-secondary" :aria-label="t('insights.measures.key')">
        <li v-for="state in STATES" :key="state"><span class="dot" :class="`is-${state === 'none' ? 'empty' : state}`" aria-hidden="true" />{{ t(`insights.measures.stateName.${state}`) }}</li>
      </ul>
      <ul class="rows">
        <li v-for="tile in tiles" :key="tile.id" class="row" :data-testid="`measure-${tile.id}`">
          <div class="row-head">
            <h3 class="t-body name">{{ t(`insights.measures.${tile.key}`) }}</h3>
            <p class="t-body value" data-testid="measure-value">{{ tile.value }}</p>
          </div>
          <ul class="dots">
            <li v-for="day in measures.days" :key="day.date" class="dot-item">
              <span class="dot" :class="tile.pick(day) ? `is-${tile.pick(day)}` : 'is-empty'" aria-hidden="true" />
              <span class="t-caption t-secondary" aria-hidden="true">{{ weekday(day.date, 'narrow') }}</span>
              <span class="visually-hidden">{{ weekday(day.date, 'short') }}: {{ t(`insights.measures.state.${tile.pick(day) ?? 'none'}`) }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </template>
    <div v-else class="empty" data-testid="measures-empty">
      <p class="t-subhead">{{ t('insights.measures.emptyBody') }}</p>
      <Button variant="tinted" href="#/checkin">{{ t('insights.measures.emptyAction') }}</Button>
    </div>
  </section>
</template>

<style scoped>
.measures { display: flex; flex-direction: column; gap: var(--space-2); }
.section-title { margin: 0; font-size: 1.25rem; font-weight: 700; }
.key { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: 0; padding: 0; list-style: none; }
.key li { display: inline-flex; align-items: center; gap: var(--space-1); }
.rows { margin: 0; padding: 0; list-style: none; }
.row { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) 0; }
.row + .row { border-top: 0.5px solid var(--separator); }
.row-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 var(--space-3); }
.name { margin: 0; font-weight: 400; min-width: 0; overflow-wrap: break-word; }
.value { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.dots { display: flex; justify-content: space-between; margin: 0; padding: 0 var(--space-2); list-style: none; }
.dot-item { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: var(--space-5); }
/* Shapes carry the state; only "needs attention" is in colour: circle = bien, rounded square = justo, diamond =
   requiere atención (amber, the label tone: 3:1 on the page), ring = sin datos. */
.dot { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 50%; box-sizing: border-box; background: var(--label-2); }
.dot.is-amber { border-radius: 2px; }
.dot.is-bad { width: 9px; height: 9px; border-radius: 1px; background: var(--warning-label); transform: rotate(45deg); }
.dot.is-empty { background: transparent; border: 1.5px solid var(--label-2); }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
/* Forced colours: every filled shape (the amber diamond too, whatever its specificity) in the text colour, the ring as
   an outline; the shapes keep telling the states apart. */
@media (forced-colors: active) {
  .dot, .dot.is-amber, .dot.is-bad { forced-color-adjust: none; background: CanvasText; }
  .dot.is-empty { forced-color-adjust: none; background: transparent; border-color: CanvasText; }
}
</style>
