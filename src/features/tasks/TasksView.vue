<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, Task, TaskPlacement } from '@/core/model'
import { dueEndOf, fitTasks, minutesBeforeDue } from '@/core/scheduling'
import { localDateOf } from '@/core/time'
import { displayLocale, formatClock, formatDate, formatDuration, formatMinuteOfDay, rangeText } from '@/ui/format'
import { joinInline, unbreakable } from '@/ui/inlineText'
import { categoryColor } from '@/features/insights/categoryColor'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import { planTasks, recentDone, type PlacedEntry } from './grouping'
import { useTaskActions } from './taskActions'
import { plannerToday } from './taskDraft'
import { outsideCategoryReason, warningFixes, type FitContext, type WarningFixes } from './warningFixes'
import SmartCapture from './SmartCapture.vue'
import TaskRow from './TaskRow.vue'
import TaskSheet from './TaskSheet.vue'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const actions = useTaskActions()

const now = ref(new Date())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => { ticker = setInterval(() => { now.value = new Date() }, 60_000) })
onBeforeUnmount(() => clearInterval(ticker))

const document = computed(() => planner.document)
const categories = computed(() => document.value?.categories ?? [])
const categoryById = computed(() => new Map(categories.value.map((category) => [category.id, category])))

// The same calendar occurrences Week and Today show are busy time for placement.
const external = useExternalOccurrences(() => document.value
  ? { fromDate: localDateOf(now.value, document.value.settings.timeZone), days: 7, timeZone: document.value.settings.timeZone }
  : null)

const fitContext = computed<FitContext | null>(() => document.value
  ? { document: document.value, busy: external.value.filter((item) => item.busy && !item.allDay).map((item) => ({ start: item.start, end: item.end })), now: now.value }
  : null)
const today = computed(() => (document.value ? localDateOf(now.value, document.value.settings.timeZone) : ''))
const plan = computed(() => {
  const context = fitContext.value
  if (!context) return null
  return planTasks(context.document, fitTasks({ ...context, timeZone: context.document.settings.timeZone }), today.value)
})
// «Sin fecha» stays open, newest first: the first few, then all of them on request.
const UNDATED_SHOWN = 10
const allUndated = ref(false)
const undated = computed(() => (allUndated.value ? plan.value?.undated ?? [] : (plan.value?.undated ?? []).slice(0, UNDATED_SHOWN)))
const openCount = computed(() => document.value?.tasks.filter((task) => !task.doneAt).length ?? 0)
// Every warning card on screen comes with the fixes that really put its task on time, tried on a copy of the planner.
// Each try is a whole fit, so only the cards on screen are worked out: the first few, then a page more per «Ver todas».
const FIRST_WARNING_CARDS = 3
const WARNING_CARDS_PER_PAGE = 10
const warningCards = ref(FIRST_WARNING_CARDS)
// The fixes worked out for this plan, by task: showing more cards works out only the new ones; a new plan starts over.
const fixesOfPlan = computed(() => plan.value && new Map<string, WarningFixes>())
const warnings = computed(() => {
  const context = fitContext.value
  const known = fixesOfPlan.value
  if (!context || !plan.value || !known) return []
  return plan.value.warnings.slice(0, warningCards.value).map((warning) => {
    let fixes = known.get(warning.task.id)
    if (!fixes) known.set(warning.task.id, fixes = warningFixes(context, warning.task, warning.placement))
    return { ...warning, fixes }
  })
})
const hiddenWarnings = computed(() => (plan.value?.warnings.length ?? 0) - warnings.value.length)

const done = computed(() => recentDone(document.value?.tasks ?? []))

const editing = ref<string | undefined>()
const sheetOpen = ref(false)
function openTask(task: Task): void {
  editing.value = task.id
  sheetOpen.value = true
}

function dayLabel(date: string): string {
  const today = localDateOf(now.value, document.value!.settings.timeZone)
  const label = formatDate(date, locale.value, { weekday: 'long', day: 'numeric', month: 'short' })
  return date === today ? joinInline([t('tasks.today'), label]) : label
}

function timeRange(start: string, end: string): string {
  const timeZone = document.value!.settings.timeZone
  return rangeText(formatClock(start, displayLocale.value, timeZone), formatClock(end, displayLocale.value, timeZone), false)
}

// Every fragment of a split task, in order; fragments on another day than the group's carry that day's short name.
// A fixed start with no length shows its time; a to-do due that day shows nothing here.
function fragments(entry: PlacedEntry, groupDate: string): string {
  const timeZone = document.value!.settings.timeZone
  if (entry.at) return formatClock(entry.at, displayLocale.value, timeZone)
  return entry.chunks.map((chunk) => {
    const date = localDateOf(chunk.start, timeZone)
    const range = timeRange(chunk.start, chunk.end)
    if (date === groupDate) return range
    return `${new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))} ${range}`
  }).join(', ')
}

function dueLabel(date: string): string {
  return formatDate(date, locale.value, { day: 'numeric', month: 'short' })
}

