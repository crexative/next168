<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentAndNext } from '@/core/now'
import { scheduleTasks } from '@/core/scheduler'
import { localDateOf, type DatedOccurrence } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import AskAssistantLink from '@/ui/AskAssistantLink.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { formatDate } from '@/features/week/localTime'
import { useNow } from '@/features/week/useNow'
import NowCard from './NowCard.vue'
import TodayTimeline from './TodayTimeline.vue'
import { clearActual, recordActual, type ActualStatus } from './actuals'
import { buildTimeline } from './todayTimeline'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const timeZone = computed(() => document.value?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const dateLabel = computed(() => formatDate(today.value, locale.value, { weekday: 'long', day: 'numeric', month: 'long' }))
const external = useExternalOccurrences(() => document.value ? { fromDate: today.value, days: 7, timeZone: timeZone.value } : null)

const nowAndNext = computed(() => document.value ? currentAndNext(document.value, now.value, timeZone.value) : { current: null, next: null })
const timeline = computed(() => {
  if (!document.value) return { items: [], allDay: [] }
  const busy = external.value.filter((item) => item.busy && !item.allDay).map((item) => ({ start: item.start, end: item.end }))
  const placements = scheduleTasks({ document: document.value, busy, now: now.value, timeZone: timeZone.value })
  return buildTimeline({ document: document.value, today: today.value, timeZone: timeZone.value, external: external.value, placements })
})
// Blocks, placed tasks, events and calendar occurrences all count as planned content.
const hasContent = computed(() => (document.value?.blocks.length ?? 0) > 0 || timeline.value.items.length > 0 || timeline.value.allDay.length > 0)

function record(occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number): void {
  void planner.commit((draft) => recordActual(draft, occurrence, status, actualMinutes))
}

function clear(occurrence: DatedOccurrence): void {
  void planner.commit((draft) => clearActual(draft, occurrence))
}
</script>

<template>
  <div v-if="document" class="today-view">
    <p class="date-label t-headline t-secondary" data-testid="today-date">{{ dateLabel }}</p>
    <AskAssistantLink class="assistant-entry" />
    <EmptyState v-if="!hasContent" icon="sun" :title="t('today.empty.title')" :description="t('today.empty.description')">
      <a class="action-link t-headline" href="#/week">{{ t('today.empty.action') }}</a>
    </EmptyState>
    <template v-else>
      <NowCard
        :current="nowAndNext.current"
        :next="nowAndNext.next"
        :categories="document.categories"
        :today="today"
        :time-zone="timeZone"
      />
      <a class="checkin-row" href="#/checkin">
        <Icon name="moon" :size="22" />
        <span class="checkin-text">
          <span class="t-body">{{ t('today.checkin.title') }}</span>
          <span class="t-footnote t-secondary">{{ t('today.checkin.description') }}</span>
        </span>
        <Icon name="chevron-right" :size="20" class="checkin-chevron" />
      </a>
      <TodayTimeline
        v-if="timeline.items.length || timeline.allDay.length"
        :items="timeline.items"
        :all-day="timeline.allDay"
        :actuals="document.actuals"
        :categories="document.categories"
        :now="now"
        :time-zone="timeZone"
        :writable="planner.writable"
        @record="record"
        @clear="clear"
      />
      <EmptyState v-else icon="calendar-days" :title="t('today.emptyDay.title')" :description="t('today.emptyDay.description')">
        <a class="action-link t-headline" href="#/week">{{ t('today.emptyDay.action') }}</a>
      </EmptyState>
    </template>
  </div>
</template>

<style scoped>
.today-view { padding-bottom: var(--space-6); }
.date-label { margin: calc(var(--space-2) * -1) var(--space-4) var(--space-4); }
.assistant-entry { margin: 0 var(--space-4) var(--space-4); }
.action-link { display: inline-flex; align-items: center; min-height: var(--tap-target); color: var(--tint-label); }
.checkin-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap-target);
  margin: var(--space-4) var(--space-4) 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
}
.checkin-row:active { transform: scale(0.97); }
.checkin-row > :first-child { color: var(--tint-label); }
.checkin-text { display: flex; flex: 1; flex-direction: column; }
.checkin-chevron { color: var(--label-3); }
@media (prefers-reduced-motion: reduce) {
  .checkin-row:active { transform: none; opacity: 0.7; }
}
</style>
