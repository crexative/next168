<script setup lang="ts">
import { inlineSeparators } from '@/ui/inlineText'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual, Category } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant, type DatedOccurrence } from '@/core/time'
import { categoryStroke } from '@/ui/categoryVisual'
import { displayLocale, formatDuration } from '@/ui/format'
import Icon from '@/ui/Icon.vue'
import { formatMinute, formatTime } from '@/features/week/localTime'
import ItemStatusControl from './ItemStatusControl.vue'
import { actualFor, type ActualStatus } from './actuals'
import { continuationHints } from './continuationHints'
import { nameList } from './nameList'
import { isAskable } from './planSince'
import { isReportable } from './statusWindow'
import { liveOverlapTitles, type AllDayItem, type TimelineItem } from './todayTimeline'

const props = defineProps<{
  items: TimelineItem[]
  allDay: AllDayItem[]
  actuals: BlockActual[]
  categories: Category[]
  now: Date
  timeZone: string
  writable: boolean
  // Key of the block the Now card already asks about while it is under way, so its row does not ask a second time.
  askedKey?: string
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
  if (item.kind !== 'block' || item.key === props.askedKey || !isAskable(item.start, props.planSince)) return false
  return isReportable(item, props.now) || statusOf(item) !== undefined
}

function occurrenceOf(item: TimelineItem): DatedOccurrence | undefined {
  return item.kind === 'block' ? item.occurrence : undefined
}

function emitRecord(item: TimelineItem, status: ActualStatus, actualMinutes?: number): void {
  const occurrence = occurrenceOf(item)
  if (occurrence) emit('record', occurrence, status, actualMinutes)
}

function emitClear(item: TimelineItem): void {
  const occurrence = occurrenceOf(item)
  if (occurrence) emit('clear', occurrence)
}

function hasControl(item: TimelineItem): boolean {
  return item.kind === 'task' || asksStatus(item)
}

// "Se cruza con Cita médica": information about the day, in the app's language, never an alarm.
function overlapText(item: TimelineItem): string {
  return t('today.timeline.overlaps', { titles: nameList(locale.value, liveOverlapTitles(item, props.items, props.now)) })
}

function isCurrent(item: TimelineItem): boolean {
  return Date.parse(item.start) <= props.now.getTime() && !isPast(item)
}

// A calendar item says where it comes from in words, not only by its shape.
function kindWord(item: TimelineItem): string {
  if (item.kind === 'event' || item.kind === 'external') return item.sourceName ?? t(`today.timeline.kinds.${item.kind}`)
  return item.kind === 'task' ? t('today.timeline.kinds.task') : ''
}

const isCalendarItem = (item: TimelineItem) => item.kind === 'event' || item.kind === 'external'

// Past items fold into one row; the rest are shown in time order with the free time between them named.
const expanded = ref(false)
const animateRows = ref(false)
const past = computed(() => props.items.filter(isPast))
// A past block still waits for an answer; last night's tail, events and tasks never count.
function isUnanswered(item: TimelineItem): boolean {
  return item.kind === 'block' && !isCarryOver(item) && isAskable(item.start, props.planSince) && statusOf(item) === undefined
}
const unansweredCount = computed(() => past.value.filter(isUnanswered).length)

type Entry =
  | { type: 'earlier'; key: string }
  | { type: 'now'; key: string }
  | { type: 'gap'; key: string; minutes: number }
  | { type: 'item'; key: string; item: TimelineItem }

const entries = computed<Entry[]>(() => {
  const result: Entry[] = []
  if (past.value.length) result.push({ type: 'earlier', key: 'earlier' })
  if (expanded.value) result.push(...past.value.map((item): Entry => ({ type: 'item', key: item.key, item })))
  result.push({ type: 'now', key: 'now' })
  let covered = props.now.getTime()
  for (const item of props.items.filter((candidate) => !isPast(candidate))) {
    // Free time is named only between the current item and the next one, never after the day's last item.
    if (Date.parse(item.start) > covered) result.push({ type: 'gap', key: `gap@${item.key}`, minutes: Math.round((Date.parse(item.start) - covered) / 60_000) })
    result.push({ type: 'item', key: item.key, item })
    covered = Math.max(covered, Date.parse(item.end))
  }
  return result
})

const nowLabel = computed(() => t('today.timeline.nowLine', { time: formatTime(props.now, displayLocale.value, props.timeZone) }))

const earlierButton = ref<HTMLButtonElement | null>(null)
const section = ref<HTMLElement | null>(null)

