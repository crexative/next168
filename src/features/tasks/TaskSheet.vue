<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Task } from '@/core/model'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Sheet from '@/ui/Sheet.vue'
import { readLastTaskCategory, rememberTaskCategory } from './lastCategory'
import { useTaskActions } from './taskActions'
import { draftFromTask, draftProblem, newDraft, plannerToday, taskFields, type TaskDraft } from './taskDraft'
import SmartCapture from './SmartCapture.vue'
import TaskOptions from './TaskOptions.vue'

// One sheet to add a task ("+" › Tarea, "+" on Tareas) and to edit one (a tap on its row or on the grid), drawn as
// R_HojaTarea: "Cancelar", the title and the sheet's action ("Añadir", "Guardar") in the header, above the keyboard.
// A new task is the capture (SmartCapture): it reads dates, times and lengths typed in its title, and a paste or
// dictation of several lines adds one task per line. Delete is a plain text action at the foot of an edit, with the
// same undo toast as a swipe.
// `dueToday` starts a new task with "Hoy" on: the "+" pressed on Hoy adds for today, as its old inline row did.
const props = defineProps<{ open: boolean; taskId?: string; dueToday?: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const { t } = useI18n()
const planner = usePlannerStore()
const actions = useTaskActions()
const fieldId = useId()
const formId = useId()
const capture = ref<InstanceType<typeof SmartCapture> | null>(null)

const draft = ref<TaskDraft>(newDraft())
const initial = ref('')
const saving = ref(false)
const changedElsewhere = ref(false)
// Bumped on every open so the options start collapsed or open for the task shown now, not the previous one.
const generation = ref(0)
// The category of the last task added, offered as a suggestion.
const suggestedCategoryId = ref('')
const timeZone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
// What this form was loaded from; a save is refused when the stored entries are no longer these.
let bound: { workspaceId: string; task: string | undefined; category: string | undefined } = { workspaceId: '', task: undefined, category: undefined }

const stored = computed(() => planner.document?.tasks.find((candidate) => candidate.id === props.taskId))
const isEditing = computed(() => props.taskId !== undefined)
const categories = computed(() => planner.document?.categories ?? [])
const dirty = computed(() => (isEditing.value ? JSON.stringify(draft.value) !== initial.value : !!capture.value?.dirty))
const canSave = computed(() => planner.writable && draft.value.title.trim().length > 0 && !saving.value && !draftProblem(draft.value))

function categorySnapshot(categoryId: string): string | undefined {
  return categoryId === '' ? undefined : snapshotOf(categories.value.find((category) => category.id === categoryId))
}

watch(() => props.open, (open) => {
  if (!open) return
  const document = planner.document
  if (!document || (isEditing.value && !stored.value)) {
    emit('update:open', false)
    return
  }
  // A new task fits any free slot unless the person picks a category; the last one chosen is only a suggestion.
  draft.value = stored.value ? draftFromTask(stored.value) : { ...newDraft(), dueToday: !!props.dueToday }
  suggestedCategoryId.value = readLastTaskCategory()
  initial.value = JSON.stringify(draft.value)
  changedElsewhere.value = false
  generation.value += 1
  bound = { workspaceId: document.workspaceId, task: snapshotOf(stored.value), category: categorySnapshot(draft.value.categoryId) }
}, { immediate: true })

// The category the form files the task under is part of what it was loaded from: the snapshot follows the choice
// shown, so picking another category is fine while a category replaced under the form is refused at save.
watch(() => draft.value.categoryId, (id) => { bound.category = categorySnapshot(id) }, { flush: 'sync' })

// Another workspace under an open sheet: what it shows no longer exists, so it closes instead of writing there.
watch(() => planner.document?.workspaceId, (id) => { if (props.open && id !== bound.workspaceId) emit('update:open', false) })

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  changedElsewhere.value = false
  const { workspaceId, task: taskSnapshot, category: categoryBound } = bound
  const fields = taskFields(draft.value, plannerToday(timeZone.value))
  const created: Task = { ...fields, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  try {
    const result = await planner.commit((next) => {
      if (next.workspaceId !== workspaceId) throw new Error(CHANGED_ELSEWHERE)
      if (fields.categoryId !== undefined) assertEntry(next.categories.find((category) => category.id === fields.categoryId), categoryBound)
      if (!props.taskId) {
        next.tasks.push(created)
        return
      }
      const target = next.tasks.find((candidate) => candidate.id === props.taskId)
      assertEntry(target, taskSnapshot)
      if (!target) return
      target.title = fields.title
      target.priority = fields.priority
      // An optional field the form left empty is cleared on the stored task.
      for (const key of ['categoryId', 'dueDate', 'durationMin', 'at', 'notes'] as const) {
        if (fields[key] === undefined) delete target[key]
        else Object.assign(target, { [key]: fields[key] })
      }
    })
    if (result.ok) {
      if (fields.categoryId !== undefined) rememberTaskCategory(fields.categoryId)
      emit('update:open', false)
    } else if (result.reason === CHANGED_ELSEWHERE) {
      planner.dismissError()
      changedElsewhere.value = true
    }
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  const task = stored.value
  if (!task || saving.value) return
  saving.value = true
  try {
    if (await actions.remove(task)) emit('update:open', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Sheet :open="open" :title="t(isEditing ? 'tasks.sheet.edit' : 'tasks.sheet.new')" :dirty="dirty" grouped @update:open="emit('update:open', $event)">
    <template #action>
      <button v-if="isEditing" type="submit" :form="formId" :disabled="!canSave" data-testid="task-save">{{ t('common.save') }}</button>
      <button v-else type="submit" :form="formId" :disabled="!capture?.canSubmit" data-testid="task-add">{{ t('tasks.sheet.add') }}</button>
    </template>
    <SmartCapture v-if="!isEditing" ref="capture" :form-id="formId" :due-today="dueToday" :label="t('tasks.sheet.new')" @added="emit('update:open', false)" />
    <form v-else :id="formId" class="task-form" novalidate :aria-label="t('tasks.sheet.edit')" @submit.prevent="save">
      <label class="field" :for="`${fieldId}-title`">
        <span class="visually-hidden">{{ t('tasks.add.titleLabel') }}</span>
        <input :id="`${fieldId}-title`" v-model="draft.title" class="input title" type="text" maxlength="120" autocomplete="off" :placeholder="t('tasks.add.titleLabel')" data-testid="task-title">
      </label>
      <TaskOptions :key="generation" :draft="draft" :categories="categories" :time-zone="timeZone" :suggested-category-id="suggestedCategoryId" @patch="draft = { ...draft, ...$event }" />
      <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('tasks.changedElsewhere') }}</p>
      <Button variant="plain" destructive block :disabled="saving" data-testid="task-delete" @click="remove">{{ t('tasks.sheet.delete') }}</Button>
    </form>
  </Sheet>
</template>

<style scoped>
.task-form { display: flex; flex-direction: column; gap: var(--space-4); }
.field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.title { border-color: transparent; border-radius: var(--radius-card); background: var(--surface); padding-inline: var(--card-padding); font-size: 1.375rem; font-weight: 600; }
</style>
