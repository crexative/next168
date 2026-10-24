<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { formatDuration } from '@/ui/format'
import { durationChoices, hasExtraOptions, whenCategories, type TaskDraft, type TaskPriority } from './taskDraft'

// What a task asks beyond its title: a length in one tap, and - one level deeper, under "More options" - when it may
// go, a due date and a priority. A task with none of those set is filed under "any free time" and is still complete.
const props = defineProps<{ draft: TaskDraft; categories: Category[] }>()
// Changes travel as patches the owner merges into its current draft, so two edits in the same tick never undo each other.
const emit = defineEmits<{ patch: [change: Partial<TaskDraft>] }>()

const { t } = useI18n()
const moreId = useId()
// Opens by itself when the task already carries a choice, so nothing set earlier is hidden.
const moreOpen = ref(hasExtraOptions(props.draft))

const durationOptions = computed(() => durationChoices(props.draft.durationMin).map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) })))
const whenOptions = computed(() => whenCategories(props.categories, props.draft.categoryId))
const priorityOptions = computed(() => (['1', '2', '3'] as const).map((value) => ({ value, label: t(`tasks.priority.${value}`) })))

const update = (change: Partial<TaskDraft>): void => emit('patch', change)
</script>

<template>
  <div class="task-options">
    <SegmentedControl
      :model-value="String(draft.durationMin)"
      :options="durationOptions"
      :label="t('tasks.add.duration')"
      @update:model-value="update({ durationMin: Number($event) })"
    />
    <button type="button" class="more t-subhead" :aria-expanded="moreOpen" :aria-controls="moreId" data-testid="task-more" @click="moreOpen = !moreOpen">
      {{ t('tasks.add.more') }}
      <Icon :name="moreOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
    </button>
    <div v-show="moreOpen" :id="moreId" class="more-options" data-testid="task-more-options">
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.when') }}</span>
        <select :value="draft.categoryId" class="input" data-testid="task-when" @change="update({ categoryId: ($event.target as HTMLSelectElement).value })">
          <option value="">{{ t('tasks.add.anyFreeTime') }}</option>
          <option v-for="category in whenOptions" :key="category.id" :value="category.id">{{ t('tasks.add.during', { category: category.name }) }}</option>
        </select>
      </label>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.dueDate') }}</span>
        <input :value="draft.dueDate" class="input" type="date" data-testid="task-due" @input="update({ dueDate: ($event.target as HTMLInputElement).value })">
      </label>
      <div class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.priority') }}</span>
        <SegmentedControl :model-value="draft.priority" :options="priorityOptions" :label="t('tasks.add.priority')" @update:model-value="update({ priority: $event as TaskPriority })" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-options { display: flex; flex-direction: column; gap: var(--space-3); }
.more {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-1);
  min-height: var(--tap-target);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tint-label);
  font-weight: 600;
}
.more-options { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
</style>