// Opening goes straight to the first answer still missing, unless the rings are off; closing returns to the row.
async function toggleEarlier(): Promise<void> {
  // Only opening and closing animate; rows that leave because time moved on do so at once.
  animateRows.value = true
  setTimeout(() => { animateRows.value = false }, 400)
  expanded.value = !expanded.value
  await nextTick()
  if (!expanded.value) {
    earlierButton.value?.focus()
    return
  }
  if (!props.writable || unansweredCount.value === 0) {
    // Safari does not focus a button on click, so the row is focused explicitly.
    earlierButton.value?.focus()
    return
  }
  const ring = section.value?.querySelector<HTMLElement>('[data-unanswered="true"] [data-testid="status-control"]')
  ring?.focus()
  ring?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <section ref="section" class="timeline-section" :aria-label="t('today.timeline.label')">
    <h2 class="t-headline section-title">{{ t('today.timeline.title') }}</h2>
    <slot name="notice" />
    <ul v-if="allDay.length" class="all-day">
      <li v-for="item in allDay" :key="item.key" class="all-day-item t-footnote">
        <span class="t-secondary">{{ t('today.timeline.allDay') }}</span> {{ item.title }}
      </li>
    </ul>
    <TransitionGroup tag="ol" name="row" class="timeline" :css="animateRows">
      <li
        v-for="entry in entries"
        :key="entry.key"
        :class="entry.type === 'item'
          ? ['row', `is-${entry.item.kind}`, { 'is-past': isPast(entry.item), 'is-current': isCurrent(entry.item), 'is-carry': isCarryOver(entry.item), 'has-control': hasControl(entry.item) }]
          : [`is-${entry.type}`, { row: entry.type === 'gap' }]"
        :style="entry.type === 'item' ? { '--item-color': color(entry.item) } : undefined"
        :data-kind="entry.type === 'item' ? entry.item.kind : undefined"
        :data-testid="entry.type === 'item' ? 'timeline-item' : undefined"
        :data-unanswered="entry.type === 'item' && isPast(entry.item) && isUnanswered(entry.item) ? 'true' : undefined"
      >
        <button
          v-if="entry.type === 'earlier'"
          :ref="(element) => { earlierButton = element as HTMLButtonElement | null }"
          type="button"
          class="earlier-row"
          :aria-expanded="expanded"
          data-testid="timeline-earlier"
          @click="toggleEarlier"
        >
          <span class="t-body">{{ inlineSeparators(t('today.timeline.earlier', { count: past.length })) }}</span>
          <span v-if="unansweredCount" class="t-subhead earlier-open" data-testid="timeline-unanswered">{{ t('today.timeline.unanswered', { count: unansweredCount }) }}</span>
          <Icon name="chevron-right" :size="20" class="earlier-chevron" />
        </button>
        <template v-else-if="entry.type === 'now'">
          <span class="now-label t-caption" data-testid="timeline-now">{{ nowLabel }}</span>
          <span class="now-rule" aria-hidden="true" />
        </template>
        <p v-else-if="entry.type === 'gap'" class="gap-note t-footnote t-secondary" data-testid="timeline-gap">{{ t('today.timeline.gap', { duration: formatDuration(entry.minutes) }) }}</p>
        <template v-else-if="isCarryOver(entry.item)">
          <span class="row-bar" aria-hidden="true" />
          <p class="carry t-subhead" data-testid="timeline-carry">
            <span class="carry-title">{{ entry.item.title }}</span>
            <span class="carry-note t-secondary">{{ inlineSeparators(t('today.timeline.carryOver', { time: endLabel(entry.item) })) }}</span>
          </p>
        </template>
        <template v-else>
          <span class="row-time t-footnote">
            <span data-testid="timeline-start">{{ startLabel(entry.item) }}</span>
            <span v-if="!endsAfterToday(entry.item)" class="t-secondary" data-testid="timeline-end">{{ endLabel(entry.item) }}</span>
          </span>
          <span class="row-bar" aria-hidden="true" />
          <div class="row-content">
            <p class="row-title" :class="isCurrent(entry.item) ? 't-headline' : 't-body'">
              <span class="row-title-text">
                <Icon v-if="isCalendarItem(entry.item)" name="calendar" :size="14" class="row-glyph" />
                <span v-if="kindWord(entry.item)" class="visually-hidden">{{ kindWord(entry.item) }}: </span>{{ entry.item.title }}
              </span>
              <span v-if="entry.item.kind === 'task' && entry.item.late" class="badge is-late t-caption">{{ t('today.timeline.late') }}</span>
            </p>
            <p
              v-for="hint in continuationHints(entry.item, now, timeZone, locale, displayLocale)"
              :key="hint.key"
              class="row-note t-footnote t-secondary"
              data-testid="timeline-span-hint"
            >{{ t(hint.key, hint.params, hint.plural ?? 1) }}</p>
            <p v-if="liveOverlapTitles(entry.item, items, now).length" class="row-note t-footnote t-secondary" data-testid="timeline-overlap">
              <Icon name="triangle-alert" :size="14" class="row-glyph" />{{ overlapText(entry.item) }}
            </p>
          </div>
          <ItemStatusControl
            v-if="entry.item.kind === 'task'"
            class="row-control"
            :item-key="entry.item.key"
            :title="entry.item.title"
            :writable="writable"
            @record="emit('completeTask', entry.item.taskId, entry.item.title)"
          />
          <ItemStatusControl
            v-else-if="asksStatus(entry.item)"
            class="row-control"
            :item-key="entry.item.key"
            :title="entry.item.title"
            :status="statusOf(entry.item)?.status"
            :actual-minutes="statusOf(entry.item)?.actualMinutes"
            :planned-minutes="occurrenceOf(entry.item)?.plannedMinutes"
            :writable="writable"
            @record="(status, minutes) => emitRecord(entry.item, status, minutes)"
            @clear="emitClear(entry.item)"
          />
        </template>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.timeline-section { margin: var(--section-gap) var(--page-gutter) 0; }
.section-title { margin: 0 0 var(--space-3); }
.all-day { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-2); padding: 0; list-style: none; }
.all-day-item { padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
.timeline { margin: 0; padding: 0; list-style: none; border-radius: var(--radius-card); background: var(--surface); container: timeline / inline-size; }
.row { display: grid; grid-template-columns: 4.5rem 3px minmax(0, 1fr); gap: var(--space-3); min-height: var(--row-min-height); padding: var(--row-padding-block) var(--card-padding); }
.row + .row { border-top: 0.5px solid var(--separator); }
.row.has-control { grid-template-columns: 4.5rem 3px minmax(0, 1fr) auto; }
.row.is-carry { grid-template-columns: 3px minmax(0, 1fr); align-items: center; }
.is-carry .row-bar { align-self: stretch; }
.row-time { display: flex; flex-direction: column; align-items: flex-end; text-align: end; font-variant-numeric: tabular-nums; }
.row-bar { border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 4px, transparent 4px 7px); }
/* A calendar item is told by its glyph and its source word, not by a bar. */
.is-event .row-bar, .is-external .row-bar { background: transparent; }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.row-title-text { min-width: 0; overflow-wrap: anywhere; }
.row-glyph { display: inline-block; margin-inline-end: 4px; vertical-align: -2px; color: var(--label-2); }
.row-note { margin: 0; }
/* The title wraps at word boundaries; the clock note stays together. */
.carry { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; margin: 0; flex-wrap: wrap; }
.carry-title { min-width: 0; overflow-wrap: normal; color: var(--label-2); }
.carry-note { flex: none; font-variant-numeric: tabular-nums; }
.badge { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-2); border-radius: 999px; }
.badge.is-late { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--label); }
/* The 44 px circle borrows the row's padding, so a row with a control is as tall as one without. */
.row-control { align-self: center; }

