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
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { setupWeekOffered } from '@/features/onboarding/reopen'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { GoogleCoverageNotice, googleAvailable } from '@/features/calendars/googleCalendar'
import { formatDate } from '@/ui/format'
import { useNow } from '@/features/week/useNow'
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

const { t, locale } = useI18n()
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
  return buildTimeline({ document: document.value, today: today.value, timeZone: timeZone.value, external: external.value, placements })
})
// Blocks, placed tasks, events and calendar occurrences all count as planned content.
const hasContent = computed(() => (document.value?.blocks.length ?? 0) > 0 || timeline.value.items.length > 0 || timeline.value.allDay.length > 0)

// The moment Today first sees a plan is when "how did it go?" starts to make sense.
const stamped = ref<number | undefined>(document.value ? readPlanSince(document.value.workspaceId) : undefined)
watch(() => (document.value && document.value.blocks.length > 0 ? document.value.workspaceId : null), (workspaceId) => {
  if (workspaceId) stamped.value = stampPlanSince(workspaceId, now.value)
}, { immediate: true })
const since = computed(() => document.value ? planSince(document.value, stamped.value) : undefined)

// The evening link to the check-in replaces its card while it sits in the Now card's action slot.
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
useNowAnnouncements(nowState, timeZone, computed(() => document.value !== null && document.value !== undefined))

const toast = useUndoToast()
const checkInCard = ref<InstanceType<typeof CheckInCard> | null>(null)

// Coming back from a saved check-in, focus lands on its card so the confirmation is announced where the user is.
onMounted(async () => {
  if (!consumeSavedFlag()) return
  await nextTick()
  setTimeout(() => checkInCard.value?.focus(), 0)
})

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
  <div v-if="document" class="today-view">
    <p class="today-subtitle t-subhead t-secondary" data-testid="today-subtitle">{{ subtitle }}</p>
    <AssistantEntryButton />
    <!-- Without a timeline the coverage notice has no "Tu día" heading to sit under; it still shows, above the empty state. -->
    <component :is="GoogleCoverageNotice" v-if="!hasContent && GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
    <EmptyState v-if="!hasContent" icon="sun" :title="t('today.empty.title')" :description="t('today.empty.description')">
      <!-- The setup wizard is the quick way in; when it cannot be offered, the link to Week remains. -->
      <SetupWeekPrompt v-if="setupWeekOffered(planner)" />
      <Button v-else variant="tinted" href="#/week">{{ t('today.empty.action') }}</Button>
    </EmptyState>
    <template v-else>
      <NowCard
        :state="nowState"
        :categories="document.categories"
        :writable="planner.writable"
        :today="today"
        :time-zone="timeZone"
        @record="record"
        @complete-task="complete"
      />
      <CheckInCard v-if="nowState.action?.kind !== 'closeDay'" ref="checkInCard" :document="document" :now="now" />
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
        @record="record"
        @clear="clear"
        @complete-task="complete"
      >
        <template #notice>
          <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
        </template>
      </TodayTimeline>
      <template v-else>
        <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
        <EmptyState icon="calendar-days" :title="t('today.emptyDay.title')" :description="t('today.emptyDay.description')">
          <Button variant="tinted" href="#/week">{{ t('today.emptyDay.action') }}</Button>
        </EmptyState>
      </template>
    </template>
    <TodayTodo :today="today" />
  </div>
</template>

<style scoped>
.today-view { padding-bottom: var(--space-6); }
/* The subtitle belongs to the title: it takes the header gap under the title and leaves it under itself. */
.today-subtitle { margin: calc(var(--header-gap) * -1) var(--page-gutter) var(--header-gap); font-variant-numeric: tabular-nums; text-wrap: balance; }
</style>
