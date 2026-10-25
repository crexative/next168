<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import { addLocalDays, localDateOf, type DatedOccurrence } from '@/core/time'
import { categoryColor } from '@/features/week/categoryColor'
import { formatDate, formatTime } from '@/features/week/localTime'
import ItemStatusControl from './ItemStatusControl.vue'
import { actualFor, type ActualStatus } from './actuals'
import { untilClock } from './clockPhrase'
import type { NextUp } from './nextUp'
import { isReportable } from './statusWindow'
import { displayLocale, formatDuration } from '@/ui/format'

type CurrentOccurrence = DatedOccurrence & { minutesLeft: number; progress: number }

const props = defineProps<{
  current: CurrentOccurrence | null
  next: NextUp | null
  categories: Category[]
  actuals: BlockActual[]
  // False for a block that started before the plan existed: there is nothing to report on it.
  askable: boolean
  writable: boolean
  now: Date
  today: string
  timeZone: string
}>()
const emit = defineEmits<{
  record: [occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number]
  clear: [occurrence: DatedOccurrence]
}>()

const { t, locale } = useI18n()

const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const color = computed(() => categoryColor(props.current ? categoriesById.value.get(props.current.categoryId) : undefined))
const range = computed(() => props.current ? `${time(props.current.start)} – ${time(props.current.end)}` : '')
const progressPercent = computed(() => Math.round(Math.min(1, Math.max(0, props.current?.progress ?? 0)) * 1000) / 10)

const minutesLeft = computed(() => {
  const minutes = props.current?.minutesLeft ?? 0
  return t('common.duration.left', { duration: formatDuration(minutes) })
})

// Mid-block the card only tells the time left; the question comes in the block's last minutes, or stays once answered.
const currentActual = computed(() => props.current ? actualFor(props.actuals, props.current) : undefined)
const asksNow = computed(() => props.current !== null && props.askable && (isReportable(props.current, props.now) || currentActual.value !== undefined))

// A free moment says when it ends, but only when the next thing starts today (otherwise "Después" names the day).
const freeTitle = computed(() => {
  if (!props.next || localDateOf(props.next.start, props.timeZone) !== props.today) return t('today.now.free')
  return untilClock(t, 'today.now.freeUntil', time(props.next.start))
})

const nextWhen = computed(() => {
  if (!props.next) return ''
  const startDate = localDateOf(props.next.start, props.timeZone)
  const at = time(props.next.start)
  if (startDate === props.today) return at
  if (startDate === addLocalDays(props.today, 1)) return t('today.now.tomorrowAt', { time: at })
  return t('today.now.dayAt', { day: formatDate(startDate, locale.value, { weekday: 'long' }), time: at })
})

function time(instant: string): string {
  return formatTime(instant, displayLocale.value, props.timeZone)
}
</script>

<template>
  <section class="now-card" :style="{ '--block-color': color }" :aria-label="t('today.now.label')" data-testid="now-card">
    <p class="t-footnote now-eyebrow" data-testid="now-eyebrow">{{ t('today.now.eyebrow') }}</p>
    <template v-if="current">
      <div class="now-head">
        <h2 class="t-title-2 now-title" data-testid="now-title">{{ current.title }}</h2>
        <ItemStatusControl
          v-if="asksNow"
          class="now-status"
          :item-key="`${current.blockId}@${current.start}`"
          :title="current.title"
          :status="currentActual?.status"
          :actual-minutes="currentActual?.actualMinutes"
          :planned-minutes="current.plannedMinutes"
          :writable="writable"
          @record="(status, minutes) => emit('record', current!, status, minutes)"
          @clear="emit('clear', current!)"
        />
      </div>
      <p class="now-meta t-subhead">
        <span class="tabular">{{ range }}</span>
        <span class="tabular now-left" data-testid="now-left">{{ minutesLeft }}</span>
      </p>
      <div
        class="progress"
        role="progressbar"
        :aria-label="t('today.now.progress')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(progressPercent)"
      >
        <span class="progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
    </template>
    <h2 v-else class="t-title-2 now-title" data-testid="now-title">{{ freeTitle }}</h2>
    <p class="now-next t-subhead" data-testid="now-next">
      <template v-if="next">
        <span class="now-next-label">{{ t('today.now.next') }}</span>
        <span class="now-next-title">{{ next.title }}</span>
        <span class="tabular t-secondary">{{ nextWhen }}</span>
      </template>
      <span v-else class="t-secondary">{{ t('today.now.nothingNext') }}</span>
    </p>
  </section>
</template>

<style scoped>
.now-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 var(--space-4);
  padding: var(--card-padding-block) var(--card-padding);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.now-eyebrow { margin: 0; color: var(--label-2); font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
.now-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
/* The title wraps instead of being cut: "Tiempo libre hasta las 11:00 p. m." is longer than a phone line. */
.now-title { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.now-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); margin: 0; }
.now-left { font-weight: 600; }
.tabular { font-variant-numeric: tabular-nums; }
.progress { height: 6px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--block-color) 20%, var(--surface-2)); }
.progress-fill { display: block; height: 100%; border-radius: 3px; background: var(--block-color); }
.now-next {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: var(--space-1) 0 0;
  padding-top: var(--space-2);
  border-top: 0.5px solid var(--separator);
  min-height: 1.5rem;
}
.now-next-label { color: var(--label-2); }
.now-next-title { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
</style>
