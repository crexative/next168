<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { localDateOf } from '@/core/time'
import { useNow } from '@/features/week/useNow'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { formatDuration } from '@/ui/format'
import { ANY_FREE_TIME, durationChoices, hasExtraOptions, plannerToday, resolveWhen, whenCategories, type TaskDraft, type TaskPriority } from './taskDraft'

// What a task asks beyond its title: a length in one tap, "Today" in one tap, the last category chosen as a one-tap
// suggestion (never applied by itself), and - one level deeper, under "More options" - when it may go, a due date and
// a priority. A task with none of those set is filed under "any free time" and is still complete.
// `timeZone` is the planner's ("Today" is resolved in it when tapped); `suggestedCategoryId` is the category the previous
// task was filed under.
const props = defineProps<{ draft: TaskDraft; categories: Category[]; timeZone: string; suggestedCategoryId?: string }>()
// Changes travel as patches the owner merges into its current draft, so two edits in the same tick never undo each other.
const emit = defineEmits<{ patch: [change: Partial<TaskDraft>] }>()

const { t } = useI18n()
const moreId = useId()
// Opens by itself when the task already carries a choice, so nothing set earlier is hidden.
const moreOpen = ref(hasExtraOptions(props.draft))

const durationOptions = computed(() => durationChoices(props.draft.durationMin).map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) })))
const whenOptions = computed(() => whenCategories(props.categories, props.draft.categoryId))
const suggestion = computed(() => {
  const id = resolveWhen(props.categories, props.suggestedCategoryId ?? ANY_FREE_TIME)
  const category = props.categories.find((candidate) => candidate.id === id)
  return category && (props.draft.categoryId === ANY_FREE_TIME || props.draft.categoryId === id) ? category : undefined
})
const priorityOptions = computed(() => (['1', '2', '3'] as const).map((value) => ({ value, label: t(`tasks.priority.${value}`) })))

const update = (change: Partial<TaskDraft>): void => emit('patch', change)

// "Today" makes the task due today; a second tap gives back the due date it had before. Both the chip and the date
// follow the clock: a form left open across midnight shows, and saves, the new day (taskFields).
const now = useNow()
const today = computed(() => localDateOf(now.value, props.timeZone))
const todayPressed = computed(() => props.draft.dueToday || props.draft.dueDate === today.value)
watch(today, (date) => { if (props.draft.dueToday && props.draft.dueDate !== date) update({ dueDate: date }) })
let dueBeforeToday = ''
function toggleToday(): void {
  const date = plannerToday(props.timeZone)
  if (props.draft.dueToday || props.draft.dueDate === date) return update({ dueDate: dueBeforeToday, dueToday: false })
  dueBeforeToday = props.draft.dueDate
  update({ dueDate: date, dueToday: true })
}

function toggleSuggestion(id: string): void {
  update({ categoryId: props.draft.categoryId === id ? ANY_FREE_TIME : id })
}
</script>

<template>
  <div class="task-options">
    <SegmentedControl
      :model-value="String(draft.durationMin)"
      :options="durationOptions"
      :label="t('tasks.add.duration')"
      @update:model-value="update({ durationMin: Number($event) })"
    />
    <div class="choices">
      <button type="button" class="choice t-subhead" :aria-pressed="todayPressed" data-testid="task-today" @click="toggleToday">
        <Icon name="sun" :size="16" />{{ t('tasks.add.today') }}
      </button>
      <button
        v-if="suggestion"
        type="button"
        class="choice t-subhead"
        :aria-pressed="draft.categoryId === suggestion.id"
        data-testid="task-suggested-category"
        @click="toggleSuggestion(suggestion.id)"
      >
        {{ t('tasks.add.during', { category: suggestion.name }) }}
      </button>
    </div>
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
        <input :value="draft.dueDate" class="input" type="date" data-testid="task-due" @input="update({ dueDate: ($event.target as HTMLInputElement).value, dueToday: false })">
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
.choices { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.choice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--tap-target);
  max-width: 100%;
  padding: 0 var(--space-3);
  border: 1px solid var(--separator);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--label);
  font-weight: 600;
  text-align: start;
}
.choice[aria-pressed='true'] { border-color: transparent; background: var(--tint); color: var(--tint-text); }
.more-options { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
</style>
