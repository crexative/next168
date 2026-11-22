<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import { useTaskActions } from '@/features/tasks/taskActions'
import TaskRow from '@/features/tasks/TaskRow.vue'
import TaskSheet from '@/features/tasks/TaskSheet.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import { displayLocale, formatDate, formatDuration, formatMinuteOfDay } from '@/ui/format'
import { joinInline, unbreakable } from '@/ui/inlineText'

// «Por hacer hoy» (tasks design rev 2.1 §11.3, redesign R_Hoy): the to-dos due today or earlier (with or without a
// fixed time), which the week never places. Adding one for today is the shell's "+" › Tarea with "Hoy" on (one place to
// add, DIRECTION principle 4). A task with a length is in «Tu día» instead.
const props = defineProps<{ today: string }>()

const { t, locale } = useI18n()
const planner = usePlannerStore()
const actions = useTaskActions()
const headingId = useId()
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
  // Grey is Desplazamiento's colour: a task with no category draws in the secondary label instead (REVIEW M15).
  return category ? categoryColor(category) : 'var(--label-2)'
}

function open(task: Task): void {
  editing.value = task.id
  sheetOpen.value = true
}
</script>

<template>
  <section v-if="tasks.length" class="today-todo" :aria-labelledby="headingId" data-testid="today-todo">
    <h3 :id="headingId" class="todo-title t-footnote">{{ t('today.todo.title') }}</h3>
    <ul class="todo-list">
      <TaskRow
        v-for="task in tasks"
        :key="task.id"
        variant="timeline"
        :title="task.title"
        :subtitle="subtitle(task)"
        :color="color(task)"
        :complete-label="t('tasks.complete', { title: task.title })"
        data-testid="today-todo-task"
        @complete="actions.complete(task)"
        @open="open(task)"
        @remove="actions.remove(task)"
      />
    </ul>
  </section>
  <TaskSheet v-model:open="sheetOpen" :task-id="editing" />
</template>

<style scoped>
/* «Por hacer hoy» closes the day's list: a quiet group title inset to the rows' text. */
.today-todo { margin-top: var(--group-gap); }
.todo-title { margin: 0 var(--page-gutter) var(--space-1) calc(var(--page-gutter) + 56px + 4px + 2 * var(--space-3)); color: var(--label-2); font-weight: 600; }
.todo-list { margin: 0; padding: 0; list-style: none; }
</style>
