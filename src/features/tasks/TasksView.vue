<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, Task } from '@/core/model'
import { scheduleTasks } from '@/core/scheduler'
import { localDateOf } from '@/core/time'
import { formatDuration } from '@/features/insights/format'
import { categoryColor } from '@/features/insights/categoryColor'
import { defaultTaskCategoryId } from '@/features/onboarding/templates'
import { readLastTaskCategory, rememberTaskCategory } from './lastCategory'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { useUndoToast } from '@/ui/undoToast'
import { planTasks, recentDone, type PlacedEntry } from './grouping'
import TaskRow from './TaskRow.vue'

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180]

const { t, locale } = useI18n()
const planner = usePlannerStore()
const toast = useUndoToast()

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
  return planTasks(doc, scheduleTasks({ document: doc, busy, now: now.value, timeZone: doc.settings.timeZone }))
})
const done = computed(() => recentDone(document.value?.tasks ?? []))

const form = reactive({ title: '', durationMin: 60, categoryId: '', dueDate: '', priority: '2' as '1' | '2' | '3' })
// The category of the last task added is offered again; the first one that is not Sleep only when there is none.
const lastCategoryId = ref(readLastTaskCategory())
const effectiveCategoryId = computed(() => defaultTaskCategoryId(categories.value, form.categoryId || lastCategoryId.value))
// One field to start; duration, category, date and priority appear once there is something to file.
const detailsOpen = computed(() => form.title.trim().length > 0)
const changedElsewhere = ref(false)
// The quick-add form depends on one stored entry: the category it files the task under. Other commits (completing
// a task, editing another category) never touch what is typed; the snapshot only follows what the form displays.
const formCategory = { id: '', snapshot: undefined as string | undefined }
watch(() => ({ id: effectiveCategoryId.value, snapshot: snapshotOf(categoryById.value.get(effectiveCategoryId.value)) }), (next) => {
  formCategory.id = next.id
  formCategory.snapshot = next.snapshot
}, { immediate: true })
const canAdd = computed(() => planner.writable && form.title.trim().length > 0 && effectiveCategoryId.value !== '')

const priorityOptions = computed(() => (['1', '2', '3'] as const).map((value) => ({ value, label: t(`tasks.priority.${value}`) })))

function dayLabel(date: string): string {
  const today = localDateOf(now.value, document.value!.settings.timeZone)
  const label = new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  return date === today ? `${t('tasks.today')} · ${label}` : label
}

function timeRange(start: string, end: string): string {
  const format = new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: document.value!.settings.timeZone })
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
  return categoryById.value.get(task.categoryId)
}

function describe(task: Task): string {
  const parts = [categoryOf(task)?.name ?? '', formatDuration(t, task.durationMin)]
  if (task.dueDate) parts.push(t('tasks.due', { date: dueLabel(task.dueDate) }))
  return parts.filter(Boolean).join(' · ')
}

async function addTask(): Promise<void> {
  if (!canAdd.value) return
  const { id: categoryId, snapshot } = formCategory
  changedElsewhere.value = false
  const task: Task = {
    id: crypto.randomUUID(),
    title: form.title.trim(),
    categoryId,
    durationMin: form.durationMin,
    priority: Number(form.priority) as Task['priority'],
    createdAt: new Date().toISOString(),
    ...(form.dueDate ? { dueDate: form.dueDate } : {}),
  }
  const result = await planner.commit((draft) => {
    assertEntry(draft.categories.find((category) => category.id === categoryId), snapshot)
    draft.tasks.push(task)
  })
  if (result.ok) {
    form.title = ''
    form.dueDate = ''
    lastCategoryId.value = categoryId
    rememberTaskCategory(categoryId)
  } else if (result.reason === CHANGED_ELSEWHERE) {
    planner.dismissError()
    form.categoryId = ''
    changedElsewhere.value = true
  }
}

// An undo is bound to the entries its own action left behind; anything else means another document and nothing is written.
function undoCommit(mutator: Parameters<typeof planner.commit>[0]): void {
  void planner.commit(mutator).then((result) => { if (!result.ok && result.reason === CHANGED_ELSEWHERE) planner.dismissError() })
}

// Bound to the row that was clicked: a task that changed or was replaced meanwhile is left alone.
function reopen(task: Task): void {
  const shown = snapshotOf(task)
  undoCommit((draft) => {
    const target = draft.tasks.find((candidate) => candidate.id === task.id)
    if (!target) return
    assertEntry(target, shown)
    delete target.doneAt
  })
}

