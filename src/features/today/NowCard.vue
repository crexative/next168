<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { addLocalDays, localDateOf, type DatedOccurrence } from '@/core/time'
import { categoryColor } from '@/features/week/categoryColor'
import { formatTime } from '@/features/week/localTime'
import Button from '@/ui/Button.vue'
import { displayLocale, formatDate, formatDuration } from '@/ui/format'
import WholeWordText from '@/ui/WholeWordText.vue'
import Icon from '@/ui/Icon.vue'
import { inlineSeparators, joinInline } from '@/ui/inlineText'
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
  // On the desktop the page's "Añadir" is the one filled button, so the hero's action is tinted (DIRECTION principle 2).
  quietAction?: boolean
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
// A piece of a split task is heard with its part in words (taskParts.ts).
const spokenTitle = computed(() => primary.value?.kind === 'task' ? primary.value.spokenTitle : undefined)
const left = computed(() => props.state.minutesLeft === null ? '' : t('common.duration.left', { duration: formatDuration(props.state.minutesLeft) }))
const until = computed(() => props.state.endsAt ? untilClock(t, 'today.now.until', time(props.state.endsAt)) : '')

// One line over the title says where "now" sits: "Ahora · En Trabajo". The enclosing routine is named here and nowhere
// else on the screen; its end is not repeated (the line under the title gives the end that matters).
const eyebrow = computed(() => {
  const context = props.state.context
  if (!context) return t('today.now.eyebrow')
  const where = t(context.kind === 'alsoNow' ? 'today.now.alsoWith' : 'today.now.within', { title: context.title })
  return inlineSeparators(joinInline([t('today.now.eyebrow'), context.more > 0 ? `${where} ${t('today.now.more', { count: context.more })}` : where]))
})

const answer = computed(() => props.state.action?.kind === 'ask' ? props.state.action : null)

// While nothing is under way the hero says what comes next, which may be tomorrow and so not in today's list. When
// something is under way the list right below says it, so the hero does not (principle 3).
const next = computed(() => {
  const item = props.state.next
  if (!item || primary.value) return null
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
    <p class="t-footnote now-eyebrow" data-testid="now-eyebrow">
      <span v-if="primary" class="now-dot" aria-hidden="true" />{{ eyebrow }}
    </p>
    <div :key="state.key" class="now-body">
      <h2 class="t-title-1 now-title" data-testid="now-title">
        <Icon v-if="isEvent" name="calendar" :size="20" class="now-glyph" /><template v-if="spokenTitle"><span aria-hidden="true">{{ title }}</span><span class="visually-hidden">{{ spokenTitle }}</span></template><template v-else>{{ title }}</template>
      </h2>
      <p v-if="left" class="now-meta t-body">
        <span class="tabular" data-testid="now-left">{{ left }}</span><template v-if="until"><span class="t-secondary" aria-hidden="true"> · </span><span class="t-secondary tabular" data-testid="now-until">{{ until }}</span></template>
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
      <p v-if="next" class="now-next t-subhead t-secondary" data-testid="now-next">
        <span>{{ t('today.now.next') }}</span>{{ ' ' }}<span aria-hidden="true">·</span>{{ ' ' }}<span class="tabular">{{ next.when }}</span>{{ ' ' }}<span aria-hidden="true">·</span>{{ ' ' }}<WholeWordText class="now-next-title" :text="next.label" />
      </p>
      <!-- The evening's check-in is its own row on the screen ("Cierre del día"), never a second action here. -->
      <div v-if="state.action && state.action.kind !== 'closeDay'" class="now-do" data-testid="now-do">
        <p v-if="!writable" class="t-footnote t-secondary" data-testid="now-read-only">{{ t('today.now.readOnly') }}</p>
        <Button
          v-else-if="state.action.kind === 'task'"
          :variant="quietAction ? 'tinted' : 'filled'"
          block
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
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The Ahora hero (R_Hoy): one soft card, one clear action. */
.now-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0 var(--page-gutter);
  padding: var(--space-5);
  border-radius: 20px;
  background: var(--surface-2);
}
.now-eyebrow { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--label-2); font-weight: 600; }
.now-dot { flex: none; width: 8px; height: 8px; border-radius: 4px; background: var(--block-color); }
.now-body { display: flex; flex-direction: column; gap: var(--space-2); animation: now-appear 150ms linear; }
@keyframes now-appear { from { opacity: 0; } to { opacity: 1; } }
/* The title wraps instead of being cut: a long block name is longer than a phone line. */
.now-title { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.now-glyph { display: inline-block; margin-inline-end: 6px; vertical-align: -2px; color: var(--label-2); }
.now-meta { margin: 0; }
.tabular { font-variant-numeric: tabular-nums; }
.progress { height: 4px; margin: var(--space-1) 0 var(--space-2); overflow: hidden; border-radius: 2px; background: var(--fill); }
.progress-fill { display: block; height: 100%; border-radius: 2px; background: var(--block-color); }
.now-next { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1); margin: 0; }
.now-next-title { flex: 1 1 8rem; color: var(--label); font-weight: 600; }
.now-do { display: flex; flex-direction: column; gap: var(--space-2); }
.now-do p { margin: 0; }
@media (prefers-reduced-motion: reduce) {
  .now-body { animation-duration: 150ms; }
}
</style>
