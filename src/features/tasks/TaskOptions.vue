<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { localDateOf } from '@/core/time'
import { useNow } from '@/features/week/useNow'
import { useI18n } from 'vue-i18n'
import type { Category } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import ToggleRow from '@/ui/ToggleRow.vue'
import { noteLinks } from './noteLinks'
import { formatDuration } from '@/ui/format'
import {
  ANY_FREE_TIME, DURATION_CHIPS, draftProblem, hasExtraOptions, MAX_FIXED_MIN, MAX_TASK_MIN, MIN_TASK_MIN, plannerToday, UNTIMED,
  whenCategories, type TaskDraft, type TaskPriority,
} from './taskDraft'

// What a task asks beyond its title (R_HojaTarea): its length as chips in one tap ("Sin tiempo", the default, makes it
// a to-do; "Otra" opens a minutes field), then "¿Cuándo?" as one group: "Durante" picks the category it is placed in
// (any free time by default; the category of the previous task is offered first) and "Hoy" is a switch. One level
// deeper, under "Más opciones": a due date, a fixed start, a priority and notes. A task with none of those set is a
// to-do with no date, and is still complete.
// `timeZone` is the planner's ("Hoy" is resolved in it when switched on); `suggestedCategoryId` is the category the
// previous task was filed under.
const props = defineProps<{ draft: TaskDraft; categories: Category[]; timeZone: string; suggestedCategoryId?: string }>()
// Changes travel as patches the owner merges into its current draft, so two edits in the same tick never undo each other.
const emit = defineEmits<{ patch: [change: Partial<TaskDraft>] }>()

const { t } = useI18n()
// Opens by itself when the task already carries a choice, so nothing set earlier is hidden.
const moreOpen = ref(hasExtraOptions(props.draft))

const ids = { length: useId(), other: useId(), when: useId(), whenList: useId(), more: useId() }
const STANDARD = DURATION_CHIPS as readonly number[]
// "Otra" is chosen when the person picked it, or when the task's length is not one of the chips (45 min shows there).
const otherPicked = ref(props.draft.durationMin !== undefined && !STANDARD.includes(props.draft.durationMin))
const lengthValue = computed(() => (otherPicked.value ? 'other' : props.draft.durationMin === undefined ? UNTIMED : String(props.draft.durationMin)))
const lengthOptions = computed(() => [
  { value: UNTIMED, label: t('tasks.add.untimed') },
  ...STANDARD.map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) })),
  { value: 'other', label: t('tasks.add.otherLength') },
])
const maxMinutes = computed(() => (props.draft.at !== '' ? MAX_FIXED_MIN : MAX_TASK_MIN))
const problem = computed(() => draftProblem(props.draft))
const problemId = useId()
const links = computed(() => noteLinks(props.draft.notes))

function setLength(value: string): void {
  otherPicked.value = value === 'other'
  if (value !== 'other') update({ durationMin: value === UNTIMED ? undefined : Number(value) })
}

// "Another length": any whole number of minutes in range, rounded to five; empty is a to-do.
function setOtherDuration(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '') return update({ durationMin: undefined })
  const minutes = Math.round(Number(raw) / 5) * 5
  if (Number.isFinite(minutes)) update({ durationMin: Math.min(MAX_TASK_MIN, Math.max(MIN_TASK_MIN, minutes)) })
}
// The previous task's category comes first after "any free time": one pick away, never applied by itself.
const whenOptions = computed(() => {
  const offered = whenCategories(props.categories, props.draft.categoryId)
  const suggested = offered.find((category) => category.id === props.suggestedCategoryId)
  return suggested ? [suggested, ...offered.filter((category) => category !== suggested)] : offered
})
const chosenCategory = computed(() => props.categories.find((category) => category.id === props.draft.categoryId))
const whenOpen = ref(false)
const whenChoices = computed(() => [
  { id: ANY_FREE_TIME, name: t('tasks.add.anyFreeTime'), color: '' },
  ...whenOptions.value.map((category) => ({ id: category.id, name: category.name, color: categoryColor(category) })),
])
function pickWhen(id: string): void {
  update({ categoryId: id })
  whenOpen.value = false
}
const priorityOptions = computed(() => (['1', '2', '3'] as const).map((value) => ({ value, label: t(`tasks.priority.${value}`) })))

