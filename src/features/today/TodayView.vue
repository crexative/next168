<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentAndNext } from '@/core/now'
import { fitTasks, placementClock } from '@/core/scheduling'
import { localDateOf, type DatedOccurrence } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import { formatWholeHours } from '@/ui/format'
import { useUndoToast } from '@/ui/undoToast'
import AssistantEntryButton from '@/features/assistant/AssistantEntryButton.vue'
import { weekSplit, weekSplitHours } from '@/features/capacity/freeHours'
import CheckInCard from '@/features/checkin/CheckInCard.vue'
import { consumeSavedFlag } from '@/features/checkin/checkinFlash'
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { setupOpen, setupWeekOffered } from '@/features/onboarding/reopen'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { formatDate } from '@/features/week/localTime'
import { useNow } from '@/features/week/useNow'
import NowCard from './NowCard.vue'
import TodayTimeline from './TodayTimeline.vue'
import type { ActualStatus } from './actuals'
import { nextUp } from './nextUp'
import { isAskable, planSince, readPlanSince, stampPlanSince } from './planSince'
import { completeTask, reopenTask } from './taskCompletion'
import { buildTimeline } from './todayTimeline'
import { useBlockStatus } from './useBlockStatus'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const now = useNow()

const document = computed(() => planner.document)
const timeZone = computed(() => document.value?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const dateLabel = computed(() => formatDate(today.value, locale.value, { weekday: 'long', day: 'numeric', month: 'long' }))
const external = useExternalOccurrences(() => document.value ? { fromDate: today.value, days: 7, timeZone: timeZone.value } : null)

const nowAndNext = computed(() => document.value ? currentAndNext(document.value, now.value, timeZone.value) : { current: null, next: null })
// Free hours from now to the end of the week, in whole hours: the one figure Today keeps from the old header card.
const freeHours = computed(() => document.value ? weekSplitHours(weekSplit(document.value, now.value, timeZone.value)).freeAhead : 0)
// While the first-run setup is on screen the week is still being decided, so its free hours would mislead: date only.
// A setup closed without finishing leaves Hoy as usual.
const subtitle = computed(() => document.value?.settings.onboardingDone === false && setupOpen.value
  ? dateLabel.value
  : t('today.header.subtitle', { date: dateLabel.value, hours: formatWholeHours(freeHours.value) }))

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

const currentKey = computed(() => nowAndNext.value.current ? `block:${nowAndNext.value.current.blockId}@${nowAndNext.value.current.start}` : undefined)
const upNext = computed(() => nextUp(nowAndNext.value.next, timeline.value.items, now.value))

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
    <EmptyState v-if="!hasContent" icon="sun" :title="t('today.empty.title')" :description="t('today.empty.description')">
      <!-- The setup wizard is the quick way in; when it cannot be offered, the link to Week remains. -->
      <SetupWeekPrompt v-if="setupWeekOffered(planner)" />
      <Button v-else variant="tinted" href="#/week">{{ t('today.empty.action') }}</Button>
    </EmptyState>
    <template v-else>
      <NowCard
        :current="nowAndNext.current"
        :next="upNext"
        :categories="document.categories"
        :actuals="document.actuals"
        :askable="nowAndNext.current !== null && isAskable(nowAndNext.current.start, since)"
        :writable="planner.writable"
        :now="now"
        :today="today"
        :time-zone="timeZone"
        @record="record"
        @clear="clear"
      />
      <CheckInCard ref="checkInCard" :document="document" :now="now" />
      <TodayTimeline
        v-if="timeline.items.length || timeline.allDay.length"
        :items="timeline.items"
        :all-day="timeline.allDay"
        :actuals="document.actuals"
        :categories="document.categories"
        :now="now"
        :time-zone="timeZone"
        :writable="planner.writable"
        :current-key="currentKey"
        :plan-since="since"
        @record="record"
        @clear="clear"
        @complete-task="complete"
      />
      <EmptyState v-else icon="calendar-days" :title="t('today.emptyDay.title')" :description="t('today.emptyDay.description')">
        <Button variant="tinted" href="#/week">{{ t('today.emptyDay.action') }}</Button>
      </EmptyState>
    </template>
  </div>
</template>

<style scoped>
.today-view { padding-bottom: var(--space-6); }
/* The subtitle belongs to the title: it takes the header gap under the title and leaves it under itself. */
.today-subtitle { margin: calc(var(--header-gap) * -1) var(--page-gutter) var(--header-gap); font-variant-numeric: tabular-nums; text-wrap: balance; }
</style>
