<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayIndex, PlannerDocument, TimeBlock } from '@/core/model'
import Button from '@/ui/Button.vue'
import CategoryMark from '@/ui/CategoryMark.vue'
import Sheet from '@/ui/Sheet.vue'
import { validateBlockDraft, type BlockDraft, type DraftError } from './blockEditing'
import { formatDate, minuteToTimeValue, orderedDays, timeValueToMinute } from './localTime'

const props = defineProps<{ open: boolean; draft: BlockDraft; document: PlannerDocument; saveError?: string | null; saving?: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean]; save: [block: TimeBlock]; delete: [blockId: string] }>()

const { t, locale } = useI18n()
const fieldId = useId()
const title = ref('')
const categoryId = ref('')
const startValue = ref('')
const endValue = ref('')
const days = ref<DayIndex[]>([])
const titleTouched = ref(false)

watch(() => [props.open, props.draft] as const, ([open]) => {
  if (!open) return
  title.value = props.draft.title
  categoryId.value = props.draft.categoryId
  startValue.value = props.draft.start === null ? '' : minuteToTimeValue(props.draft.start)
  endValue.value = props.draft.end === null ? '' : minuteToTimeValue(props.draft.end)
  days.value = [...props.draft.days]
  titleTouched.value = false
}, { immediate: true })

// The routine is named after its category until it is given a name of its own ("Exercise" needs no second "Exercise").
const selectedCategory = computed(() => props.document.categories.find((category) => category.id === categoryId.value))
const rawDraft = computed<BlockDraft>(() => ({
  id: props.draft.id, title: title.value, categoryId: categoryId.value,
  start: timeValueToMinute(startValue.value), end: timeValueToMinute(endValue.value), days: days.value,
}))
const current = computed<BlockDraft>(() => ({ ...rawDraft.value, title: title.value.trim() || (selectedCategory.value?.name ?? '') }))
const validation = computed(() => validateBlockDraft(current.value, props.document))
const visibleErrors = computed(() => validation.value.errors.filter((error) => error.code !== 'titleRequired' || titleTouched.value))
const endsNextDay = computed(() => current.value.start !== null && current.value.end !== null && current.value.end < current.value.start)
const dirty = computed(() => JSON.stringify(rawDraft.value) !== JSON.stringify(props.draft))
const isEditing = computed(() => props.draft.id !== undefined)

// 2026-10-25 is a Sunday; it only provides localized weekday names.
const weekdayOptions = computed(() => orderedDays(props.document.settings.weekStartsOn).map((day) => ({
  day,
  short: formatDate(`2026-10-${25 + day}`, locale.value, { weekday: 'short' }),
  long: formatDate(`2026-10-${25 + day}`, locale.value, { weekday: 'long' }),
})))

// Arrow keys move the choice along the chips, as in any radio group.
function moveCategory(step: number, event: KeyboardEvent): void {
  const list = props.document.categories
  const at = list.findIndex((category) => category.id === categoryId.value)
  const next = list[(at + step + list.length) % list.length]
  if (!next) return
  categoryId.value = next.id
  const chips = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role=radio]')
  chips?.[list.indexOf(next)]?.focus()
}

function toggleDay(day: DayIndex): void {
  days.value = days.value.includes(day) ? days.value.filter((item) => item !== day) : [...days.value, day]
}

function errorMessage(error: DraftError): string {
  return error.code === 'overlap' ? t('week.editor.errors.overlap', { title: error.blockTitle }) : t(`week.editor.errors.${error.code}`)
}

function hours(minutes: number): string {
  return t('week.editor.hours', { hours: Math.round((minutes / 60) * 10) / 10 })
}

function submit(): void {
  titleTouched.value = true
  if (props.saving) return
  if (validation.value.block) emit('save', validation.value.block)
}
</script>

