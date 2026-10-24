<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { addLocalDays, localDateOf, type DatedOccurrence } from '@/core/time'
import { categoryColor } from '@/features/week/categoryColor'
import { formatDate, formatTime } from '@/features/week/localTime'

type CurrentOccurrence = DatedOccurrence & { minutesLeft: number; progress: number }

const props = defineProps<{
  current: CurrentOccurrence | null
  next: DatedOccurrence | null
  categories: Category[]
  today: string
  timeZone: string
}>()

const { t, locale } = useI18n()

const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const color = computed(() => categoryColor(props.current ? categoriesById.value.get(props.current.categoryId) : undefined))
const range = computed(() => props.current ? `${time(props.current.start)} – ${time(props.current.end)}` : '')
const progressPercent = computed(() => Math.round(Math.min(1, Math.max(0, props.current?.progress ?? 0)) * 1000) / 10)

const minutesLeft = computed(() => {
  const minutes = props.current?.minutesLeft ?? 0
  return minutes >= 60
    ? t('today.now.hoursMinutesLeft', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t('today.now.minutesLeft', { minutes })
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
  return formatTime(instant, locale.value, props.timeZone)
}
</script>

<template>
  <section class="now-card" :style="{ '--block-color': color }" :aria-label="t('today.now.label')" data-testid="now-card">
    <p class="t-footnote now-eyebrow">{{ current ? t('today.now.eyebrow') : t('today.now.freeEyebrow') }}</p>
    <template v-if="current">
      <h2 class="t-title-2 now-title" data-testid="now-title">{{ current.title }}</h2>
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
    <h2 v-else class="t-title-2 now-title" data-testid="now-title">{{ t('today.now.free') }}</h2>
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
  padding: var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.now-eyebrow { margin: 0; color: var(--label-2); font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
.now-title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