function categoryOf(task: Task): Category | undefined {
  return task.categoryId === undefined ? undefined : categoryById.value.get(task.categoryId)
}

// Category, length, a fixed start that is not shown as a range, and the due date.
function describe(task: Task, withTime = false): string {
  const parts = [categoryOf(task)?.name ?? '', task.durationMin === undefined ? '' : formatDuration(task.durationMin)]
  if (withTime && task.at !== undefined) parts.push(formatMinuteOfDay(task.at, displayLocale.value))
  if (task.dueDate) parts.push(unbreakable(t('tasks.due', { date: dueLabel(task.dueDate) })))
  return joinInline(parts)
}

function overdueText(task: Task): string {
  return joinInline([categoryOf(task)?.name ?? '', task.durationMin === undefined ? '' : formatDuration(task.durationMin), unbreakable(t('tasks.overdueSince', { date: dueLabel(task.dueDate!) }))])
}

const rowColor = (task: Task) => (categoryOf(task) ? categoryColor(categoryOf(task)!) : 'var(--cat-gray)')

// A task filed under a category misses time in that category; one that fits any free time misses free time.
function overflowText(task: Task, minutes: number): string {
  const category = categoryOf(task)?.name
  return category ? t('tasks.overflow', { duration: formatDuration(minutes), category }) : t('tasks.overflowAny', { duration: formatDuration(minutes) })
}

function overflowHint(task: Task, minutes: number): string {
  const category = categoryOf(task)?.name
  return category ? t('tasks.overflowHint', { duration: formatDuration(minutes), category }) : t('tasks.overflowAnyHint', { duration: formatDuration(minutes) })
}

// Late with part of it before the deadline says how much fits; otherwise it lands wholly after its due date.
function lateText(task: Task, placement: TaskPlacement): string {
  const date = task.dueDate ? dueLabel(task.dueDate) : ''
  const before = Math.floor(minutesBeforeDue(placement, dueEndOf(task, document.value!.settings.timeZone)))
  return before > 0 && before < (task.durationMin ?? 0) ? t('tasks.latePartial', { duration: formatDuration(before), date }) : t('tasks.late', { date })
}

function outsideNote(entry: PlacedEntry): string {
  const placement = plan.value!.placements.get(entry.task.id)
  const reason = placement && outsideCategoryReason(document.value!, entry.task, placement, now.value)
  return reason ? t(`tasks.outside.${reason}`, { category: categoryOf(entry.task)?.name ?? '' }) : ''
}

// The date is read when tapped, not when the card was drawn: a card left on screen across midnight means the new day.
async function doToday(task: Task): Promise<void> {
  await actions.setDueDate(task, plannerToday(document.value!.settings.timeZone), t('tasks.fix.doneToday', { title: task.title }))
}

async function moveDue(task: Task, date: string): Promise<void> {
  await actions.setDueDate(task, date, t('tasks.fix.dueMoved', { title: task.title, date: dueLabel(date) }))
}
</script>

