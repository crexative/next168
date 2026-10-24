<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant, type DatedOccurrence } from '@/core/time'
import Button from '@/ui/Button.vue'
import CategoryMark from '@/ui/CategoryMark.vue'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale } from '@/ui/format'
import Icon from '@/ui/Icon.vue'
import { formatMinute, formatTime } from '@/features/week/localTime'
import { actualFor, type ActualStatus } from './actuals'
import { continuationHints } from './continuationHints'
import type { AllDayItem, TimelineItem } from './todayTimeline'

const props = defineProps<{
  items: TimelineItem[]
  allDay: AllDayItem[]
  actuals: BlockActual[]
  categories: Category[]
  now: Date
  timeZone: string
  writable: boolean
}>()
const emit = defineEmits<{
  record: [occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number]
  clear: [occurrence: DatedOccurrence]
}>()

const { t, locale } = useI18n()
const formId = useId()
const STATUSES: ActualStatus[] = ['done', 'partial', 'skipped']

const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))
const partialKey = ref<string | null>(null)
const partialMinutes = ref(0)

function categoryOf(item: TimelineItem): Category | undefined {
  return item.kind === 'block' || item.kind === 'task' ? categoriesById.value.get(item.categoryId) : undefined
}

function color(item: TimelineItem): string {
  return item.kind === 'block' || item.kind === 'task' ? categoryStroke(categoryOf(item)) : 'var(--label-2)'
}

const dayBounds = computed(() => {
  const today = localDateOf(props.now, props.timeZone)
  return { start: zonedInstant(today, 0, props.timeZone).getTime(), end: zonedInstant(addLocalDays(today, 1), 0, props.timeZone).getTime() }
})

// Items crossing midnight show the part that falls on today, so the two halves of an overnight block differ.
function startsBeforeToday(item: TimelineItem): boolean {
  return Date.parse(item.start) < dayBounds.value.start
}

function endsAfterToday(item: TimelineItem): boolean {
  return Date.parse(item.end) > dayBounds.value.end
}

function startLabel(item: TimelineItem): string {
  return startsBeforeToday(item) ? formatMinute(0, displayLocale.value) : formatTime(item.start, displayLocale.value, props.timeZone)
}

function endLabel(item: TimelineItem): string {
  return endsAfterToday(item) ? formatMinute(0, displayLocale.value) : formatTime(item.end, displayLocale.value, props.timeZone)
}

function hasStarted(item: TimelineItem): boolean {
  return Date.parse(item.start) <= props.now.getTime()
}

function isPast(item: TimelineItem): boolean {
  return Date.parse(item.end) <= props.now.getTime()
}

function statusOf(occurrence: DatedOccurrence): ActualStatus | undefined {
  return actualFor(props.actuals, occurrence)?.status
}

function choose(item: TimelineItem & { kind: 'block' }, status: ActualStatus): void {
  const current = actualFor(props.actuals, item.occurrence)
  if (current?.status === status) {
    partialKey.value = null
    emit('clear', item.occurrence)
    return
  }
  if (status === 'partial') {
    partialKey.value = item.key
    partialMinutes.value = current?.status === 'partial' ? current.actualMinutes ?? 0 : Math.round(item.occurrence.plannedMinutes / 2)
    return
  }
  partialKey.value = null
  emit('record', item.occurrence, status)
}

function savePartial(item: TimelineItem & { kind: 'block' }): void {
  emit('record', item.occurrence, 'partial', partialMinutes.value)
  partialKey.value = null
}
</script>

