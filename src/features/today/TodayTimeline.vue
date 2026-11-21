<script setup lang="ts">
import { inlineSeparators, joinInline } from '@/ui/inlineText'
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
  // What the Ahora hero already shows: its item and the routine it sits in. Each thing appears once (principle 3).
  hero?: { key: string; contextKey?: string }
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

// An item that ends tomorrow (Sueño 23:00–7:00) shows its real end in the time column, so it needs no "Hasta las 7:00"
// line (REVIEW B1); one that ends later than tomorrow keeps its "Hasta el …" line instead.
function endsTomorrow(item: TimelineItem): boolean {
  return endsAfterToday(item) && Date.parse(item.end) <= dayBounds.value.end + 24 * 3_600_000
}

function endLabel(item: TimelineItem): string {
  return endsAfterToday(item) && !endsTomorrow(item) ? formatMinute(0, displayLocale.value) : formatTime(item.end, displayLocale.value, props.timeZone)
}

function hintsFor(item: TimelineItem) {
  const hints = continuationHints(item, props.now, props.timeZone, locale.value, displayLocale.value)
  return endsTomorrow(item) ? hints.filter((hint) => hint.key !== 'today.timeline.untilTime') : hints
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

// The routines whose rows the Ahora hero holds instead of the list.
const hiddenBlocks = computed(() => {
  const hidden = new Set([props.hero?.key, props.hero?.contextKey].filter((key): key is string => !!key))
  return props.items.filter((item) => item.kind === 'block' && hidden.has(item.key))
})

// The notice belongs to the routine that gives way; when that routine's row is in the hero, the event it crosses says
// it instead, so the conflict is still on screen once (R_Hoy: "Se cruza con Trabajo" on the meeting).
function overlapTitles(item: TimelineItem): string[] {
  if (item.kind === 'block') return liveOverlapTitles(item, props.items, props.now)
  if (item.kind !== 'event' && item.kind !== 'external') return []
  return hiddenBlocks.value.filter((block) => liveOverlapTitles(block, props.items, props.now).includes(item.title)).map((block) => block.title)
}

// "Se cruza con Cita médica": information about the day, in the app's language, never an alarm.
function overlapText(item: TimelineItem): string {
  return t('today.timeline.overlaps', { titles: nameList(locale.value, overlapTitles(item)) })
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
  const hidden = new Set([props.hero?.key, props.hero?.contextKey].filter((key): key is string => !!key))
  for (const item of props.items.filter((candidate) => !isPast(candidate))) {
    // The hero's own item still fills its time (no "Libre" inside it); the routine it sits in does not, as in the list
    // before: free time inside a routine is named.
    if (hidden.has(item.key)) {
      if (item.key === props.hero?.key) covered = Math.max(covered, Date.parse(item.end))
      continue
    }
    // Free time is named only between the current item and the next one, never after the day's last item.
    if (Date.parse(item.start) > covered) result.push({ type: 'gap', key: `gap@${item.key}`, minutes: Math.round((Date.parse(item.start) - covered) / 60_000) })
    result.push({ type: 'item', key: item.key, item })
    covered = Math.max(covered, Date.parse(item.end))
  }
  return result
})

// The next thing to do reads a little stronger than the rest.
const nextKey = computed(() => {
  const instant = props.now.getTime()
  return entries.value.find((entry) => entry.type === 'item' && Date.parse(entry.item.start) > instant)?.key
})

