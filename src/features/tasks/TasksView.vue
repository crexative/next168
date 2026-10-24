<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, Task } from '@/core/model'
import { fitTasks } from '@/core/scheduling'
import { localDateOf } from '@/core/time'
import { displayLocale, formatDuration } from '@/ui/format'
import { categoryColor } from '@/features/insights/categoryColor'
import { readLastTaskCategory, rememberTaskCategory } from './lastCategory'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import { planTasks, recentDone, type PlacedEntry } from './grouping'
import { useTaskActions } from './taskActions'
import { newDraft, resolveWhen, taskFields, type TaskDraft } from './taskDraft'
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

const plan = computed(() => {
  const doc = document.value
  if (!doc) return null
  const busy = external.value.filter((item) => item.busy && !item.allDay).map((item) => ({ start: item.start, end: item.end }))
  return planTasks(doc, fitTasks({ document: doc, busy, now: now.value, timeZone: doc.settings.timeZone }))
})
const done = computed(() => recentDone(document.value?.tasks ?? []))

// The title is typed first; the length and, one level deeper, when the task may go, its due date and its priority.
// The choice of the last task added is offered again (a category that is gone, or Sleep, is never remembered).
// The planner may still be loading when this view starts, so the remembered choice is only checked against the
// categories once they are there (effectiveCategoryId) and never decided up front.
const form = ref<TaskDraft>({ ...newDraft(), categoryId: readLastTaskCategory() })
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
  const label = new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  return date === today ? `${t('tasks.today')} · ${label}` : label
}

function timeRange(start: string, end: string): string {
  const format = new Intl.DateTimeFormat(displayLocale.value, { hour: 'numeric', minute: '2-digit', timeZone: document.value!.settings.timeZone })
  return `${format.format(new Date(start))}–${format.format(new Date(end))}`
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
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

function categoryOf(task: Task): Category | undefined {
  return task.categoryId === undefined ? undefined : categoryById.value.get(task.categoryId)
}

function describe(task: Task): string {
  const parts = [categoryOf(task)?.name ?? '', formatDuration(task.durationMin)]
  if (task.dueDate) parts.push(t('tasks.due', { date: dueLabel(task.dueDate) }))
  return parts.filter(Boolean).join(' · ')
}

async function addTask(): Promise<void> {
  if (!canAdd.value) return
  const { workspaceId: typedIn, categoryId, snapshot } = formBinding
  changedElsewhere.value = false
  const task: Task = { ...taskFields({ ...form.value, categoryId }), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  const result = await planner.commit((draft) => {
    if (draft.workspaceId !== typedIn) throw new Error(CHANGED_ELSEWHERE)
    if (categoryId) assertEntry(draft.categories.find((category) => category.id === categoryId), snapshot)
    draft.tasks.push(task)
  })
  if (result.ok) {
    form.value = { ...form.value, title: '', dueDate: '' }
    rememberTaskCategory(categoryId)
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

function lateText(task: Task): string {
  return t('tasks.late', { date: task.dueDate ? dueLabel(task.dueDate) : '' })
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
        <TaskOptions :draft="shownDraft" :categories="categories" @patch="form = { ...form, ...$event }" />
        <Button type="submit" block :disabled="!canAdd">
          <Icon name="plus" :size="20" /> {{ t('tasks.add.submit') }}
        </Button>
      </div>
      <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('tasks.changedElsewhere') }}</p>
    </form>

    <section v-if="plan.warnings.length" class="warnings" :aria-label="t('tasks.warnings')" data-testid="task-warnings">
      <ul>
        <li v-for="warning in plan.warnings" :key="warning.task.id" class="warning" :data-testid="`warning-${warning.task.id}`">
          <Icon name="triangle-alert" :size="20" class="warning-icon" />
          <div>
            <p class="t-headline">{{ warning.task.title }}</p>
            <p v-if="warning.placement.overflowMinutes > 0" class="t-subhead" data-testid="overflow-text">
              {{ overflowText(warning.task, warning.placement.overflowMinutes) }}
            </p>
            <p v-if="warning.placement.overflowMinutes > 0" class="t-footnote t-secondary">
              {{ overflowHint(warning.task, warning.placement.overflowMinutes) }}
            </p>
            <p v-if="warning.placement.late" class="t-subhead" data-testid="late-text">{{ lateText(warning.task) }}</p>
            <p v-if="warning.placement.late" class="t-footnote t-secondary">{{ t('tasks.lateHint') }}</p>
          </div>
        </li>
      </ul>
    </section>

    <ListGroup v-for="day in plan.days" :key="day.date" :header="dayLabel(day.date)">
      <TaskRow
        v-for="entry in day.entries"
        :key="entry.task.id"
        :title="entry.task.title"
        :subtitle="`${fragments(entry, day.date)} · ${describe(entry.task)}`"
        :color="categoryOf(entry.task) ? categoryColor(categoryOf(entry.task)!) : 'var(--cat-gray)'"
        :complete-label="t('tasks.complete', { title: entry.task.title })"
        data-testid="placed-task"
        @complete="actions.complete(entry.task)"
        @open="openTask(entry.task)"
        @remove="actions.remove(entry.task)"
      />
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
      <li v-for="task in done" :key="task.id" class="done-row" data-testid="done-task">
        <span class="t-body done-title">{{ task.title }}</span>
        <Button variant="plain" @click="actions.reopen(task)">{{ t('tasks.reopen') }}</Button>
      </li>
    </ListGroup>

    <TaskSheet v-model:open="sheetOpen" :task-id="editing" />
  </div>
</template>

<style scoped>
.tasks { padding: 0 var(--space-4) var(--space-6); }
.add { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
/* With large text the card's side margins stop growing (as system margins do), so the field keeps room for its hint. */
.add { padding-inline: min(var(--space-4), 16px); }
.add > .field .input { padding-inline: min(var(--space-3), 12px); }
.details { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; }
.warnings { margin-top: var(--space-4); }
.warnings ul { display: flex; flex-direction: column; gap: var(--space-2); }
.warning { display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-card); background: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.warning-icon { flex: none; color: var(--label); margin-top: 2px; }
.done-row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4); }
/* Inset like every other grouped list separator. */
.done-row + .done-row::before { content: ''; position: absolute; top: 0; right: 0; left: var(--space-4); border-top: 1px solid var(--separator); }
.done-title { color: var(--label-2); text-decoration: line-through; overflow-wrap: anywhere; }
</style>
