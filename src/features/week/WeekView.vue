<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayIndex, TimeBlock } from '@/core/model'
import { addLocalDays, localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import { useUndoToast } from '@/ui/undoToast'
import { useMediaQuery } from '@/ui/useMediaQuery'
import EventSheet from '@/features/calendars/EventSheet.vue'
import FreeHoursBadge from '@/features/capacity/FreeHoursBadge.vue'
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { openAdd, setupWeekOffered } from '@/features/onboarding/reopen'
import { defaultTaskCategoryId } from '@/features/onboarding/templates'
import TaskSheet from '@/features/tasks/TaskSheet.vue'
import type { AddKind } from './addKind'
import AddMenu from './AddMenu.vue'
import BlockEditorSheet from './BlockEditorSheet.vue'
import BusyDetailsSheet from './BusyDetailsSheet.vue'
import PressChooserSheet from './PressChooserSheet.vue'
import type { PressOption } from './pressOption'
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
import { HOUR_HEIGHT_PX, allDayByDate, blockSegmentsByDate, busySegmentsByDate, taskSegmentsByDate } from './weekLayout'
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
const calendarNames = computed(() => new Map((document.value?.calendarSources ?? []).map((source) => [source.id, source.name])))
const busy = computed(() => busySegmentsByDate(external.value, document.value?.events ?? [], dates.value, timeZone.value, calendarNames.value))
const allDay = computed(() => allDayByDate(external.value, document.value?.events ?? [], dates.value, calendarNames.value))
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

// Phone only: one day at a time, or all seven days at a glance (one toolbar button switches).
const viewMode = ref<'day' | 'week'>('day')
function toggleView(): void {
  viewMode.value = viewMode.value === 'day' ? 'week' : 'day'
}
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

// A press where Week items crowd each other asks which one to open.
const chooserOpen = ref(false)
const chooserOptions = ref<PressOption[]>([])
function choose(options: PressOption[]): void {
  chooserOptions.value = options
  chooserOpen.value = true
}

// Open on the current hour once the grid is first shown; later changes keep the reader's position.
const root = ref<HTMLElement | null>(null)
// The sticky strips under the head sit below it: they read its height from --week-head-height.
const head = ref<HTMLElement | null>(null)
const headObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(([entry]) => {
  root.value?.style.setProperty('--week-head-height', `${entry!.borderBoxSize[0]?.blockSize ?? entry!.contentRect.height}px`)
})
watch(head, (element, previous) => {
  if (previous) headObserver?.unobserve(previous)
  if (element) headObserver?.observe(element)
})
onBeforeUnmount(() => headObserver?.disconnect())
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
const taskOpen = ref(false)
// The task shown in the sheet; none means a new one.
const editingTaskId = ref<string | undefined>()
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

function addFromMenu(kind: AddKind): void {
  if (!planner.writable) return
  if (kind === 'event') eventOpen.value = true
  else if (kind === 'task') openTask(undefined)
  else openAdd('routine')
}

function openTask(taskId: string | undefined): void {
  if (!planner.writable) return
  editingTaskId.value = taskId
  taskOpen.value = true
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

// The details sheet hands off to the routine's editor; focus stays in the editor (ui/sheetStack.ts) and comes back to
// the event when the editor closes.
function openConflict(blockId: string): void {
  detailsOpen.value = false
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
        <Button :variant="setupOffered ? 'tinted' : 'filled'" :disabled="!planner.writable" @click="openAdd('routine')">{{ t('week.empty.addBlock') }}</Button>
      </div>
    </EmptyState>
    <template v-else>
      <!-- The week's range, arrows and free hours stay under the toolbar, so they show on arrival even when the grid
           opens on the current hour. -->
      <div ref="head" class="week-head sticky-header" data-testid="week-head">
        <WeekNav
          :dates="dates"
          :today="today"
          :is-current="isCurrentWeek"
          :view="isWide ? undefined : viewMode"
          @previous="showWeek(-1)"
          @next="showWeek(1)"
          @today="showToday"
          @toggle-view="toggleView"
        >
          <!-- Free hours count from now, so they belong to the current week only. -->
          <template v-if="isCurrentWeek" #free-hours><FreeHoursBadge :document="document" :now="now" :framed="false" /></template>
        </WeekNav>
      </div>
      <WeekGrid
        v-if="isWide"
        :dates="dates"
        :today="today"
        :segments="segments"
        :busy="busy"
        :all-day="allDay"
        :tasks="taskSegments"
        :actuals="document.actuals"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @select-task="openTask"
        @create="openNew"
        @inspect="inspect"
        @choose="choose"
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
        :all-day="allDay"
        :tasks="taskSegments"
        :actuals="document.actuals"
        :categories="document.categories"
        :time-zone="timeZone"
        :now-minute="nowMinute"
        :editable="planner.writable"
        @select="openExisting"
        @select-task="openTask"
        @create="openNew"
        @inspect="inspect"
        @choose="choose"
      />
    </template>

    <!-- Thumb zone: on a phone the toolbar is out of reach, so "+" floats above the tab bar. -->
    <div v-if="!isWide && hasCategories && planner.writable" class="fab-anchor">
      <AddMenu variant="fab" placement="above" @choose="addFromMenu" />
    </div>

    <PressChooserSheet v-model:open="chooserOpen" :options="chooserOptions" />
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
    <TaskSheet v-model:open="taskOpen" :task-id="editingTaskId" />
  </div>
</template>

<style scoped src="./stickyHeader.css"></style>
<style scoped>
/* The floating "+" follows the Material FAB placement: --fab-margin above whatever is docked under it (the tab bar,
   or a status banner or the undo toast standing on it) and from the screen's trailing edge. Its menu opens above it
   and scrolls rather than leave the screen. */
.fab-anchor {
  --fab-bottom: calc(var(--tabbar-inset) + max(var(--banners-height, 0px), var(--undo-toast-lift, 0px)) + var(--fab-margin));
  --add-menu-max-height: calc(100dvh - var(--fab-bottom) - var(--fab-size) - var(--space-2) - var(--safe-top) - var(--fab-margin));
  position: fixed;
  z-index: 15;
  /* Flex, not a block: a block would hold the button on a text line, which at large text is taller than the button
     and puts its bottom wherever the font's baseline falls (1.8 px off on Linux at 300 %). */
  display: flex;
  inset-inline-end: calc(var(--fab-margin) + var(--safe-right));
  bottom: var(--fab-bottom);
  transition: bottom 0.2s var(--ease-out);
}
/* The last hours scroll clear of the "+": the page ends a margin above it. */
.has-fab { padding-bottom: calc(var(--fab-size) + var(--fab-margin)); }
@media (prefers-reduced-motion: reduce) {
  .fab-anchor { transition: none; }
}
.week-head {
  position: sticky;
  top: calc(var(--safe-top) + var(--toolbar-height));
  z-index: 6;
  padding-block: var(--space-1);
}
.empty-choices { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
</style>
