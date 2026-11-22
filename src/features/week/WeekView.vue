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
import { calendarNames as calendarNamesOf } from '@/features/calendars/calendarLabel'
import { GoogleCoverageNotice, googleAvailable } from '@/features/calendars/googleCalendar'
import FreeHoursBadge from '@/features/capacity/FreeHoursBadge.vue'
import SetupWeekPrompt from '@/features/onboarding/SetupWeekPrompt.vue'
import { openAdd, setupWeekOffered } from '@/features/onboarding/reopen'
import { defaultTaskCategoryId } from '@/features/onboarding/templates'
import TaskSheet from '@/features/tasks/TaskSheet.vue'
import BlockEditorSheet from './BlockEditorSheet.vue'
import RoutineConversation, { type RoutineChange } from './RoutineConversation.vue'
import { announce } from '@/ui/announcer'
import BusyDetailsSheet from './BusyDetailsSheet.vue'
import PressChooserSheet from './PressChooserSheet.vue'
import type { PressOption } from './pressOption'
import DayPager from './DayPager.vue'
import WeekGrid from './WeekGrid.vue'
import WeekNav from './WeekNav.vue'
import { weekRangeLabel } from './weekNavigation'
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
const calendarNames = computed(() => calendarNamesOf(document.value))
const busy = computed(() => busySegmentsByDate(external.value, document.value?.events ?? [], dates.value, timeZone.value, calendarNames.value))
const allDay = computed(() => allDayByDate(external.value, document.value?.events ?? [], dates.value, calendarNames.value))
const blockCount = computed(() => document.value?.blocks.length ?? 0)
const hasCategories = computed(() => (document.value?.categories.length ?? 0) > 0)
// An event added from "+", or a meeting from a connected calendar, has to show up even before the first block exists.
const hasContent = computed(() => blockCount.value > 0 || (document.value?.events.length ?? 0) > 0 || external.value.length > 0)
// The week on screen and the days tasks are fitted over: where Google Calendar does not cover them, Week says so.
const googleRanges = computed(() => [
  { start: dates.value[0]!, end: addLocalDays(dates.value[6]!, 1) },
  { start: today.value, end: addLocalDays(today.value, horizonDays.value) },
])

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
}