// A task says what it is and how long it takes ("Tarea · 30 min"); overdue is said in words, in amber.
function metaText(item: TimelineItem): string {
  if (item.kind !== 'task') return ''
  const minutes = Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60_000)
  return inlineSeparators(joinInline([t('today.timeline.kinds.task'), formatDuration(minutes)]))
}

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
    <h2 class="t-section section-title">{{ t('today.timeline.title') }}</h2>
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
          ? ['row', `is-${entry.item.kind}`, { 'is-past': isPast(entry.item), 'is-current': isCurrent(entry.item), 'is-next': entry.key === nextKey, 'is-carry': isCarryOver(entry.item), 'has-control': hasControl(entry.item) }]
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
          <span v-if="unansweredCount" class="t-subhead earlier-open"><span aria-hidden="true">· </span><span data-testid="timeline-unanswered">{{ t('today.timeline.unanswered', { count: unansweredCount }) }}</span></span>
          <Icon name="chevron-down" :size="20" class="earlier-chevron" />
        </button>
        <template v-else-if="entry.type === 'now'">
          <span class="now-label t-caption" data-testid="timeline-now">{{ nowLabel }}</span>
          <span class="now-dot" aria-hidden="true" />
          <span class="now-rule" aria-hidden="true" />
        </template>
        <p v-else-if="entry.type === 'gap'" class="gap-note t-footnote t-secondary" data-testid="timeline-gap">{{ t('today.timeline.gap', { duration: formatDuration(entry.minutes) }) }}</p>
        <template v-else-if="isCarryOver(entry.item)">
          <span class="row-time" aria-hidden="true" />
          <span class="row-bar" aria-hidden="true" />
          <p class="carry t-subhead" data-testid="timeline-carry">
            <span class="carry-title">{{ entry.item.title }}</span>
            <span class="carry-note t-secondary">{{ inlineSeparators(t('today.timeline.carryOver', { time: endLabel(entry.item) })) }}</span>
          </p>
        </template>
        <template v-else>
          <span class="row-time">
            <span class="row-start" data-testid="timeline-start">{{ startLabel(entry.item) }}</span>
            <span v-if="!endsAfterToday(entry.item) || endsTomorrow(entry.item)" class="row-end t-footnote t-secondary" data-testid="timeline-end">{{ endLabel(entry.item) }}</span>
          </span>
          <span class="row-bar" aria-hidden="true" />
          <div class="row-content">
            <p class="row-title t-body">
              <span class="row-title-text">
                <Icon v-if="isCalendarItem(entry.item)" name="calendar" :size="14" class="row-glyph" />
                <span v-if="kindWord(entry.item)" class="visually-hidden">{{ kindWord(entry.item) }}: </span>{{ entry.item.title }}
              </span>
            </p>
            <p v-if="metaText(entry.item)" class="row-note t-footnote t-secondary" aria-hidden="true" data-testid="timeline-meta">{{ metaText(entry.item) }}</p>
            <p v-if="entry.item.kind === 'task' && entry.item.late" class="row-note row-attention t-footnote" data-testid="timeline-late">
              <Icon name="triangle-alert" :size="14" class="row-glyph" />{{ t('today.timeline.late') }}
            </p>
            <p
              v-for="hint in hintsFor(entry.item)"
              :key="hint.key"
              class="row-note t-footnote t-secondary"
              data-testid="timeline-span-hint"
            >{{ t(hint.key, hint.params, hint.plural ?? 1) }}</p>
            <p v-if="overlapTitles(entry.item).length" class="row-note row-attention t-footnote" data-testid="timeline-overlap">
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
    <slot name="end" />
  </section>
</template>

<style scoped>
/* A plain list on the page (R_Hoy): rows run edge to edge with a 16 px inset, hairlines start at the text. */
.timeline-section { --time-column: 56px; --text-start: calc(var(--page-gutter) + var(--time-column) + var(--space-3) + 4px + var(--space-3)); margin: var(--section-gap) 0 0; container: timeline / inline-size; }
.section-title { margin: 0 var(--page-gutter) var(--space-2); }
.all-day { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 var(--page-gutter) var(--space-2); padding: 0; list-style: none; }
.all-day-item { padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); background: var(--fill); }
.timeline { margin: 0; padding: 0; list-style: none; }
.row { position: relative; display: grid; grid-template-columns: var(--time-column) 4px minmax(0, 1fr); gap: var(--space-3); align-items: center; min-height: var(--row-min-height); padding: 10px var(--page-gutter); }
.row::after { content: ''; position: absolute; inset-inline: var(--text-start) 0; bottom: 0; border-bottom: 0.5px solid var(--separator); }
.row:last-child::after { display: none; }
.row.has-control { grid-template-columns: var(--time-column) 4px minmax(0, 1fr) var(--tap-target); }
.row-time { display: flex; flex-direction: column; align-items: flex-end; align-self: start; text-align: end; font-variant-numeric: tabular-nums; }
.row-start { font-size: 0.9375rem; line-height: 1.27; font-weight: 600; }
.row-bar { align-self: stretch; border-radius: 2px; background: var(--item-color); }
.is-task .row-bar { background: repeating-linear-gradient(to bottom, var(--item-color) 0 5px, transparent 5px 8px); }
/* A calendar item is told by its glyph and its source word, not by a bar. */
.is-event .row-bar, .is-external .row-bar { background: transparent; }
.is-past .row-title-text { color: var(--label-2); }
.row-content { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; }
.is-next .row-title, .is-current .row-title { font-weight: 600; }
.row-title-text { min-width: 0; overflow-wrap: anywhere; }
.row-glyph { display: inline-block; margin-inline-end: 4px; vertical-align: -2px; }
.row-title .row-glyph { color: var(--label-2); }
.row-note { margin: 0; }
/* Something that needs attention says so in amber, never red (DIRECTION principle 6). */
.row-attention { display: flex; align-items: center; color: var(--warning-label); }
/* Last night's tail: one quiet line in the text column. */
.carry { grid-column: 3; }
.carry { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; margin: 0; flex-wrap: wrap; }
.carry-title { min-width: 0; overflow-wrap: normal; color: var(--label-2); }
.carry-note { flex: none; font-variant-numeric: tabular-nums; }
/* The 44 px circle sits in its own column at the row's trailing end. */
.row-control { align-self: center; justify-self: center; }