<template>
  <Sheet :open="open" :title="isEditing ? t('week.editor.editTitle') : t('week.editor.newTitle')" :dirty="dirty" no-dismiss @update:open="emit('update:open', $event)">
    <form class="editor" novalidate @submit.prevent="submit">
      <label class="field" :for="`${fieldId}-title`">
        <span class="t-footnote field-label">{{ t('week.editor.title') }}</span>
        <input
          :id="`${fieldId}-title`"
          v-model="title"
          class="input control"
          type="text"
          maxlength="120"
          autocomplete="off"
          :placeholder="selectedCategory?.name ?? t('week.editor.titlePlaceholder')"
          :aria-invalid="visibleErrors.some((error) => error.code === 'titleRequired') || undefined"
          @blur="titleTouched = true"
          @input="titleTouched = true"
        >
      </label>
      <div class="field" role="radiogroup" :aria-label="t('week.editor.category')">
        <span class="t-footnote field-label" aria-hidden="true">{{ t('week.editor.category') }}</span>
        <div class="chips">
          <button
            v-for="category in document.categories"
            :key="category.id"
            type="button"
            role="radio"
            class="chip t-subhead"
            :aria-checked="category.id === categoryId"
            :tabindex="category.id === categoryId ? 0 : -1"
            :data-category-id="category.id"
            @click="categoryId = category.id"
            @keydown.right.prevent="moveCategory(1, $event)"
            @keydown.down.prevent="moveCategory(1, $event)"
            @keydown.left.prevent="moveCategory(-1, $event)"
            @keydown.up.prevent="moveCategory(-1, $event)"
          >
            <CategoryMark :category="category" with-name />
          </button>
        </div>
      </div>
      <div class="times">
        <label class="field" :for="`${fieldId}-start`">
          <span class="t-footnote field-label">{{ t('week.editor.start') }}</span>
          <input :id="`${fieldId}-start`" v-model="startValue" class="input control time" type="time" step="300" required>
        </label>
        <label class="field" :for="`${fieldId}-end`">
          <span class="t-footnote field-label">
            {{ t('week.editor.end') }}
            <span v-if="endsNextDay" class="next-day" data-testid="next-day">{{ t('week.editor.nextDay') }}</span>
          </span>
          <input :id="`${fieldId}-end`" v-model="endValue" class="input control time" type="time" step="300" required>
        </label>
      </div>
      <fieldset class="field days">
        <legend class="t-footnote field-label">{{ t('week.editor.days') }}</legend>
        <div class="day-toggles">
          <button
            v-for="option in weekdayOptions"
            :key="option.day"
            type="button"
            class="day-toggle t-subhead"
            :aria-pressed="days.includes(option.day)"
            :aria-label="option.long"
            @click="toggleDay(option.day)"
          >
            {{ option.short }}
          </button>
        </div>
      </fieldset>

      <div class="messages" aria-live="polite">
        <p v-for="error in visibleErrors" :key="error.code" class="message is-error t-footnote" data-testid="editor-error">{{ errorMessage(error) }}</p>
        <p v-for="warning in validation.warnings" :key="warning.code" class="message is-warning t-footnote" data-testid="editor-warning">
          {{ t('week.editor.warnings.goalOver', { category: warning.categoryName, hours: hours(warning.minutes) }) }}
        </p>
        <p v-if="saveError" class="message is-error t-footnote">{{ t('week.editor.errors.saveFailed', { reason: saveError }) }}</p>
      </div>

      <div class="actions">
        <Button type="submit" block :disabled="!validation.block || saving">{{ t('week.editor.save') }}</Button>
        <Button v-if="isEditing" variant="plain" destructive block @click="emit('delete', draft.id!)">{{ t('week.editor.delete') }}</Button>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; gap: var(--space-4); }
.field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; margin: 0; padding: 0; border: 0; }
.field-label { display: flex; align-items: center; gap: var(--space-2); color: var(--label-2); }
.control { width: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 1.5px solid transparent;
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--label);
}
.chip[aria-checked='true'] { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 12%, var(--surface)); font-weight: 600; }
.control[aria-invalid] { border-color: var(--danger); }
.time { font-variant-numeric: tabular-nums; }
.times { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.next-day {
  padding: 0 var(--space-2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--tint) 14%, transparent);
  color: var(--tint-label);
  font-weight: 600;
}
/* The seven days are one compound control, joined on a track like the segmented control, so they keep their width on
   a narrow phone instead of crowding as separate buttons. */
.day-toggles {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--label-2) 14%, transparent);
}
.day-toggle {
  min-height: var(--tap-target);
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--label);
  font-weight: 500;
  transition: background-color 0.1s;
}
.day-toggle:focus-visible { outline-offset: 0; }
.day-toggle[aria-pressed='true'] { background: var(--tint); color: var(--tint-text); font-weight: 600; }
.messages { display: flex; flex-direction: column; gap: var(--space-1); min-height: 1.2rem; }
.message { margin: 0; }
.is-error { color: var(--danger-label); }
.is-warning { color: var(--label); }
.is-warning::before { content: '⚠︎ '; color: var(--warning); }
.actions { display: flex; flex-direction: column; gap: var(--space-2); }
</style>