// "Día · Semana" (R_Semana): a phone opens on one day, a tablet or desktop on the whole week; each can switch, and a
// view the person chose stays chosen when the width crosses 768 px (rotating a tablet, resizing a window).
const range = computed(() => weekRangeLabel(dates.value, locale.value, today.value))
const chosenView = ref<'day' | 'week' | null>(null)
const viewMode = computed<'day' | 'week'>(() => chosenView.value ?? (isWide.value ? 'week' : 'day'))
function setView(view: 'day' | 'week'): void {
  chosenView.value = view
}
function pickDay(index: number): void {
  pagerIndex.value = index
  chosenView.value = 'day'
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
const setHeadHeight = (height: number) => root.value?.style.setProperty('--week-head-height', `${height}px`)
const headObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(([entry]) => {
  setHeadHeight(entry!.borderBoxSize[0]?.blockSize ?? entry!.contentRect.height)
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
  // The observer reports after layout, later than this: measure now so the strips under the head are placed (and
  // counted as covering the page) before scrolling to the line.
  if (head.value) setHeadHeight(head.value.getBoundingClientRect().height)
  scrollToNow(line, root.value!)
}, { immediate: true, flush: 'post' })

const detailsOpen = ref(false)
const details = ref<BusyDetails | null>(null)
const editorOpen = ref(false)
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

function openTask(taskId: string | undefined): void {
  if (!planner.writable) return
  editingTaskId.value = taskId
  taskOpen.value = true
}

function inspect(next: BusyDetails): void {
  details.value = next
  detailsOpen.value = true
}

// A sheet keeps only what the grid still shows: when Google Calendar is disconnected (here or in another tab) or a
// calendar drops an event, its details and any chooser offering it close instead of keeping its title on screen.
const shownItemKeys = computed(() => new Set([
  ...Object.values(busy.value).flat().map((item) => item.key),
  ...Object.values(allDay.value).flat().map((item) => item.key),
]))
watch(shownItemKeys, (shown) => {
  if (details.value?.key !== undefined && !shown.has(details.value.key)) {
    detailsOpen.value = false
    details.value = null
  }
  if (chooserOptions.value.some((option) => option.kind === 'event' && !shown.has(option.key.slice('e:'.length)))) {
    chooserOpen.value = false
    chooserOptions.value = []
  }
})

// A tap on a routine opens it as a conversation (R_EditarRutina); "Editar todo" there opens the whole form.
const talking = ref<string | null>(null)
const talkingBlock = computed(() => document.value?.blocks.find((item) => item.id === talking.value))
const talkingCategory = computed(() => document.value?.categories.find((category) => category.id === talkingBlock.value?.categoryId))
function openExisting(blockId: string): void {
  if (!planner.writable || !document.value?.blocks.some((item) => item.id === blockId)) return
  talking.value = blockId
}
function editAll(): void {
  const blockId = talking.value
  talking.value = null
  if (blockId) openEditor(blockId)
}
// A change said in the conversation is saved like the form's, and Deshacer puts back what was there.
async function applyChange(change: RoutineChange): Promise<void> {
  const before = document.value
  if (!before) return
  const blockIndex = before.blocks.findIndex((item) => item.id === talking.value)
  const block = before.blocks[blockIndex]
  if (!block) return
  if (change.kind === 'remove') {
    talking.value = null
    await remove(change.blockId)
    return
  }
  const category = before.categories.find((item) => item.id === (change.kind === 'goal' ? change.categoryId : block.categoryId))
  const previousGoal = category ? { ...category.goal } : undefined
  const result = await planner.commit((next) => {
    if (change.kind === 'block') upsertBlock(next, change.block)
    else {
      const target = next.categories.find((item) => item.id === change.categoryId)
      if (target) target.goal = change.goal
    }
  })
  if (!result.ok) return
  talking.value = null
  const message = t('onboarding.summary.saved')
  announce(message)
  undoToast.show({
    message,
    onUndo: () => {
      void planner.commit((next) => {
        if (change.kind === 'block') upsertBlock(next, block)
        else {
          const target = next.categories.find((item) => item.id === change.categoryId)
          if (target && previousGoal) target.goal = previousGoal
        }
      })
    },
  })
}

function openEditor(blockId: string): void {
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
  openEditor(blockId)
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
  <div v-if="document" ref="root" class="week-view" :style="{ '--hour-height': `${HOUR_HEIGHT_PX}px` }">
    <p class="visually-hidden" data-testid="block-count" :data-count="blockCount">{{ t('week.summary', { count: blockCount }, blockCount) }}</p>

    <!-- Without the grid (no categories, or nothing to show after a reload) the Google line still says what is missing. -->
    <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable && !hasGrid" :ranges="googleRanges" />
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
      <div ref="head" class="week-head sticky-header" data-testid="week-head">
        <!-- The subtitle says the week and its free hours (R_Semana); free hours count from now, so only this week has them.
             Announced when the week changes, so a screen reader hears where it landed. It is in the sticky head with the
             controls: Week opens on the current hour, and the week shown must still be named. -->
        <!-- A div: the free-hours badge inside is a paragraph of its own. -->
        <div class="week-subtitle t-subhead t-secondary">
          <span data-testid="week-range" aria-live="polite">{{ range }}</span><template v-if="isCurrentWeek"><span aria-hidden="true"> · </span><div class="free-hours-slot" data-testid="week-free-hours-slot"><FreeHoursBadge :document="document" :now="now" :framed="false" /></div></template>
        </div>
        <!-- The view switch and the arrows stay under the toolbar, so they show on arrival even when the grid opens on the
             current hour. -->
        <WeekNav
          :view="viewMode"
          @previous="showWeek(-1)"
          @next="showWeek(1)"
          @today="showToday"
          @set-view="setView"
        />
        <!-- In the sticky head: Week opens scrolled to the current hour, and the line must stay in view. -->
        <component :is="GoogleCoverageNotice" v-if="GoogleCoverageNotice && googleAvailable" :ranges="googleRanges" />
      </div>
      <WeekGrid
        v-if="isWide && viewMode === 'week'"
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
    <TaskSheet v-model:open="taskOpen" :task-id="editingTaskId" />
    <RoutineConversation
      v-if="talkingBlock"
      :key="talkingBlock.id"
      :block="talkingBlock"
      :category="talkingCategory"
      :writable="planner.writable"
      @close="talking = null"
      @edit-all="editAll"
      @change="applyChange"
    />
  </div>
</template>

<style scoped src="./stickyHeader.css"></style>
<style scoped>
.week-subtitle { margin: 0 var(--page-gutter) var(--space-2); font-variant-numeric: tabular-nums; }
/* The badge is a sentence of the subtitle here, in its colour. */
.free-hours-slot { display: inline; }
.free-hours-slot :deep(p) { display: inline; color: inherit; font: inherit; }
.week-head {
  position: sticky;
  /* The subtitle sits under the title as on every page (LargeTitle's gap is for content, not the subtitle). */
  margin-top: calc(var(--header-gap) * -1);
  top: calc(var(--safe-top) + var(--toolbar-height));
  z-index: 6;
  padding-block: var(--space-1);
}
.empty-choices { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
</style>
