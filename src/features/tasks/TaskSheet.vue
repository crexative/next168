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
import { draftFromTask, newDraft, resolveWhen, taskFields, type TaskDraft } from './taskDraft'
import TaskOptions from './TaskOptions.vue'

// One sheet to add a task ("+" in Week) and to edit one (a tap on its row or on the grid). Delete is a plain text
// action at the foot, with the same undo toast as a swipe.
const props = defineProps<{ open: boolean; taskId?: string }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const { t } = useI18n()
const planner = usePlannerStore()
const actions = useTaskActions()
const fieldId = useId()

const draft = ref<TaskDraft>(newDraft())
const initial = ref('')
const saving = ref(false)
const changedElsewhere = ref(false)
// Bumped on every open so the options start collapsed or open for the task shown now, not the previous one.
const generation = ref(0)
// What this form was loaded from; a save is refused when the stored entries are no longer these.
let bound: { workspaceId: string; task: string | undefined; category: string | undefined } = { workspaceId: '', task: undefined, category: undefined }

const stored = computed(() => planner.document?.tasks.find((candidate) => candidate.id === props.taskId))
const isEditing = computed(() => props.taskId !== undefined)
const categories = computed(() => planner.document?.categories ?? [])
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value)
const canSave = computed(() => planner.writable && draft.value.title.trim().length > 0 && !saving.value)

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
  draft.value = stored.value ? draftFromTask(stored.value) : newDraft(resolveWhen(document.categories, readLastTaskCategory()))
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
  const fields = taskFields(draft.value)
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
      const { categoryId, dueDate, ...rest } = fields
      Object.assign(target, rest)
      if (categoryId === undefined) delete target.categoryId
      else target.categoryId = categoryId
      if (dueDate === undefined) delete target.dueDate
      else target.dueDate = dueDate
    })
    if (result.ok) {
      rememberTaskCategory(fields.categoryId ?? '')
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
  <Sheet :open="open" :title="t(isEditing ? 'tasks.sheet.edit' : 'tasks.sheet.new')" :dirty="dirty" no-dismiss @update:open="emit('update:open', $event)">
    <form class="task-form" novalidate :aria-label="t(isEditing ? 'tasks.sheet.edit' : 'tasks.sheet.new')" @submit.prevent="save">
      <label class="field" :for="`${fieldId}-title`">
        <span class="t-footnote t-secondary">{{ t('tasks.add.titleLabel') }}</span>
        <input :id="`${fieldId}-title`" v-model="draft.title" class="input" type="text" maxlength="120" autocomplete="off" :placeholder="t('tasks.add.titlePlaceholder')" data-testid="task-title">
      </label>
      <TaskOptions :key="generation" :draft="draft" :categories="categories" @patch="draft = { ...draft, ...$event }" />
      <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('tasks.changedElsewhere') }}</p>
      <div class="actions">
        <Button type="submit" block :disabled="!canSave">{{ t(isEditing ? 'common.save' : 'tasks.add.submit') }}</Button>
        <Button v-if="isEditing" variant="plain" destructive block :disabled="saving" data-testid="task-delete" @click="remove">{{ t('tasks.sheet.delete') }}</Button>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.task-form { display: flex; flex-direction: column; gap: var(--space-4); }
.field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.actions { display: flex; flex-direction: column; gap: var(--space-2); }
</style>