const update = (change: Partial<TaskDraft>): void => emit('patch', change)

// "Today" makes the task due today; a second tap gives back the due date it had before. Both the chip and the date
// follow the clock: a form left open across midnight shows, and saves, the new day (taskFields).
const now = useNow()
const today = computed(() => localDateOf(now.value, props.timeZone))
const todayPressed = computed(() => props.draft.dueToday || props.draft.dueDate === today.value)
watch(today, (date) => { if (props.draft.dueToday && props.draft.dueDate !== date) update({ dueDate: date }) })
let dueBeforeToday = ''
function setToday(on: boolean): void {
  if (!on) return update({ dueDate: dueBeforeToday, dueToday: false })
  dueBeforeToday = props.draft.dueDate
  update({ dueDate: plannerToday(props.timeZone), dueToday: true })
}
</script>

<template>
  <div class="task-options">
    <section class="option-group" :aria-labelledby="ids.length">
      <h3 :id="ids.length" class="group-label">{{ t('tasks.add.duration') }}</h3>
      <div class="lengths" role="radiogroup" :aria-labelledby="ids.length" data-testid="task-length">
        <label v-for="option in lengthOptions" :key="option.value" class="length t-subhead" :class="{ 'is-on': lengthValue === option.value }">
          <input class="length-input" type="radio" :name="ids.length" :value="option.value" :checked="lengthValue === option.value" @change="setLength(option.value)">
          {{ option.label }}
        </label>
      </div>
      <label v-if="otherPicked" class="field other" :for="ids.other">
        <span class="t-footnote t-secondary">{{ t('tasks.add.otherDuration') }}</span>
        <input
          :id="ids.other"
          :value="draft.durationMin ?? ''"
          class="input"
          type="number"
          inputmode="numeric"
          :min="MIN_TASK_MIN"
          :max="maxMinutes"
          step="5"
          :placeholder="t('tasks.add.minutesPlaceholder')"
          data-testid="task-other-duration"
          :aria-describedby="problem ? problemId : undefined"
          @change="setOtherDuration"
        >
      </label>
      <p v-if="problem" :id="problemId" class="t-footnote problem" role="alert">{{ t('tasks.add.fixedTooLong', { hours: MAX_FIXED_MIN / 60 }) }}</p>
    </section>

    <section class="option-group" :aria-labelledby="ids.when">
      <h3 :id="ids.when" class="group-label">{{ t('tasks.add.when') }}</h3>
      <ul class="when">
        <li>
          <!-- "Durante": the row says the choice; it opens the choices in place, whose names wrap at any text size. -->
          <button type="button" class="when-row" :aria-expanded="whenOpen" :aria-controls="ids.whenList" data-testid="task-when-toggle" @click="whenOpen = !whenOpen">
            <span class="t-body when-label">{{ t('tasks.add.category') }}</span>
            <span class="when-value t-body">
              <span v-if="chosenCategory" class="dot" :style="{ background: categoryColor(chosenCategory) }" aria-hidden="true" />
              <span class="when-name" data-testid="task-when-value">{{ chosenCategory?.name ?? t('tasks.add.anyFreeTime') }}</span>
              <Icon :name="whenOpen ? 'chevron-up' : 'chevron-down'" :size="16" class="when-chevron" />
            </span>
          </button>
          <div v-show="whenOpen" :id="ids.whenList" class="when-options" role="radiogroup" :aria-label="t('tasks.add.category')" data-testid="task-when">
            <label v-for="option in whenChoices" :key="option.id" class="when-option t-body" :data-value="option.id">
              <input class="when-input" type="radio" :name="ids.whenList" :value="option.id" :checked="draft.categoryId === option.id" @change="pickWhen(option.id)">
              <span v-if="option.color" class="dot" :style="{ background: option.color }" aria-hidden="true" />
              <span class="when-name">{{ option.name }}</span>
              <Icon v-if="draft.categoryId === option.id" name="check" :size="18" class="when-check" />
            </label>
          </div>
        </li>
        <ToggleRow :model-value="todayPressed" :label="t('tasks.add.today')" test-id="task-today" @update:model-value="setToday" />
      </ul>
    </section>

    <div>
      <button type="button" class="more t-subhead" :aria-expanded="moreOpen" :aria-controls="ids.more" data-testid="task-more" @click="moreOpen = !moreOpen">
        {{ t('tasks.add.more') }}
        <Icon :name="moreOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <p v-if="!moreOpen" class="t-footnote t-secondary">{{ t('tasks.add.moreHint') }}</p>
    </div>
    <div v-show="moreOpen" :id="ids.more" class="more-options" data-testid="task-more-options">
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.dueDate') }}</span>
        <input :value="draft.dueDate" class="input" type="date" data-testid="task-due" @input="update({ dueDate: ($event.target as HTMLInputElement).value, dueToday: false })">
      </label>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.at') }}</span>
        <input :value="draft.at" class="input" type="time" step="300" data-testid="task-at" :aria-describedby="problem ? problemId : undefined" @input="update({ at: ($event.target as HTMLInputElement).value })">
      </label>
      <div class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.priority') }}</span>
        <SegmentedControl :model-value="draft.priority" :options="priorityOptions" :label="t('tasks.add.priority')" @update:model-value="update({ priority: $event as TaskPriority })" />
      </div>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('tasks.add.notes') }}</span>
        <textarea :value="draft.notes" class="input notes" maxlength="2000" rows="3" data-testid="task-notes" @input="update({ notes: ($event.target as HTMLTextAreaElement).value })" />
      </label>
      <ul v-if="links.length" class="links" :aria-label="t('tasks.add.links')" data-testid="task-note-links">
        <li v-for="link in links" :key="link"><a :href="link" target="_blank" rel="noopener noreferrer" class="t-subhead">{{ link }}</a></li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.task-options { display: flex; flex-direction: column; gap: var(--space-5); }
