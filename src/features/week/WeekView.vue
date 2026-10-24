<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayIndex, TimeBlock } from '@/core/model'
import { addLocalDays, localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { useUndoToast } from '@/ui/undoToast'
import { useMediaQuery } from '@/ui/useMediaQuery'
import EventSheet from '@/features/calendars/EventSheet.vue'
import FreeHoursBadge from '@/features/capacity/FreeHoursBadge.vue'
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { setupWeekOffered } from '@/features/onboarding/reopen'
import { defaultTaskCategoryId } from '@/features/onboarding/templates'
import AddMenu from './AddMenu.vue'
import BlockEditorSheet from './BlockEditorSheet.vue'
import BusyDetailsSheet from './BusyDetailsSheet.vue'
import DayPager from './DayPager.vue'
import WeekGrid from './WeekGrid.vue'
import WeekNav from './WeekNav.vue'
import WeekOverview from './WeekOverview.vue'
import type { BusyDetails } from './busyDetails'
import { removeBlock, restoreBlock, upsertBlock, type BlockDraft } from './blockEditing'
import { useExternalOccurrences } from './externalOccurrences'
import { dayIndexOf, formatDate, localMinuteOf, weekDates } from './localTime'
import { scrollToNow } from './scrollToNow'
import { keepWhereTheyWere, useTaskPlacements, type MovedNotice } from './taskPlacement'
import { useNow } from './useNow'
import { HOUR_HEIGHT_PX, blockSegmentsByDate, busySegmentsByDate, taskSegmentsByDate } from './weekLayout'
import { pagerIndexFor, shiftWeek } from './weekNavigation'

const DEFAULT_BLOCK_MINUTES = 60
// Tasks are fitted over the visible week and at most this many days ahead.
const TASK_HORIZON_MIN_DAYS = 7
const TASK_HORIZON_MAX_DAYS = 35

const { t, locale } = useI18n()
const planner = usePlannerStore()
const undoToast = useUndoToast()
const isWide = useMediaQuery('(min-width: 768px)')
const now = useNow()

const document = computed(() => planner.document)
const timeZone = computed(() => document.value?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const currentWeek = computed(() => weekDates(today.value, document.value?.settings.weekStartsOn ?? 1))
// Weeks away from the current one; the grid shows `currentWeek` shifted by this many weeks.
const weekOffset = ref(0)
const dates = computed(() => shiftWeek(currentWeek.value, weekOffset.value))
const isCurrentWeek = computed(() => weekOffset.value === 0)
const setupOffered = computed(() => setupWeekOffered(planner))
const nowMinute = computed(() => localMinuteOf(now.value, timeZone.value))
const external = useExternalOccurrences(() => document.value ? { fromDate: dates.value[0]!, days: 7, timeZone: timeZone.value } : null)

const horizonDays = computed(() => {
  const last = dates.value[6]! > addLocalDays(today.value, 6) ? dates.value[6]! : addLocalDays(today.value, 6)
  const days = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today.value}T00:00:00Z`)) / 86_400_000) + 1
  return Math.max(TASK_HORIZON_MIN_DAYS, Math.min(TASK_HORIZON_MAX_DAYS, days))
})
const schedulingExternal = useExternalOccurrences(() => document.value ? { fromDate: today.value, days: horizonDays.value, timeZone: timeZone.value } : null)
const { placements, notice, recompute } = useTaskPlacements(() => document.value
  ? {
      document: document.value,
      busy: schedulingExternal.value.filter((item) => item.busy && !item.allDay).map((item) => ({ start: item.start, end: item.end })),
      now: now.value,
      timeZone: timeZone.value,
      days: horizonDays.value,
    }
  : null)

const segments = computed(() => document.value ? blockSegmentsByDate(document.value, dates.value, timeZone.value) : {})
const taskSegments = computed(() => document.value ? taskSegmentsByDate(placements.value, document.value.tasks, dates.value, timeZone.value) : {})
const busy = computed(() => busySegmentsByDate(
  external.value, document.value?.events ?? [], dates.value, timeZone.value,
  new Map((document.value?.calendarSources ?? []).map((source) => [source.id, source.name])),
))
const blockCount = computed(() => document.value?.blocks.length ?? 0)
const hasCategories = computed(() => (document.value?.categories.length ?? 0) > 0)
// An event added from "+" has to show up even before the first block exists.
const hasContent = computed(() => blockCount.value > 0 || (document.value?.events.length ?? 0) > 0)

const pagerIndex = ref(pagerIndexFor(dates.value, today.value, 0))
watch(() => currentWeek.value[0], () => {
  weekOffset.value = 0
  pagerIndex.value = pagerIndexFor(dates.value, today.value, 0)
})

function showWeek(change: number): void {
  weekOffset.value += change
  pagerIndex.value = pagerIndexFor(dates.value, today.value, pagerIndex.value)
}

function showToday(): void {
  weekOffset.value = 0
  pagerIndex.value = pagerIndexFor(dates.value, today.value, 0)
  viewMode.value = 'day'
}

// Phone only: one day at a time, or all seven days at a glance.
const viewMode = ref<'day' | 'week'>('day')
const modeOptions = computed(() => [
  { value: 'day' as const, label: t('week.view.day') },
  { value: 'week' as const, label: t('week.view.week') },
])
function pickDay(index: number): void {
  pagerIndex.value = index
  viewMode.value = 'day'
}

// A task that moved on to another day says so, and Undo keeps it where it was for the rest of the day.
function movedMessage(moved: MovedNotice): string {
  const tomorrow = addLocalDays(today.value, 1)
  const toTomorrow = moved.moved.every((item) => item.to === tomorrow)
  if (moved.moved.length > 1) return t(toTomorrow ? 'week.moved.tomorrowMany' : 'week.moved.laterMany', { count: moved.moved.length })
  const title = moved.titles[0] ?? ''
  return toTomorrow
    ? t('week.moved.tomorrow', { title })
    : t('week.moved.later', { title, day: formatDate(moved.moved[0]!.to, locale.value, { weekday: 'long' }) })
}
watch(notice, (moved) => {
  if (!moved) return
  undoToast.show({
    message: movedMessage(moved),
    onUndo: () => { keepWhereTheyWere(moved); recompute() },
  })
}, { immediate: true })

// Open on the current hour once the grid is first shown; later changes keep the reader's position.
const root = ref<HTMLElement | null>(null)
const hasGrid = computed(() => document.value !== null && hasCategories.value && hasContent.value)
let positioned = false
watch(hasGrid, async (shown) => {
  if (!shown || positioned) return
  await nextTick()
  const line = root.value?.querySelector('[data-testid="now-line"]')
  if (!line) return
  positioned = true
  scrollToNow(line)
}, { immediate: true, flush: 'post' })

const detailsOpen = ref(false)
const details = ref<BusyDetails | null>(null)
const editorOpen = ref(false)
const eventOpen = ref(false)
const saveError = ref<string | null>(null)
const saving = ref(false)
const draft = ref<BlockDraft>({ title: '', categoryId: '', start: null, end: null, days: [] })

function openNew(date: string, start: number): void {
  if (!document.value || !planner.writable || !hasCategories.value) return
  saveError.value = null
  draft.value = {
    title: '', categoryId: defaultTaskCategoryId(document.value.categories, ''),
    start, end: (start + DEFAULT_BLOCK_MINUTES) % 1440, days: [dayIndexOf(date)],
  }
  editorOpen.value = true
}

function openNewFromButton(): void {
  const date = isWide.value ? today.value : dates.value[pagerIndex.value] ?? today.value
  const nextHour = Math.min(23, Math.floor(nowMinute.value / 60) + 1) * 60
  openNew(date, date === today.value ? nextHour : 9 * 60)
}

function addFromMenu(kind: 'block' | 'event'): void {
  if (!planner.writable) return
  if (kind === 'event') eventOpen.value = true
  else openNewFromButton()
}

function inspect(next: BusyDetails): void {
  details.value = next
  detailsOpen.value = true
}

function openExisting(blockId: string): void {
  const block = document.value?.blocks.find((item) => item.id === blockId)
  if (!block || !planner.writable) return
  saveError.value = null
  draft.value = { id: block.id, title: block.title, categoryId: block.categoryId, start: block.start, end: block.end, days: [...block.days] as DayIndex[] }
  editorOpen.value = true
}

function openConflict(blockId: string): void {
  detailsOpen.value = false
  // Remove the old modal before opening the editor so its focus restoration cannot steal editor focus.
  details.value = null
  openExisting(blockId)
}

async function save(block: TimeBlock): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const toSave = draft.value.id ? block : { ...block, id: crypto.randomUUID() }
    const result = await planner.commit((next) => upsertBlock(next, toSave))
    if (result.ok) editorOpen.value = false
    else saveError.value = result.reason
  } finally {
    saving.value = false
  }
}

async function remove(blockId: string): Promise<void> {
  const blocks = document.value?.blocks ?? []
  const index = blocks.findIndex((block) => block.id === blockId)
  const block = blocks[index]
  if (!block) return
  editorOpen.value = false
  const result = await planner.commit((next) => removeBlock(next, blockId))
  if (!result.ok) return
  undoToast.show({
    message: t('week.deleted', { title: block.title }),
    onUndo: () => { void planner.commit((next) => restoreBlock(next, block, index)) },
  })
}
</script>

<template>
  <div v-if="document" ref="root" class="week-view" :class="{ 'has-fab': !isWide && hasCategories && planner.writable }" :style="{ '--hour-height': `${HOUR_HEIGHT_PX}px` }">
    <p class="visually-hidden" data-testid="block-count" :data-count="blockCount">{{ t('week.summary', { count: blockCount }, blockCount) }}</p>
    <Teleport v-if="isWide && hasCategories && planner.writable" to="#toolbar-actions" defer>
      <AddMenu variant="toolbar" placement="below" @choose="addFromMenu" />
    </Teleport>

    <EmptyState v-if="!hasCategories" icon="calendar-days" :title="t('week.empty.noCategoriesTitle')" :description="t('week.empty.noCategoriesDescription')">
      <!-- Without categories the setup wizard creates them; when it cannot be offered, Settings remains. -->
      <SetupWeekPrompt v-if="setupOffered" />
      <Button v-else variant="tinted" href="#/settings">{{ t('week.empty.openSettings') }}</Button>
    </EmptyState>
    <EmptyState v-else-if="!hasContent" icon="calendar-days" :title="t('week.empty.noBlocksTitle')" :description="t('week.empty.noBlocksDescription')">
      <div class="empty-choices">
        <SetupWeekPrompt />
        <Button :variant="setupOffered ? 'tinted' : 'filled'" :disabled="!planner.writable" @click="openNewFromButton">{{ t('week.empty.addBlock') }}</Button>
      </div>
    </EmptyState>
    <template v-else>
      <WeekNav :dates="dates" :today="today" :is-current="isCurrentWeek" @previous="showWeek(-1)" @next="showWeek(1)" @today="showToday">
        <!-- Free hours count from now, so they belong to the current week only. -->
        <template v-if="isCurrentWeek" #free-hours><FreeHoursBadge :document="document" :now="now" /></template>
      </WeekNav>
      <div v-if="!isWide" class="view-mode">
        <SegmentedControl v-model="viewMode" :options="modeOptions" :label="t('week.view.label')" />
      </div>
      <WeekGrid
        v-if="isWide"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :tasks="taskSegments"
        :actuals="document.actuals"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @create="openNew"
        @inspect="inspect"
      />
      <WeekOverview
        v-else-if="viewMode === 'week'"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :tasks="taskSegments"
        :actuals="document.actuals"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        @pick="pickDay"
      />
      <DayPager
        v-else
        v-model:index="pagerIndex"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :tasks="taskSegments"
        :actuals="document.actuals"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @create="openNew"
        @inspect="inspect"
      />
    </template>

    <!-- Thumb zone: on a phone the toolbar is out of reach, so "+" floats above the tab bar. -->
    <div v-if="!isWide && hasCategories && planner.writable" class="fab-anchor">
      <AddMenu variant="fab" placement="above" @choose="addFromMenu" />
    </div>

    <BusyDetailsSheet v-if="details" v-model:open="detailsOpen" :details="details" :editable="planner.writable" @select="openConflict" />
    <BlockEditorSheet
      v-model:open="editorOpen"
      :draft="draft"
      :document="document"
      :save-error="saveError"
      :saving="saving"
      @save="save"
      @delete="remove"
    />
    <EventSheet v-model:open="eventOpen" />
  </div>
</template>

<style scoped>
.view-mode { padding: var(--space-2) var(--space-4) 0; }
/* The floating "+" sits above the tab bar and clear of the undo toast, which keeps the row just above the bar. */
.fab-anchor {
  position: fixed;
  z-index: 15;
  inset-inline-end: calc(var(--space-4) + var(--safe-right));
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--banners-height, 0px) + 4.75rem);
}
.has-fab { padding-bottom: 4.5rem; }
.empty-choices { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
</style>
