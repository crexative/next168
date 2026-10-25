<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, Task, TaskPlacement } from '@/core/model'
import { dueEndOf, fitTasks, minutesBeforeDue } from '@/core/scheduling'
import { localDateOf } from '@/core/time'
import { displayLocale, formatClock, formatDate, formatDuration, rangeText } from '@/ui/format'
import { joinInline, unbreakable } from '@/ui/inlineText'
import { categoryColor } from '@/features/insights/categoryColor'
import { readLastTaskCategory, rememberTaskCategory } from './lastCategory'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import { planTasks, recentDone, type PlacedEntry } from './grouping'
import { useTaskActions } from './taskActions'
import { ANY_FREE_TIME, newDraft, plannerToday, resolveWhen, taskFields, type TaskDraft } from './taskDraft'
import { outsideCategoryReason, warningFixes, type FitContext } from './warningFixes'
import TaskOptions from './TaskOptions.vue'
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
const plan = computed(() => {
  const context = fitContext.value
  if (!context) return null
  return planTasks(context.document, fitTasks({ ...context, timeZone: context.document.settings.timeZone }))
})
// Every warning comes with the fixes that really put its task on time, tried on a copy of the planner.
const warnings = computed(() => {
  const context = fitContext.value
  return context && plan.value ? plan.value.warnings.map((warning) => ({ ...warning, fixes: warningFixes(context, warning.task, warning.placement) })) : []
})

const done = computed(() => recentDone(document.value?.tasks ?? []))

