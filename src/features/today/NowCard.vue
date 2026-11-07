<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { addLocalDays, localDateOf, type DatedOccurrence } from '@/core/time'
import { categoryColor } from '@/features/week/categoryColor'
import { formatTime } from '@/features/week/localTime'
import Button from '@/ui/Button.vue'
import { displayLocale, formatDate, formatDuration } from '@/ui/format'
import Icon from '@/ui/Icon.vue'
import { inlineSeparators } from '@/ui/inlineText'
import WholeWordText from '@/ui/WholeWordText.vue'
import type { ActualStatus } from './actuals'
import { untilClock } from './clockPhrase'
import NowAnswer from './NowAnswer.vue'
import type { NowState } from './nowState'

const props = defineProps<{
  state: NowState
  categories: Category[]
  writable: boolean
  today: string
  timeZone: string
}>()
const emit = defineEmits<{
  record: [occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number]
  completeTask: [taskId: string, title: string]
}>()

const { t, locale } = useI18n()

const primary = computed(() => props.state.primary)
const isEvent = computed(() => primary.value?.kind === 'event' || primary.value?.kind === 'external')
const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
// An event is not part of the person's plan, so it has no category: its bar is the neutral secondary label.
const color = computed(() => {
  const item = primary.value
  if (!item || (item.kind !== 'block' && item.kind !== 'task')) return 'var(--label-2)'
  return categoryColor(categoriesById.value.get(item.categoryId))
})
const progressPercent = computed(() => Math.round(Math.min(1, Math.max(0, props.state.progress ?? 0)) * 1000) / 10)

const title = computed(() => primary.value?.title ?? t('today.now.free'))
const left = computed(() => props.state.minutesLeft === null ? '' : t('common.duration.left', { duration: formatDuration(props.state.minutesLeft) }))
const until = computed(() => props.state.endsAt ? untilClock(t, 'today.now.until', time(props.state.endsAt)) : '')

const contextText = computed(() => {
  const context = props.state.context
  if (!context) return ''
  const line = untilClock(t, `today.now.${context.kind}`, time(context.end), { title: context.title })
  return inlineSeparators(context.more > 0 ? `${line} ${t('today.now.more', { count: context.more })}` : line)
})

const answer = computed(() => props.state.action?.kind === 'ask' ? props.state.action : null)

const next = computed(() => {
  const item = props.state.next
  if (!item) return null
  const startDate = localDateOf(item.start, props.timeZone)
  const at = time(item.start)
  const when = startDate === props.today ? at
    : startDate === addLocalDays(props.today, 1) ? t('today.now.tomorrowAt', { time: at })
      : t('today.now.dayAt', { day: formatDate(startDate, locale.value, { weekday: 'long' }), time: at })
  const label = item.kind === 'free' ? untilClock(t, 'today.now.freeUntil', time(item.until)) : item.title
  return { when, label }
})

function time(instant: string): string {
  return formatTime(instant, displayLocale.value, props.timeZone)
}
</script>

<template>
  <section class="now-card" :style="{ '--block-color': color }" :aria-label="t('today.now.label')" data-testid="now-card">
    <p class="t-footnote now-eyebrow" data-testid="now-eyebrow">{{ t('today.now.eyebrow') }}</p>
    <div :key="state.key" class="now-body">
      <h2 class="t-title-2 now-title" data-testid="now-title">
        <Icon v-if="isEvent" name="calendar" :size="14" class="now-glyph" />{{ title }}
      </h2>
      <p v-if="left" class="now-meta">
        <span class="t-headline tabular" data-testid="now-left">{{ left }}</span>
        <span class="t-subhead t-secondary tabular" data-testid="now-until">{{ until }}</span>
      </p>
      <div
        v-if="primary"
        class="progress"
        role="progressbar"
        :aria-label="t('today.now.progress')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(progressPercent)"
        :aria-valuetext="left"
      >
        <span class="progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p v-if="contextText" class="now-context t-subhead t-secondary" data-testid="now-context">{{ contextText }}</p>
      <div v-if="state.action" class="now-do" data-testid="now-do">
        <p v-if="!writable && state.action.kind !== 'closeDay'" class="t-footnote t-secondary" data-testid="now-read-only">{{ t('today.now.readOnly') }}</p>
        <Button
          v-else-if="state.action.kind === 'task'"
          variant="tinted"
          data-testid="now-complete"
          @click="emit('completeTask', state.action.taskId, state.action.title)"
        >{{ t('today.now.completeTask') }}</Button>
        <NowAnswer
          v-else-if="answer"
          :ask-title="answer.own ? undefined : answer.occurrence.title"
          :status="answer.actual?.status"
          :actual-minutes="answer.actual?.actualMinutes"
          :planned-minutes="answer.occurrence.plannedMinutes"
          :writable="writable"
          :occurrence-key="`${answer.occurrence.blockId}@${answer.occurrence.start}`"
          @record="(status, minutes) => emit('record', answer!.occurrence, status, minutes)"
        />
        <Button v-else variant="tinted" href="#/checkin" data-testid="now-close-day">
          {{ t('today.now.closeDay') }}
          <Icon name="chevron-right" :size="20" />
        </Button>
      </div>
    </div>
    <p class="now-next t-subhead" data-testid="now-next">
      <template v-if="next">
        <span class="now-next-label t-secondary">{{ t('today.now.next') }}</span>{{ ' ' }}<span class="t-secondary" aria-hidden="true">·</span>{{ ' ' }}<span class="tabular t-secondary">{{ next.when }}</span>{{ ' ' }}<span class="t-secondary" aria-hidden="true">·</span>{{ ' ' }}<WholeWordText class="now-next-title" :text="next.label" />
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
  margin: 0 var(--page-gutter);
  padding: var(--card-padding-block) var(--card-padding);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.now-eyebrow { margin: 0; color: var(--label-2); font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
.now-body { display: flex; flex-direction: column; gap: var(--space-2); animation: now-appear 150ms linear; }
@keyframes now-appear { from { opacity: 0; } to { opacity: 1; } }
/* The title wraps instead of being cut: a long block name is longer than a phone line. */
.now-title { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.now-glyph { display: inline-block; margin-inline-end: 4px; vertical-align: baseline; color: var(--label-2); }
.now-meta { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); margin: 0; }
.tabular { font-variant-numeric: tabular-nums; }
.progress { height: 6px; overflow: hidden; border-radius: 3px; background: color-mix(in srgb, var(--block-color) 20%, var(--surface-2)); }
.progress-fill { display: block; height: 100%; border-radius: 3px; background: var(--block-color); }
.now-context { margin: 0; }
.now-do { display: flex; flex-direction: column; gap: var(--space-2); }
.now-do p { margin: 0; }
.now-next {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
  padding-top: var(--space-2);
  border-top: 0.5px solid var(--separator);
  min-height: 1.5rem;
}
.now-next-title { flex: 1 1 8rem; font-weight: 600; color: var(--label); }
@media (prefers-reduced-motion: reduce) {
  .now-body { animation-duration: 150ms; }
}
</style>
