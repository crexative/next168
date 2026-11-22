<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fitTasks, placementClock } from '@/core/scheduling'
import { addLocalDays, localDateOf, type DatedOccurrence } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import { useUndoToast } from '@/ui/undoToast'
import AssistantEntryButton from '@/features/assistant/AssistantEntryButton.vue'
import CheckInCard from '@/features/checkin/CheckInCard.vue'
import { consumeSavedFlag } from '@/features/checkin/checkinFlash'
import { checkInCardVisible, checkInDoneToday } from '@/features/checkin/evening'
import WeekGlance from '@/features/insights/WeekGlance.vue'
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { setupWeekOffered } from '@/features/onboarding/reopen'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { GoogleCoverageNotice, googleAvailable } from '@/features/calendars/googleCalendar'
import { formatDate } from '@/ui/format'
import { useNow } from '@/features/week/useNow'
import { openAdd } from '@/features/onboarding/reopen'
import { PERSISTENT_QUERY } from '@/app/sidebar'
import { useMediaQuery } from '@/ui/useMediaQuery'
import NowCard from './NowCard.vue'
import TodayTimeline from './TodayTimeline.vue'
import TodayTodo from './TodayTodo.vue'
import type { ActualStatus } from './actuals'
import { upcomingItems } from './nextUp'
import { useNowAnnouncements } from './nowAnnouncement'
import { buildNowState } from './nowState'
import { planSince, readPlanSince, stampPlanSince } from './planSince'
import { completeTask, reopenTask } from './taskCompletion'
import { buildTimeline } from './todayTimeline'
import { useBlockStatus } from './useBlockStatus'
import { useTaskPartLabels } from '@/ui/taskParts'

