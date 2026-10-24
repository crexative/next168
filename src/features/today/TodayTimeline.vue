<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import type { DatedOccurrence } from '@/core/time'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { categoryColor } from '@/features/week/categoryColor'
import { formatTime } from '@/features/week/localTime'
import { actualFor, type ActualStatus } from './actuals'
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

function color(item: TimelineItem): string {
  return item.kind === 'block' || item.kind === 'task' ? categoryColor(categoriesById.value.get(item.categoryId)) : 'var(--label-2)'
}

function time(instant: string): string {
  return formatTime(instant, locale.value, props.timeZone)
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
  if (status === 'partial') {
    partialKey.value = item.key
    partialMinutes.value = current?.status === 'partial' ? current.actualMinutes ?? 0 : Math.round(item.occurrence.plannedMinutes / 2)
    return
  }
  partialKey.value = null
  if (current?.status === status) emit('clear', item.occurrence)
  else emit('record', item.occurrence, status)
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
          <span>{{ time(item.start) }}</span>
          <span class="t-secondary">{{ time(item.end) }}</span>
        </span>
        <span class="row-bar" aria-hidden="true" />
        <div class="row-content">
          <p class="row-title t-body">
            <span class="row-title-text">{{ item.title }}</span>
            <span v-if="item.conflict" class="badge is-conflict t-caption" data-testid="conflict-mark">
              <Icon name="triangle-alert" :size="14" />{{ t('today.timeline.conflict') }}
            </span>
            <span v-if="item.kind === 'task' && item.late" class="badge is-late t-caption">{{ t('today.timeline.late') }}</span>
          </p>
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
                class="partial-input"
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
.row-time { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
.row-bar { border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 4px, transparent 4px 7px); }
.is-event .row-bar, .is-external .row-bar { background: transparent; border-inline-start: 2px dashed var(--item-color); }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.row-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row-kind { margin: -0.25rem 0 0; }
.badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-2); border-radius: 999px; }
.badge.is-conflict { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-label); }
.badge.is-late { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--label); }
.actual { display: flex; gap: var(--space-1); padding: 2px; border-radius: var(--radius-control); background: var(--surface-2); }
.actual-choice {
  flex: 1;
  min-height: var(--tap-target);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--label);
  font-weight: 500;
  transition: background-color 0.1s, transform 0.1s var(--ease-out);
}
.actual-choice:active { transform: scale(0.97); }
.actual-choice[aria-pressed='true'] { background: var(--surface); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
.actual-choice.is-done[aria-pressed='true'] { color: var(--label); box-shadow: inset 0 -2px 0 var(--success), 0 1px 3px rgba(0, 0, 0, 0.12); }
.actual-choice.is-skipped[aria-pressed='true'] { box-shadow: inset 0 -2px 0 var(--label-2), 0 1px 3px rgba(0, 0, 0, 0.12); }
.partial { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.partial-label { flex-basis: 100%; color: var(--label-2); }
.partial-input {
  width: 6rem;
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 0.5px solid var(--separator);
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--label);
  font: inherit;
  font-size: 1.0625rem;
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .actual-choice:active { transform: none; opacity: 0.7; }
}
</style>
