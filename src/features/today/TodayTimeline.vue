<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant, type DatedOccurrence } from '@/core/time'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale } from '@/ui/format'
import { formatMinute, formatTime } from '@/features/week/localTime'
import ItemStatusControl from './ItemStatusControl.vue'
import { actualFor, type ActualStatus } from './actuals'
import { continuationHints } from './continuationHints'
import { nameList } from './nameList'
import { isAskable } from './planSince'
import { isReportable } from './statusWindow'
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

function color(item: TimelineItem): string {
  return item.kind === 'block' || item.kind === 'task' ? categoryStroke(categoriesById.value.get(item.categoryId)) : 'var(--label-2)'
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

function isPast(item: TimelineItem): boolean {
  return Date.parse(item.end) <= props.now.getTime()
}

type BlockItem = TimelineItem & { kind: 'block' }

function statusOf(item: BlockItem): BlockActual | undefined {
  return actualFor(props.actuals, item.occurrence)
}

// A row asks "how did it go?" once it is over (or in its last minutes), and keeps showing its answer afterwards.
function asksStatus(item: TimelineItem): item is BlockItem {
  if (item.kind !== 'block' || item.key === props.currentKey || !isAskable(item.start, props.planSince)) return false
  return isReportable(item, props.now) || statusOf(item) !== undefined
}

function hasControl(item: TimelineItem): boolean {
  return item.kind === 'task' || asksStatus(item)
}

// "Se cruza con Cita médica": information about the day, in the app's language, never an alarm.
function overlapText(item: TimelineItem): string {
  return t('today.timeline.overlaps', { titles: nameList(locale.value, item.overlapsWith) })
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
        :class="[`is-${item.kind}`, { 'is-past': isPast(item), 'is-carry': isCarryOver(item), 'has-control': hasControl(item) }]"
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
            <span v-if="!endsAfterToday(item)" class="t-secondary" data-testid="timeline-end">{{ endLabel(item) }}</span>
          </span>
          <span class="row-bar" aria-hidden="true" />
          <div class="row-content">
            <p class="row-title t-body">
              <span class="row-title-text"><span v-if="item.kind !== 'block'" class="visually-hidden">{{ t(`today.timeline.kinds.${item.kind}`) }}: </span>{{ item.title }}</span>
              <span v-if="item.kind === 'task' && item.late" class="badge is-late t-caption">{{ t('today.timeline.late') }}</span>
            </p>
            <p
              v-for="hint in continuationHints(item, now, timeZone, locale, displayLocale)"
              :key="hint.key"
              class="row-note t-footnote t-secondary"
              data-testid="timeline-span-hint"
            >{{ t(hint.key, hint.params, hint.plural ?? 1) }}</p>
            <p v-if="item.overlapsWith.length" class="row-note t-footnote t-secondary" data-testid="timeline-overlap">{{ overlapText(item) }}</p>
          </div>
          <ItemStatusControl
            v-if="item.kind === 'task'"
            class="row-control"
            :item-key="item.key"
            :title="item.title"
            :writable="writable"
            @record="emit('completeTask', item.taskId, item.title)"
          />
          <ItemStatusControl
            v-else-if="asksStatus(item)"
            class="row-control"
            :item-key="item.key"
            :title="item.title"
            :status="statusOf(item)?.status"
            :actual-minutes="statusOf(item)?.actualMinutes"
            :planned-minutes="item.occurrence.plannedMinutes"
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
.row.has-control { grid-template-columns: 4.5rem 3px minmax(0, 1fr) auto; }
.row.is-carry { grid-template-columns: 3px minmax(0, 1fr); align-items: center; padding-block: var(--space-2); }
.is-carry .row-bar { align-self: stretch; }
.row-time { display: flex; flex-direction: column; align-items: flex-end; text-align: end; font-variant-numeric: tabular-nums; }
.row-bar { border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 4px, transparent 4px 7px); }
.is-event .row-bar, .is-external .row-bar { background: transparent; border-inline-start: 2px dashed var(--item-color); }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.row-title-text { min-width: 0; overflow-wrap: anywhere; }
.row-note { margin: 0; }
/* One line: the title gives way (with an ellipsis), the note never wraps. */
.carry { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; margin: 0; white-space: nowrap; }
.carry-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--label-2); }
.carry-note { flex: none; font-variant-numeric: tabular-nums; }
.badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-2); border-radius: 999px; }
.badge.is-late { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--label); }
/* The 44 px circle borrows the row's padding, so a row with a control is as tall as one without. */
.row-control { align-self: center; margin: calc(var(--space-3) * -1) calc(var(--space-2) * -1) calc(var(--space-3) * -1) 0; }
/* With large text the time column would leave the content a sliver: the times move above the title instead. */
@container timeline (max-width: 18rem) {
  .row { grid-template-columns: 3px minmax(0, 1fr); row-gap: var(--space-1); }
  .row.has-control { grid-template-columns: 3px minmax(0, 1fr) auto; }
  .row-time { grid-column: 2; flex-direction: row; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; text-align: start; }
  .row-bar { grid-column: 1; grid-row: 1 / span 2; }
  .row-content { grid-column: 2; }
  .row-control { grid-column: 3; grid-row: 1 / span 2; }
  /* Last night's line cannot stay one line at this size: the note moves under the title. */
  .carry { flex-wrap: wrap; white-space: normal; }
  .carry-note { flex: 0 1 auto; min-width: 0; }
}
</style>