// The title is typed first; the length, "Today" and, one level deeper, when the task may go, its due date and its
// priority. A new task fits any free slot unless the person picks a category: the category of the last task added is
// only offered as a one-tap suggestion ("Jog" is not "Work" because the previous task was). The planner may still be
// loading when this view starts, so the suggestion is only checked against the categories once they are there.
const form = ref<TaskDraft>(newDraft())
const suggestedCategoryId = ref(readLastTaskCategory())
const effectiveCategoryId = computed(() => resolveWhen(categories.value, form.value.categoryId))
const shownDraft = computed<TaskDraft>(() => ({ ...form.value, categoryId: effectiveCategoryId.value }))
// One field to start; the details appear once there is something to file.
const detailsOpen = computed(() => form.value.title.trim().length > 0)
const changedElsewhere = ref(false)
const workspaceId = computed(() => document.value?.workspaceId)
// The quick-add form depends on the stored entry it files the task under (when it names a category) and on the
// workspace it was typed in. Other commits (completing a task, editing another category) never touch what is typed;
// the snapshot only follows what the form displays.
const formBinding = { workspaceId: undefined as string | undefined, categoryId: '', snapshot: undefined as string | undefined }
watch(() => ({ workspace: workspaceId.value, id: effectiveCategoryId.value, snapshot: snapshotOf(categoryById.value.get(effectiveCategoryId.value)) }), (next) => {
  formBinding.workspaceId = next.workspace
  formBinding.categoryId = next.id
  formBinding.snapshot = next.snapshot
}, { immediate: true })
const canAdd = computed(() => planner.writable && form.value.title.trim().length > 0)

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
function fragments(entry: PlacedEntry, groupDate: string): string {
  const timeZone = document.value!.settings.timeZone
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

function describe(task: Task): string {
  const parts = [categoryOf(task)?.name ?? '', formatDuration(task.durationMin)]
  if (task.dueDate) parts.push(unbreakable(t('tasks.due', { date: dueLabel(task.dueDate) })))
  return joinInline(parts)
}

async function addTask(): Promise<void> {
  if (!canAdd.value) return
  const { workspaceId: typedIn, categoryId, snapshot } = formBinding
  changedElsewhere.value = false
  const task: Task = { ...taskFields({ ...form.value, categoryId }, plannerToday(document.value!.settings.timeZone)), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  const result = await planner.commit((draft) => {
    if (draft.workspaceId !== typedIn) throw new Error(CHANGED_ELSEWHERE)
    if (categoryId) assertEntry(draft.categories.find((category) => category.id === categoryId), snapshot)
    draft.tasks.push(task)
  })
  if (result.ok) {
    form.value = { ...form.value, title: '', dueDate: '', dueToday: false, categoryId: ANY_FREE_TIME }
    // Only a category the person picked is worth suggesting again; a task for any free slot leaves it as it was.
    if (categoryId) {
      rememberTaskCategory(categoryId)
      suggestedCategoryId.value = categoryId
    }
  } else if (result.reason === CHANGED_ELSEWHERE) {
    planner.dismissError()
    form.value = { ...form.value, categoryId: '' }
    changedElsewhere.value = true
  }
}

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
  return before > 0 && before < task.durationMin ? t('tasks.latePartial', { duration: formatDuration(before), date }) : t('tasks.late', { date })
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
    <form class="add" :aria-label="t('tasks.add.title')" @submit.prevent="addTask">
      <label class="field">
        <span class="visually-hidden">{{ t('tasks.add.titleLabel') }}</span>
        <input v-model="form.title" class="input" type="text" maxlength="120" autocomplete="off" enterkeyhint="done" :placeholder="t('tasks.add.titlePlaceholder')">
      </label>
      <div v-if="detailsOpen" class="details" role="group" :aria-label="t('tasks.add.details')" data-testid="task-details">
        <TaskOptions :draft="shownDraft" :categories="categories" :time-zone="document.settings.timeZone" :suggested-category-id="suggestedCategoryId" @patch="form = { ...form, ...$event }" />
        <Button type="submit" block :disabled="!canAdd">
          <Icon name="plus" :size="20" /> {{ t('tasks.add.submit') }}
        </Button>
      </div>
      <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('tasks.changedElsewhere') }}</p>
    </form>

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
      </ul>
    </section>

    <ListGroup v-for="day in plan.days" :key="day.date" :header="dayLabel(day.date)">
      <TaskRow
        v-for="entry in day.entries"
        :key="entry.task.id"
        :title="entry.task.title"
        :subtitle="joinInline([fragments(entry, day.date), describe(entry.task)])"
        :color="categoryOf(entry.task) ? categoryColor(categoryOf(entry.task)!) : 'var(--cat-gray)'"
        :complete-label="t('tasks.complete', { title: entry.task.title })"
        data-testid="placed-task"
        @complete="actions.complete(entry.task)"
        @open="openTask(entry.task)"
        @remove="actions.remove(entry.task)"
      >
        <span v-if="outsideNote(entry)" class="t-footnote outside-note" data-testid="outside-note">{{ outsideNote(entry) }}</span>
      </TaskRow>
    </ListGroup>

    <ListGroup v-if="plan.unplaced.length" :header="t('tasks.unplaced')" :footer="t('tasks.unplacedHint')">
      <TaskRow
        v-for="task in plan.unplaced"
        :key="task.id"
        :title="task.title"
        :subtitle="describe(task)"
        :color="categoryOf(task) ? categoryColor(categoryOf(task)!) : 'var(--cat-gray)'"
        :complete-label="t('tasks.complete', { title: task.title })"
        @complete="actions.complete(task)"
        @open="openTask(task)"
        @remove="actions.remove(task)"
      />
    </ListGroup>

    <EmptyState
      v-if="document.tasks.every((task) => task.doneAt)"
      icon="list-checks"
      :title="t('tasks.empty.title')"
      :description="t('tasks.empty.description')"
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
.add { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
.add > .field .input { padding-inline: min(var(--space-3), 12px); }
.details { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; }
.warnings { margin-top: var(--section-gap); }
.warnings ul { display: flex; flex-direction: column; gap: var(--space-3); }
.warning { display: flex; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); border-radius: var(--radius-card); background: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.warning-icon { flex: none; color: var(--label); margin-top: 2px; }
.warning-body { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.warning-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.outside-note { color: var(--label); }
.done-row :deep(.row-text) { color: var(--label-2); text-decoration: line-through; }
</style>