<template>
  <div v-if="document && plan" class="tasks">
    <SmartCapture />

    <section v-if="warnings.length" class="warnings" :aria-label="t('tasks.warnings')" data-testid="task-warnings">
      <ul>
        <li v-for="warning in warnings" :key="warning.task.id" class="warning" :data-testid="`warning-${warning.task.id}`">
          <Icon name="triangle-alert" :size="20" class="warning-icon" />
          <div class="warning-body">
            <p class="t-headline">{{ warning.task.title }}</p>
            <p v-if="warning.placement.overflowMinutes > 0" class="t-subhead" data-testid="overflow-text">
              {{ overflowText(warning.task, warning.placement.overflowMinutes) }}
            </p>
            <p v-if="warning.placement.overflowMinutes > 0" class="t-footnote t-secondary">
              {{ overflowHint(warning.task, warning.placement.overflowMinutes) }}
            </p>
            <p v-if="warning.placement.late" class="t-subhead" data-testid="late-text">{{ lateText(warning.task, warning.placement) }}</p>
            <div class="warning-actions" role="group" :aria-label="t('tasks.fix.label', { title: warning.task.title })">
              <Button v-if="warning.fixes.today" variant="tinted" data-testid="fix-today" @click="doToday(warning.task)">
                {{ t('tasks.fix.doToday') }}
              </Button>
              <Button v-if="warning.fixes.moveDueTo" variant="tinted" data-testid="fix-move-due" @click="moveDue(warning.task, warning.fixes.moveDueTo)">
                {{ t('tasks.fix.moveDue', { date: unbreakable(dueLabel(warning.fixes.moveDueTo)) }) }}
              </Button>
              <Button variant="tinted" data-testid="fix-edit" @click="openTask(warning.task)">
                {{ t(warning.task.categoryId === undefined ? 'tasks.fix.edit' : 'tasks.fix.changeCategory') }}
              </Button>
            </div>
          </div>
        </li>
        <li v-if="hiddenWarnings > 0" class="warning-summary" data-testid="warning-summary">
          <p class="t-subhead">{{ t('tasks.moreWarnings', { count: hiddenWarnings }) }}</p>
          <Button variant="tinted" data-testid="show-all-warnings" @click="warningCards += WARNING_CARDS_PER_PAGE">
            {{ t('tasks.showAllWarnings') }}
          </Button>
        </li>
      </ul>
    </section>

    <ListGroup v-if="plan.overdue.length" :header="`${t('tasks.sections.overdue')} (${plan.overdue.length})`" data-testid="overdue-tasks">
      <TaskRow
        v-for="task in plan.overdue"
        :key="task.id"
        :title="task.title"
        :subtitle="overdueText(task)"
        :color="rowColor(task)"
        :complete-label="t('tasks.complete', { title: task.title })"
        data-testid="overdue-task"
        @complete="actions.complete(task)"
        @open="openTask(task)"
        @remove="actions.remove(task)"
      />
    </ListGroup>

    <ListGroup v-for="day in plan.days" :key="day.date" :header="dayLabel(day.date)">
      <TaskRow
        v-for="entry in day.entries"
        :key="entry.task.id"
        :title="entry.task.title"
        :subtitle="joinInline([fragments(entry, day.date), describe(entry.task)])"
        :color="rowColor(entry.task)"
        :complete-label="t('tasks.complete', { title: entry.task.title })"
        data-testid="placed-task"
        @complete="actions.complete(entry.task)"
        @open="openTask(entry.task)"
        @remove="actions.remove(entry.task)"
      >
        <span v-if="outsideNote(entry)" class="t-footnote outside-note" data-testid="outside-note">{{ outsideNote(entry) }}</span>
      </TaskRow>
    </ListGroup>

    <ListGroup v-if="plan.later.length" :header="t('tasks.sections.later')" data-testid="later-tasks">
      <TaskRow
        v-for="task in plan.later"
        :key="task.id"
        :title="task.title"
        :subtitle="describe(task, true)"
        :color="rowColor(task)"
        :complete-label="t('tasks.complete', { title: task.title })"
        data-testid="later-task"
        @complete="actions.complete(task)"
        @open="openTask(task)"
        @remove="actions.remove(task)"
      />
    </ListGroup>

    <ListGroup v-if="plan.undated.length" :header="`${t('tasks.sections.undated')} (${plan.undated.length})`" data-testid="undated-tasks">
      <TaskRow
        v-for="task in undated"
        :key="task.id"
        :title="task.title"
        :subtitle="describe(task, true)"
        :color="rowColor(task)"
        :complete-label="t('tasks.complete', { title: task.title })"
        data-testid="undated-task"
        @complete="actions.complete(task)"
        @open="openTask(task)"
        @remove="actions.remove(task)"
      />
      <li v-if="!allUndated && plan.undated.length > UNDATED_SHOWN" class="show-all">
        <Button variant="plain" data-testid="show-all-undated" @click="allUndated = true">{{ t('tasks.sections.showAll', { count: plan.undated.length }) }}</Button>
      </li>
    </ListGroup>

    <ListGroup v-if="plan.unplaced.length" :header="t('tasks.unplaced')" :footer="t('tasks.unplacedHint')">
      <TaskRow
        v-for="task in plan.unplaced"
        :key="task.id"
        :title="task.title"
        :subtitle="describe(task)"
        :color="rowColor(task)"
        :complete-label="t('tasks.complete', { title: task.title })"
        @complete="actions.complete(task)"
        @open="openTask(task)"
        @remove="actions.remove(task)"
      />
    </ListGroup>

    <EmptyState
      v-if="openCount === 0"
      icon="list-checks"
      :title="t('tasks.empty.title')"
      :description="`${t('tasks.empty.description')} ${t('capture.dictationHint')}`"
    />

    <ListGroup v-if="done.length" :header="t('tasks.recentDone')">
      <ListRow v-for="task in done" :key="task.id" :title="task.title" class="done-row" data-testid="done-task">
        <template #trailing>
          <Button variant="plain" @click="actions.reopen(task)">{{ t('tasks.reopen') }}</Button>
        </template>
      </ListRow>
    </ListGroup>

    <TaskSheet v-model:open="sheetOpen" :task-id="editing" />
  </div>
</template>

<style scoped>
.tasks { padding: 0 var(--page-gutter) var(--space-6); }
.warnings { margin-top: var(--section-gap); }
.warnings ul { display: flex; flex-direction: column; gap: var(--space-3); }
.warning { display: flex; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); border-radius: var(--radius-card); background: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.warning-icon { flex: none; color: var(--label); margin-top: 2px; }
.warning-body { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.warning-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.warning-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--card-padding-block) var(--card-padding); border-radius: var(--radius-card); background: var(--surface); }
.warning-summary p { flex: 1 1 12em; min-width: 0; }
.outside-note { color: var(--label); }
.done-row :deep(.row-text) { color: var(--label-2); text-decoration: line-through; }
.show-all { display: flex; padding: 0 var(--card-padding); min-height: var(--row-min-height); align-items: center; }
</style>