/* "Antes": every past item folded into one row that says how many still wait for an answer. */
.is-earlier { border-bottom: 0.5px solid var(--separator); }
.earlier-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--row-min-height);
  padding: var(--row-padding-block) var(--card-padding);
  border: 0;
  background: transparent;
  color: var(--label);
  text-align: start;
}
.earlier-row .t-body { flex: 1; }
.earlier-open { color: var(--tint-label); font-variant-numeric: tabular-nums; }
.earlier-chevron { flex: none; color: var(--label-3); transition: transform var(--spring-duration) var(--ease-out); }
.earlier-row[aria-expanded='true'] .earlier-chevron { transform: rotate(90deg); }

/* The now-line: a 2 px rule across the card with its time above it. */
.is-now { padding: 0 var(--card-padding); }
.is-now + .row { border-top: 0; }
.now-label { display: block; padding-top: var(--space-1); color: var(--danger-label); }
.now-rule { display: block; height: 2px; margin-block: var(--space-1) 0; background: var(--danger); }

/* Free time between two items: a quiet line in the title column, with no separators around it. */
.row.is-gap { min-height: 0; grid-template-columns: 4.5rem 3px minmax(0, 1fr); border-top: 0; }
.row.is-gap + .row { border-top: 0; }
.gap-note { grid-column: 3; margin: 0; }

.row-enter-active { animation: row-in var(--spring-duration) var(--ease-out); overflow: hidden; }
.row-leave-active { animation: row-in var(--spring-duration) var(--ease-out) reverse; overflow: hidden; }
@keyframes row-in { from { max-height: 0; opacity: 0; padding-block: 0; } to { max-height: 8rem; opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .earlier-chevron { transition: none; }
  .row-enter-active, .row-leave-active { animation: row-fade 150ms linear; }
  .row-leave-active { animation-direction: reverse; }
  @keyframes row-fade { from { opacity: 0; } to { opacity: 1; } }
}

/* With large text the time column would leave the content a sliver: the times move above the title instead. */
@container timeline (max-width: 18rem) {
  .row { grid-template-columns: 3px minmax(0, 1fr); row-gap: var(--space-1); }
  .row.has-control { grid-template-columns: 3px minmax(0, 1fr) auto; }
  .row-time { grid-column: 2; flex-direction: row; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; text-align: start; }
  .row-bar { grid-column: 1; grid-row: 1 / span 2; }
  .row-content { grid-column: 2; }
  .row-control { grid-column: 3; grid-row: 1 / span 2; }
  .row.is-gap { grid-template-columns: 3px minmax(0, 1fr); }
  .gap-note { grid-column: 2; }
  /* Last night's line cannot stay one line at this size: the note moves under the title. */
  .carry { flex-wrap: wrap; white-space: normal; }
  .carry-note { flex: 0 1 auto; min-width: 0; }
}
</style>
