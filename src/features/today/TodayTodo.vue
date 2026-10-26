<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import SmartCapture from '@/features/tasks/SmartCapture.vue'
import { useTaskActions } from '@/features/tasks/taskActions'
import TaskRow from '@/features/tasks/TaskRow.vue'
import TaskSheet from '@/features/tasks/TaskSheet.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import { displayLocale, formatDate, formatDuration, formatMinuteOfDay } from '@/ui/format'
import { joinInline, unbreakable } from '@/ui/inlineText'

// «Por hacer hoy» (tasks design rev 2.1 §11.3): the to-dos due today or earlier (with or without a fixed time), which
// the week never places, with a last row that adds one for today in the same two actions as the Tasks box. A task with
// a length is in «Tu día» instead.
const props = defineProps<{ today: string }>()

const { t, locale } = useI18n()
const planner = usePlannerStore()
const actions = useTaskActions()
const adding = ref(false)
const capture = ref<InstanceType<typeof SmartCapture> | null>(null)
const editing = ref<string | undefined>()
const sheetOpen = ref(false)

const categories = computed(() => new Map((planner.document?.categories ?? []).map((category) => [category.id, category])))
const order = (task: Task) => [task.dueDate! < props.today ? 0 : 1, task.at ?? 24 * 60, task.dueDate!] as const
const tasks = computed(() => (planner.document?.tasks ?? [])
  .filter((task) => !task.doneAt && task.dueDate !== undefined && task.dueDate <= props.today && task.durationMin === undefined)
  .sort((a, b) => {
    const [lateA, atA, dueA] = order(a), [lateB, atB, dueB] = order(b)
    return lateA - lateB || dueA.localeCompare(dueB) || atA - atB || a.priority - b.priority
  }))

function subtitle(task: Task): string {
  const category = task.categoryId === undefined ? undefined : categories.value.get(task.categoryId)
  return joinInline([
    task.at !== undefined ? formatMinuteOfDay(task.at, displayLocale.value) : '',
    task.durationMin !== undefined ? formatDuration(task.durationMin) : '',
    category?.name ?? '',
    task.dueDate! < props.today ? unbreakable(t('tasks.overdueSince', { date: formatDate(task.dueDate!, locale.value, { day: 'numeric', month: 'short' }) })) : '',
  ])
}

function color(task: Task): string {
  const category = task.categoryId === undefined ? undefined : categories.value.get(task.categoryId)
  return category ? categoryColor(category) : 'var(--cat-gray)'
}

async function startAdding(): Promise<void> {
  adding.value = true
  await nextTick()
  capture.value?.focus()
}

function open(task: Task): void {
  editing.value = task.id
  sheetOpen.value = true
}
</script>

<template>
  <ListGroup :header="t('today.todo.title')" class="today-todo" data-testid="today-todo">
    <TaskRow
      v-for="task in tasks"
      :key="task.id"
      :title="task.title"
      :subtitle="subtitle(task)"
      :color="color(task)"
      :complete-label="t('tasks.complete', { title: task.title })"
      data-testid="today-todo-task"
      @complete="actions.complete(task)"
      @open="open(task)"
      @remove="actions.remove(task)"
    />
    <li v-if="!adding" class="add-row">
      <button type="button" class="add-button t-body" :disabled="!planner.writable" data-testid="today-todo-add" @click="startAdding">
        <Icon name="plus" :size="20" />
        <span>{{ t('today.todo.add') }}</span>
      </button>
    </li>
    <li v-else class="add-capture">
      <SmartCapture ref="capture" due-today :label="t('today.todo.add')" @added="adding = false" />
    </li>
  </ListGroup>
  <TaskSheet v-model:open="sheetOpen" :task-id="editing" />
</template>

<style scoped>
.today-todo { margin-inline: var(--page-gutter); }
.add-button {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--row-min-height);
  padding: var(--space-1) var(--card-padding);
  border: 0;
  background: transparent;
  color: var(--tint-label);
  font-weight: 600;
  text-align: start;
}
.today-todo :deep(.task-row) + .add-row .add-button::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: var(--card-padding);
  border-top: 1px solid var(--separator);
}
.add-button:focus-visible { outline-offset: -2px; }
.add-capture :deep(.add) { border-radius: 0; }
</style>