const { t, locale } = useI18n()
const { partLabel, partSpoken } = useTaskPartLabels()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const timeZone = computed(() => document.value?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const subtitle = computed(() => formatDate(today.value, locale.value, { weekday: 'long', day: 'numeric', month: 'long' }))
const external = useExternalOccurrences(() => document.value ? { fromDate: today.value, days: 7, timeZone: timeZone.value } : null)
const googleRanges = computed(() => [{ start: today.value, end: addLocalDays(today.value, 7) }])

// Tasks are re-fitted on five-minute steps, so the plan does not shift every minute and starts on tidy times.
const fitFrom = computed(() => placementClock(now.value).getTime())
const timeline = computed(() => {
  if (!document.value) return { items: [], allDay: [] }
  const busy = external.value.filter((item) => item.busy && !item.allDay).map((item) => ({ start: item.start, end: item.end }))
  const placements = fitTasks({ document: document.value, busy, now: new Date(fitFrom.value), timeZone: timeZone.value })
  return buildTimeline({ document: document.value, today: today.value, timeZone: timeZone.value, external: external.value, placements,
    partLabel, partSpoken })
})
// Blocks, placed tasks, events and calendar occurrences all count as planned content.
const hasContent = computed(() => (document.value?.blocks.length ?? 0) > 0 || timeline.value.items.length > 0 || timeline.value.allDay.length > 0)

// The moment Today first sees a plan is when "how did it go?" starts to make sense.
const stamped = ref<number | undefined>(document.value ? readPlanSince(document.value.workspaceId) : undefined)
watch(() => (document.value && document.value.blocks.length > 0 ? document.value.workspaceId : null), (workspaceId) => {
  if (workspaceId) stamped.value = stampPlanSince(workspaceId, now.value)
}, { immediate: true })
const since = computed(() => document.value ? planSince(document.value, stamped.value) : undefined)

// From 20:00 until it is done the check-in row moves above the day's list; the rest of the day it closes the list.
const closeDayOpen = computed(() => !!document.value && checkInCardVisible(document.value, now.value) && !checkInDoneToday(document.value, now.value))
const nowState = computed(() => buildNowState({
  items: timeline.value.items,
  upcoming: document.value ? upcomingItems(document.value, today.value, timeZone.value, timeline.value.items) : [],
  actuals: document.value?.actuals ?? [],
  since: since.value,
  now: now.value,
  today: today.value,
  timeZone: timeZone.value,
  closeDayOpen: closeDayOpen.value,
}))
// The row of a block the Now card is asking about while it is under way does not ask a second time.
const askedKey = computed(() => {
  const action = nowState.value.action
  const instant = now.value.getTime()
  if (action?.kind !== 'ask' || Date.parse(action.occurrence.start) > instant || Date.parse(action.occurrence.end) <= instant) return undefined
  return `block:${action.occurrence.blockId}@${action.occurrence.start}`
})
// What the Ahora hero shows is not repeated in the list: its item, and the routine it sits in (principle 3).
const hero = computed(() => {
  const state = nowState.value
  if (!state.primary) return undefined
  return { key: state.primary.key, contextKey: state.context && state.context.kind !== 'alsoNow' ? state.context.key : undefined }
})
// On the desktop "Añadir" is the page's filled button, so the hero's action is tinted; the day's extras move to an aside.
const wide = useMediaQuery(PERSISTENT_QUERY)

useNowAnnouncements(nowState, timeZone, computed(() => document.value !== null && document.value !== undefined))

const toast = useUndoToast()
const checkInCard = ref<InstanceType<typeof CheckInCard> | null>(null)

// Coming back from a saved check-in, focus lands on its card so the confirmation is announced where the user is.
onMounted(async () => {
  if (!consumeSavedFlag()) return
  await nextTick()
  setTimeout(() => checkInCard.value?.focus(), 0)
})

// Completing a piece completes the task: both of its controls (the row and Now) pass the task's own title.
async function complete(taskId: string, title: string): Promise<void> {
  const holder: { after?: string } = {}
  const result = await planner.commit((draft) => { holder.after = completeTask(draft, taskId, new Date()) })
  if (!result.ok || holder.after === undefined) return
  const after = holder.after
  toast.show({
    message: t('today.timeline.taskDone', { title }),
    onUndo: () => {
      void planner.commit((draft) => {
        reopenTask(draft, { id: taskId }, after)
      }).then((undone) => { if (!undone.ok) planner.dismissError() })
    },
  })
}

const blockStatus = useBlockStatus()

function record(occurrence: DatedOccurrence, status: ActualStatus, actualMinutes?: number): void {
  void blockStatus.record(occurrence, status, actualMinutes)
}

function clear(occurrence: DatedOccurrence): void {
  void blockStatus.clear(occurrence)
}
</script>

<template>
  <div v-if="document" class="today-view" :class="{ 'is-wide': wide }">
    <p class="today-subtitle t-subhead t-secondary" data-testid="today-subtitle">{{ subtitle }}</p>
    <AssistantEntryButton />
    <!-- Without a timeline the coverage notice has no "Tu día" heading to sit under; it still shows, above the empty state. -->
    <component :is="GoogleCoverageNotice" v-if="!hasContent && GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
    <template v-if="!hasContent">
      <EmptyState :week-bar="t('today.empty.weekBar')" :title="t('today.empty.title')" :description="t('today.empty.description')">
        <!-- The setup wizard is the quick way in, a single routine the other; when setup cannot be offered, Week remains. -->
        <template v-if="setupWeekOffered(planner)">
          <SetupWeekPrompt />
          <Button variant="plain" data-testid="today-add-routine" @click="openAdd('routine')">{{ t('week.empty.addBlock') }}</Button>
        </template>
        <Button v-else variant="tinted" href="#/week">{{ t('today.empty.action') }}</Button>
      </EmptyState>
      <!-- To-dos for today show whether the day has a plan or not (one just added from "+" › Tarea included). -->
      <TodayTodo :today="today" />
    </template>
    <div v-else class="today-columns">
      <div class="today-main">
        <NowCard
          :state="nowState"
          :categories="document.categories"
          :writable="planner.writable"
          :today="today"
          :time-zone="timeZone"
          :quiet-action="wide"
          @record="record"
          @complete-task="complete"
        />
        <CheckInCard v-if="closeDayOpen && !wide" ref="checkInCard" :document="document" :now="now" />
        <TodayTimeline
          v-if="timeline.items.length || timeline.allDay.length"
          :items="timeline.items"
          :all-day="timeline.allDay"
          :actuals="document.actuals"
          :categories="document.categories"
          :now="now"
          :time-zone="timeZone"
          :writable="planner.writable"
          :asked-key="askedKey"
          :plan-since="since"
          :hero="hero"
          @record="record"
          @clear="clear"
          @complete-task="complete"
        >
          <template #notice>
            <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
          </template>
          <template v-if="!wide" #end>
            <TodayTodo :today="today" />
          </template>
        </TodayTimeline>
        <template v-else>
          <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
          <EmptyState icon="calendar-days" :title="t('today.emptyDay.title')" :description="t('today.emptyDay.description')">
            <Button variant="tinted" href="#/week">{{ t('today.emptyDay.action') }}</Button>
          </EmptyState>
          <TodayTodo v-if="!wide" :today="today" />
        </template>
        <CheckInCard v-if="!closeDayOpen && !wide" ref="checkInCard" :document="document" :now="now" />
      </div>
      <!-- Desktop (R_EscritorioHoy): the check-in, the to-dos and the week at a glance beside the day, never repeated. -->
      <aside v-if="wide" class="today-aside" :aria-label="t('today.aside')">
        <CheckInCard ref="checkInCard" :document="document" :now="now" />
        <TodayTodo :today="today" />
        <WeekGlance :document="document" :now="now" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.today-view { padding-bottom: var(--space-6); }
/* The subtitle belongs to the title: it takes the header gap under the title and leaves it under itself. */
.today-subtitle { margin: calc(var(--header-gap) * -1) var(--page-gutter) var(--group-gap); font-variant-numeric: tabular-nums; text-wrap: balance; }
/* Desktop: the day (main) and an aside of 320–360 px that wraps under it below 1200 px of content. */
.is-wide .today-columns { display: flex; flex-wrap: wrap; gap: var(--section-gap); padding-inline: var(--page-gutter); }
.is-wide .today-main { flex: 1 1 560px; min-width: 0; }
.is-wide .today-main :deep(.now-card) { margin-inline: 0; }
.is-wide .today-main :deep(.timeline-section) { --page-gutter: 0px; }
.today-aside { display: flex; flex: 1 1 320px; flex-direction: column; gap: var(--group-gap); max-width: 360px; }
.today-aside :deep(.checkin-card) { margin: 0; }
.today-aside :deep(.today-todo) { margin-top: 0; }
.today-aside :deep(.todo-title) { margin-inline: 0; }
.today-aside :deep(.is-timeline .task-content) { grid-template-columns: minmax(0, 1fr) var(--tap-target); padding-inline: 0; }
.today-aside :deep(.is-timeline :is(.timeline-time, .timeline-bar)) { display: none; }
.today-aside :deep(.is-timeline + .is-timeline .task-content::before) { left: 0; }
</style>