async function complete(task: Task): Promise<void> {
  const holder: { after?: string } = {}
  const result = await planner.commit((draft) => {
    const target = draft.tasks.find((candidate) => candidate.id === task.id)
    if (!target) return
    target.doneAt = new Date().toISOString()
    holder.after = snapshotOf(target)
  })
  if (!result.ok) return
  const after = holder.after
  toast.show({
    message: t('tasks.completed', { title: task.title }),
    onUndo: () => undoCommit((draft) => {
      const target = draft.tasks.find((candidate) => candidate.id === task.id)
      if (!target) return
      assertEntry(target, after)
      delete target.doneAt
    }),
  })
}

async function remove(task: Task): Promise<void> {
  const holder: { category?: string } = {}
  const result = await planner.commit((draft) => {
    holder.category = snapshotOf(draft.categories.find((candidate) => candidate.id === task.categoryId))
    draft.tasks = draft.tasks.filter((candidate) => candidate.id !== task.id)
  })
  if (!result.ok) return
  const category = holder.category
  toast.show({
    message: t('tasks.removed', { title: task.title }),
    onUndo: () => undoCommit((draft) => {
      assertEntry(draft.tasks.find((candidate) => candidate.id === task.id), undefined)
      assertEntry(draft.categories.find((candidate) => candidate.id === task.categoryId), category)
      draft.tasks.push(task)
    }),
  })
}

function overflowText(task: Task, minutes: number): string {
  return t('tasks.overflow', { duration: formatDuration(t, minutes), category: categoryOf(task)?.name ?? '' })
}

function overflowHint(task: Task, minutes: number): string {
  return t('tasks.overflowHint', { duration: formatDuration(t, minutes), category: categoryOf(task)?.name ?? '' })
}

function lateText(task: Task): string {
  return t('tasks.late', { date: task.dueDate ? dueLabel(task.dueDate) : '' })
}
</script>

<template>
  <div v-if="document && plan" class="tasks">
    <EmptyState
      v-if="categories.length === 0"
      icon="list-checks"
      :title="t('tasks.noCategories.title')"
      :description="t('tasks.noCategories.description')"
    >
      <a class="link t-headline" href="#/settings">{{ t('tasks.noCategories.action') }}</a>
    </EmptyState>

    <form v-else class="add" :aria-label="t('tasks.add.title')" @submit.prevent="addTask">
      <label class="field">
        <span class="visually-hidden">{{ t('tasks.add.titleLabel') }}</span>
        <input v-model="form.title" class="input" type="text" maxlength="120" autocomplete="off" enterkeyhint="done" :placeholder="t('tasks.add.titlePlaceholder')">
      </label>
      <div v-if="detailsOpen" class="details" role="group" :aria-label="t('tasks.add.details')" data-testid="task-details">
        <div class="field-row">
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.duration') }}</span>
            <select v-model.number="form.durationMin" class="input">
              <option v-for="minutes in DURATIONS" :key="minutes" :value="minutes">{{ formatDuration(t, minutes) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.category') }}</span>
            <select :value="effectiveCategoryId" class="input" @change="form.categoryId = ($event.target as HTMLSelectElement).value">
              <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
            </select>
          </label>
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.dueDate') }}</span>
            <input v-model="form.dueDate" class="input" type="date">
          </label>
        </div>
        <SegmentedControl v-model="form.priority" :options="priorityOptions" :label="t('tasks.add.priority')" />
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
        :remove-label="t('tasks.remove', { title: entry.task.title })"
        data-testid="placed-task"
        @complete="complete(entry.task)"
        @remove="remove(entry.task)"
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
        :remove-label="t('tasks.remove', { title: task.title })"
        @complete="complete(task)"
        @remove="remove(task)"
      />
    </ListGroup>

    <EmptyState
      v-if="categories.length > 0 && document.tasks.every((task) => task.doneAt)"
      icon="list-checks"
      :title="t('tasks.empty.title')"
      :description="t('tasks.empty.description')"
    />

    <ListGroup v-if="done.length" :header="t('tasks.recentDone')">
      <li v-for="task in done" :key="task.id" class="done-row" data-testid="done-task">
        <span class="t-body done-title">{{ task.title }}</span>
        <Button variant="plain" @click="reopen(task)">{{ t('tasks.reopen') }}</Button>
      </li>
    </ListGroup>
  </div>
</template>

<style scoped>
.tasks { padding: 0 var(--space-4) var(--space-6); }
.add { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.details { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 8rem; }
.field-row { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.warnings { margin-top: var(--space-4); }
.warnings ul { display: flex; flex-direction: column; gap: var(--space-2); }
.warning { display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-card); background: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.warning-icon { flex: none; color: var(--label); margin-top: 2px; }
.link { display: inline-flex; align-items: center; min-height: var(--tap-target); color: var(--tint-label); }
.done-row { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4); }
/* Inset like every other grouped list separator. */
.done-row + .done-row::before { content: ''; position: absolute; top: 0; right: 0; left: var(--space-4); border-top: 1px solid var(--separator); }
.done-title { color: var(--label-2); text-decoration: line-through; overflow-wrap: anywhere; }
</style>