.option-group { display: flex; flex-direction: column; gap: var(--space-2); }
.group-label { margin: 0; color: var(--label-2); font-size: 0.8125rem; font-weight: 600; }
.lengths { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.length {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border-radius: 999px;
  background: var(--fill);
  color: var(--label);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.length.is-on { background: var(--tint); color: var(--tint-text); }
.length:has(:focus-visible) { outline: 2px solid var(--tint-label); outline-offset: 2px; }
.length-input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.when { margin: 0; padding: 0; list-style: none; border-radius: var(--radius-card); background: var(--surface); overflow: hidden; }
.when > li + li { border-top: 0.5px solid var(--separator); }
.when-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 var(--space-3); width: 100%; min-height: max(var(--tap-target), var(--row-min-height)); padding: var(--row-padding-block) var(--card-padding); border: 0; background: transparent; color: var(--label); text-align: start; }
.when-row:focus-visible { outline-offset: -2px; }
/* The value takes the rest of the line and moves under the label when the text is large. */
.when-value { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; margin-inline-start: auto; color: var(--label-2); }
.when-name { min-width: 0; overflow-wrap: break-word; }
.when-chevron { flex: none; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.when-options { display: flex; flex-direction: column; border-top: 0.5px solid var(--separator); }
.when-option { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap-target); padding: var(--space-2) var(--card-padding) var(--space-2) calc(var(--card-padding) + var(--space-3)); cursor: pointer; }
.when-option:has(:focus-visible) { outline: 2px solid var(--tint-label); outline-offset: -2px; }
.when-input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.when-check { flex: none; margin-inline-start: auto; color: var(--tint-label); }
.more {
  display: inline-flex;
  align-items: center;
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
.notes { min-height: calc(var(--tap-target) * 2); resize: vertical; }
.problem { color: var(--danger); }
.links { display: flex; flex-direction: column; gap: var(--space-1); }
.links a { display: inline-flex; align-items: center; min-height: var(--tap-target); color: var(--tint-label); overflow-wrap: anywhere; }
@media (forced-colors: active) {
  .length.is-on { border: 2px solid Highlight; }
}
</style>
