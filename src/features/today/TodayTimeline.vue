<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant, type DatedOccurrence } from '@/core/time'
import CategoryMark from '@/ui/CategoryMark.vue'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale } from '@/ui/format'
import Icon from '@/ui/Icon.vue'
import { formatMinute, formatTime } from '@/features/week/localTime'
import ActualChoices from './ActualChoices.vue'
import { actualFor, type ActualStatus } from './actuals'
import { continuationHints } from './continuationHints'
import { isAskable } from './planSince'
import type { AllDayItem, TimelineItem } from './todayTimeline'

const props = defineProps<{
  items: TimelineItem[]
  allDay: AllDayItem[]
  actuals: BlockActual[]
  categories: Category[]
  now: Date
  timeZone: string
  writable: boolean
  // Key of the block the Now card already asks about, so its row does not ask a second time.
  currentKey?: string
  planSince?: number
}>()
const emit = defineEmits<{
  record: [occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number]
  clear: [occurrence: DatedOccurrence]
  completeTask: [taskId: string, title: string]
}>()

const { t, locale } = useI18n()

const categoriesById = computed(() => new Map(props.categories.map((category) => [category.id, category])))

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

// The tail of last night's block (Sleep) is one quiet line: its question belongs to the day it began.
function isCarryOver(item: TimelineItem): boolean {
  return item.kind === 'block' && startsBeforeToday(item)
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

function asksStatus(item: TimelineItem): item is TimelineItem & { kind: 'block' } {
  return item.kind === 'block' && item.key !== props.currentKey && hasStarted(item) && isAskable(item.start, props.planSince)
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
        :class="[`is-${item.kind}`, { 'is-past': isPast(item), 'is-conflict': item.conflict, 'is-carry': isCarryOver(item) }]"
        :style="{ '--item-color': color(item) }"
        :data-kind="item.kind"
        data-testid="timeline-item"
      >
        <template v-if="isCarryOver(item)">
          <span class="row-bar" aria-hidden="true" />
          <p class="carry t-subhead" data-testid="timeline-carry">
            <span class="carry-title">{{ item.title }}</span>
            <span class="carry-note t-secondary">{{ t('today.timeline.carryOver', { time: endLabel(item) }) }}</span>
          </p>
        </template>
        <template v-else>
          <span class="row-time t-footnote">
            <span data-testid="timeline-start">{{ startLabel(item) }}</span>
            <span class="t-secondary" data-testid="timeline-end">{{ endLabel(item) }}</span>
          </span>
          <span class="row-bar" aria-hidden="true" />
          <div class="row-content">
            <p class="row-title t-body">
              <span class="row-title-text"><CategoryMark v-if="categoryOf(item)" class="row-mark" :category="categoryOf(item)" />{{ item.title }}</span>
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
          </div>
          <button
            v-if="item.kind === 'task'"
            type="button"
            class="task-check"
            data-testid="task-check"
            :aria-label="t('today.timeline.completeTask', { title: item.title })"
            :disabled="!writable"
            @click="emit('completeTask', item.taskId, item.title)"
          >
            <span class="task-ring" />
          </button>
          <ActualChoices
            v-if="asksStatus(item)"
            class="row-actual"
            :occurrence="item.occurrence"
            :actual="actualFor(actuals, item.occurrence)"
            :writable="writable"
            @record="(status, minutes) => emit('record', item.occurrence, status, minutes)"
            @clear="emit('clear', item.occurrence)"
          />
        </template>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.timeline-section { margin: var(--space-6) var(--space-4) 0; }
.section-title { margin: 0 0 var(--space-2); }
.all-day { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-2); padding: 0; list-style: none; }
.all-day-item { padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
.timeline { margin: 0; padding: 0; list-style: none; border-radius: var(--radius-card); background: var(--surface); container: timeline / inline-size; }
.row { display: grid; grid-template-columns: 4.5rem 3px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.row + .row { border-top: 0.5px solid var(--separator); }
.row.is-task { grid-template-columns: 4.5rem 3px minmax(0, 1fr) auto; }
.row.is-carry { grid-template-columns: 3px minmax(0, 1fr); align-items: center; padding-block: var(--space-2); }
.is-carry .row-bar { align-self: stretch; }
.row-time { display: flex; flex-direction: column; align-items: flex-end; text-align: end; font-variant-numeric: tabular-nums; }
.row-bar { border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 4px, transparent 4px 7px); }
.is-event .row-bar, .is-external .row-bar { background: transparent; border-inline-start: 2px dashed var(--item-color); }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.row-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row-mark { margin-inline-end: var(--space-2); vertical-align: -0.1em; }
.row-kind { margin: -0.25rem 0 0; }
/* One line: the title gives way (with an ellipsis), the note never wraps. */
.carry { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; margin: 0; white-space: nowrap; }
.carry-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--label-2); }
.carry-note { flex: none; font-variant-numeric: tabular-nums; }
.badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-2); border-radius: 999px; }
.badge.is-conflict { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-label); }
.badge.is-late { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--label); }
/* The status chips run under the whole row, so three of them fit one line at 375 px. */
.row-actual { grid-column: 1 / -1; }
.task-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: var(--tap-target);
  height: var(--tap-target);
  margin: calc(var(--space-3) * -1) calc(var(--space-2) * -1) calc(var(--space-3) * -1) 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  touch-action: manipulation;
}
.task-ring { width: 22px; height: 22px; border: 2px solid var(--item-color); border-radius: 50%; transition: transform 0.1s var(--ease-out); }
.task-check:active:not(:disabled) .task-ring { transform: scale(0.9); }
.task-check:disabled { opacity: 0.4; cursor: not-allowed; }
/* With large text the time column would leave the content a sliver: the times move above the title instead. */
@container timeline (max-width: 18rem) {
  .row { grid-template-columns: 3px minmax(0, 1fr); row-gap: var(--space-1); }
  .row.is-task { grid-template-columns: 3px minmax(0, 1fr) auto; }
  .row-time { grid-column: 2; flex-direction: row; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; text-align: start; }
  .row-bar { grid-column: 1; grid-row: 1 / span 2; }
  .row-content { grid-column: 2; }
  .task-check { grid-column: 3; grid-row: 1 / span 2; }
  /* Last night's line cannot stay one line at this size: the note moves under the title. */
  .carry { flex-wrap: wrap; white-space: normal; }
  .carry-note { flex: 0 1 auto; min-width: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .task-check:active:not(:disabled) .task-ring { transform: none; opacity: 0.6; }
}
</style>