<template>
  <section class="timeline-section" :aria-label="t('today.timeline.label')">
    <h2 class="t-headline section-title">{{ t('today.timeline.title') }}</h2>
    <ul v-if="allDay.length" class="all-day">
      <li v-for="item in allDay" :key="item.key" class="all-day-item t-footnote">
        <span class="t-secondary">{{ t('today.timeline.allDay') }}</span> {{ item.title }}
      </li>
    </ul>
    <ol class="timeline">
      <li
        v-for="item in items"
        :key="item.key"
        class="row"
        :class="[`is-${item.kind}`, { 'is-past': isPast(item), 'is-conflict': item.conflict }]"
        :style="{ '--item-color': color(item) }"
        :data-kind="item.kind"
        data-testid="timeline-item"
      >
        <span class="row-time t-footnote">
          <span data-testid="timeline-start">{{ startLabel(item) }}</span>
          <span class="t-secondary" data-testid="timeline-end">{{ endLabel(item) }}</span>
        </span>
        <span class="row-bar" aria-hidden="true" />
        <div class="row-content">
          <p class="row-title t-body">
            <CategoryMark v-if="categoryOf(item)" :category="categoryOf(item)" />
            <span class="row-title-text">{{ item.title }}</span>
            <span v-if="item.conflict" class="badge is-conflict t-caption" data-testid="conflict-mark">
              <Icon name="triangle-alert" :size="14" />{{ t('today.timeline.conflict') }}
            </span>
            <span v-if="item.kind === 'task' && item.late" class="badge is-late t-caption">{{ t('today.timeline.late') }}</span>
          </p>
          <p v-if="categoryOf(item) && categoryOf(item)!.name !== item.title" class="row-kind t-footnote t-secondary" data-testid="timeline-category">{{ categoryOf(item)!.name }}</p>
          <p
            v-for="hint in continuationHints(item, now, timeZone, locale)"
            :key="hint.key"
            class="row-kind t-footnote t-secondary"
            data-testid="timeline-span-hint"
          >{{ t(hint.key, hint.params) }}</p>
          <p v-if="item.kind !== 'block'" class="row-kind t-footnote t-secondary">{{ t(`today.timeline.kinds.${item.kind}`) }}</p>
          <template v-if="item.kind === 'block' && hasStarted(item)">
            <div class="actual" role="group" :aria-label="t('today.actual.question', { title: item.title })">
              <button
                v-for="status in STATUSES"
                :key="status"
                type="button"
                class="actual-choice t-subhead"
                :class="`is-${status}`"
                :aria-pressed="statusOf(item.occurrence) === status"
                :disabled="!writable"
                @click="choose(item, status)"
              >
                {{ t(`today.actual.${status}`) }}
              </button>
            </div>
            <form v-if="partialKey === item.key" class="partial" @submit.prevent="savePartial(item)">
              <label class="partial-label t-footnote" :for="`${formId}-${item.key}`">{{ t('today.actual.minutesLabel', { planned: item.occurrence.plannedMinutes }) }}</label>
              <input
                :id="`${formId}-${item.key}`"
                v-model.number="partialMinutes"
                class="input partial-input"
                type="number"
                inputmode="numeric"
                min="0"
                :max="item.occurrence.plannedMinutes"
                step="5"
              >
              <Button type="submit" variant="tinted">{{ t('today.actual.savePartial') }}</Button>
            </form>
          </template>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.timeline-section { margin: var(--space-6) var(--space-4) 0; }
.section-title { margin: 0 0 var(--space-2); }
.all-day { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-2); padding: 0; list-style: none; }
.all-day-item { padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
.timeline { margin: 0; padding: 0; list-style: none; border-radius: var(--radius-card); background: var(--surface); }
.row { display: grid; grid-template-columns: 4.5rem 3px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.row + .row { border-top: 0.5px solid var(--separator); }
.row-time { display: flex; flex-direction: column; align-items: flex-end; text-align: end; font-variant-numeric: tabular-nums; }
.row-bar { border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 4px, transparent 4px 7px); }
.is-event .row-bar, .is-external .row-bar { background: transparent; border-inline-start: 2px dashed var(--item-color); }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.row-title-text { flex: 1 1 8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row-kind { margin: -0.25rem 0 0; }
.badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-2); border-radius: 999px; }
.badge.is-conflict { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-label); }
.badge.is-late { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--label); }
.actual { display: flex; flex-wrap: wrap; gap: var(--space-1); }
/* The pill is drawn by ::before and is shorter than the button, which keeps the 44 px hit target. */
.actual-choice {
  position: relative;
  isolation: isolate;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--label);
  font-weight: 500;
}
.actual-choice::before {
  content: '';
  position: absolute;
  inset: 6px 0;
  z-index: -1;
  border-radius: 999px;
  background: var(--surface-2);
  transition: background-color 0.1s, transform 0.1s var(--ease-out);
}
.actual-choice:active::before { transform: scale(0.97); }
.actual-choice[aria-pressed='true'] { font-weight: 600; }
.actual-choice[aria-pressed='true']::before { background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.actual-choice.is-done[aria-pressed='true']::before { box-shadow: inset 0 -2px 0 var(--success), 0 1px 3px rgba(0, 0, 0, 0.12); }
.actual-choice.is-skipped[aria-pressed='true']::before { box-shadow: inset 0 -2px 0 var(--label-2), 0 1px 3px rgba(0, 0, 0, 0.12); }
.partial { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.partial-label { flex-basis: 100%; color: var(--label-2); }
.partial-input { width: 6rem; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .actual-choice:active::before { transform: none; opacity: 0.7; }
}
</style>