/* "Antes": every past item folded into one row that says how many still wait for an answer. */
.is-earlier { position: relative; }
.is-earlier::after { content: ''; position: absolute; inset-inline: var(--page-gutter) 0; bottom: 0; border-bottom: 0.5px solid var(--separator); }
.earlier-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--row-min-height);
  padding: 10px var(--page-gutter);
  border: 0;
  background: transparent;
  color: var(--label);
  text-align: start;
}
.earlier-row:focus-visible { outline-offset: -2px; }
.earlier-open { flex: 1; color: var(--label-2); font-variant-numeric: tabular-nums; }
.earlier-chevron { flex: none; margin-inline-start: auto; color: var(--label-2); transition: transform var(--spring-duration) var(--ease-out); }
.earlier-row[aria-expanded='true'] .earlier-chevron { transform: rotate(180deg); }

/* The now-line: "Ahora 10:40" in the time column, a dot on the bar column and a 2 px green rule (green = now). */
.is-now { display: grid; grid-template-columns: var(--time-column) 4px minmax(0, 1fr); gap: var(--space-3); align-items: center; min-height: 24px; padding: var(--space-1) var(--page-gutter); }
.now-label { justify-self: end; color: var(--tint-label); font-weight: 600; text-align: end; font-variant-numeric: tabular-nums; }
.now-dot { justify-self: center; width: 8px; height: 8px; border-radius: 4px; background: var(--tint); }
.now-rule { height: 2px; margin-inline-start: -14px; background: var(--tint); }

/* Free time between two items: a quiet line in the title column. */
.row.is-gap { min-height: 32px; padding-block: 6px; grid-template-columns: var(--time-column) 4px minmax(0, 1fr); }
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
@container timeline (max-width: 20rem) {
  .timeline-section { --text-start: calc(var(--page-gutter) + 4px + var(--space-3)); }
  .row { grid-template-columns: 4px minmax(0, 1fr); row-gap: var(--space-1); }
  .row.has-control { grid-template-columns: 4px minmax(0, 1fr) var(--tap-target); }
  .row-time { grid-column: 2; flex-direction: row; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; text-align: start; }
  .row-bar { grid-column: 1; grid-row: 1 / span 2; }
  .row-content { grid-column: 2; }
  .row-control { grid-column: 3; grid-row: 1 / span 2; }
  .row.is-gap { grid-template-columns: 4px minmax(0, 1fr); }
  .gap-note { grid-column: 2; }
  .is-now { grid-template-columns: 4px minmax(0, 1fr); }
  .now-label { grid-column: 2; grid-row: 1; justify-self: start; }
  .now-dot { grid-column: 1; grid-row: 2; }
  .now-rule { grid-column: 2; grid-row: 2; margin: 0; }
  .is-carry .row-time { display: none; }
  .carry { grid-column: 2; flex-wrap: wrap; white-space: normal; }
  .carry-note { flex: 0 1 auto; min-width: 0; }
}
</style>
