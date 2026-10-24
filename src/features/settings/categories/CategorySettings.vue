<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { COLOR_KEYS, type Category, type ColorKey, type Goal, type PlannerDocument } from '@/core/model'
import { categoryColor, categorySharingColor, firstUnusedColorKey } from '@/features/insights/categoryColor'
import { formatHours } from '@/ui/format'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import Sheet from '@/ui/Sheet.vue'
import { useUndoToast } from '@/ui/undoToast'
import {
  categoryUsage, formFromCategory, goalFromForm, removeCategory, restoreCategory, usageSummary, validateCategoryForm,
  type CategoryForm,
} from './categoryEditing'

const { t } = useI18n()
const planner = usePlannerStore()
const toast = useUndoToast()

const categories = computed(() => planner.document?.categories ?? [])
const editing = ref<{ id: string | null; stored: string | undefined } | null>(null)
const form = reactive<CategoryForm>({ name: '', colorKey: 'blue', goalType: 'none', hours: 1 })
const reassignTo = ref('')
const submitted = ref(false)
const changedElsewhere = ref(false)

const usage = computed(() => (editing.value?.id && planner.document ? categoryUsage(planner.document, editing.value.id) : { blocks: 0, tasks: 0 }))
const isReferenced = computed(() => usage.value.blocks + usage.value.tasks > 0)
const usageText = computed(() => usageSummary((key, count) => t(key, { count }, count), (key, params) => t(key, params), usage.value))
const reassignOptions = computed(() => categories.value.filter((category) => category.id !== editing.value?.id))
// Nothing is chosen for the person: moving everything somewhere is a decision, so the destination starts empty.
const effectiveReassign = computed(() => (reassignOptions.value.some((category) => category.id === reassignTo.value) ? reassignTo.value : ''))
const error = computed(() => (submitted.value ? validateCategoryForm(form) : null))
const sharingCategory = computed(() => categorySharingColor(categories.value, form.colorKey, editing.value?.id ?? null))
const goalOptions = computed(() => (['max', 'min', 'none'] as const).map((value) => ({ value, label: t(`categories.goalType.${value}`) })))
const dirty = computed(() => {
  const original = editing.value?.id ? categories.value.find((category) => category.id === editing.value!.id) : undefined
  if (!original) return form.name !== ''
  const baseline = formFromCategory(original)
  return (Object.keys(baseline) as (keyof CategoryForm)[]).some((key) => baseline[key] !== form[key])
})

function storedCategory(id: string | null): Category | undefined {
  return id ? planner.document?.categories.find((candidate) => candidate.id === id) : undefined
}

// An open editor is bound to the stored value of its own category: reload it when that changes underneath
// (import, restore, another tab), close it when the category is gone, ignore every unrelated commit.
function followStored(): void {
  const current = editing.value
  if (!current?.id) return
  const stored = storedCategory(current.id)
  if (snapshotOf(stored) === current.stored) return
  changedElsewhere.value = true
  if (!stored) { editing.value = null; return }
  Object.assign(form, formFromCategory(stored))
  submitted.value = false
  current.stored = snapshotOf(stored)
}
watch(() => snapshotOf(storedCategory(editing.value?.id ?? null)), followStored)

function goalSummary(goal: Goal): string {
  if (goal.type === 'none') return t('categories.goalSummary.none')
  return t(`categories.goalSummary.${goal.type}`, { hours: formatHours(goal.hoursPerWeek) })
}

function openEditor(category?: Category): void {
  Object.assign(form, category ? formFromCategory(category) : { name: '', colorKey: firstUnusedColorKey(categories.value.filter((candidate) => !candidate.customColor).map((candidate) => candidate.colorKey)) as ColorKey, goalType: 'none' as Goal['type'], hours: 1 })
  submitted.value = false
  changedElsewhere.value = false
  reassignTo.value = ''
  editing.value = { id: category?.id ?? null, stored: snapshotOf(storedCategory(category?.id ?? null)) }
}

// Inside the queued commit: the category must still be exactly what the editor was opened on.
function assertEditable(draft: PlannerDocument, opened: NonNullable<typeof editing.value> | null): void {
  if (!opened) throw new Error(CHANGED_ELSEWHERE)
  assertEntry(opened.id ? draft.categories.find((candidate) => candidate.id === opened.id) : undefined, opened.stored)
}

// A refused save reloads the editor from what is stored now (or closes it when the category is gone).
function refusedAsChanged(result: { ok: boolean; reason?: string }): void {
  if (result.ok || result.reason !== CHANGED_ELSEWHERE) return
  planner.dismissError()
  const current = editing.value
  const stored = current?.id ? storedCategory(current.id) : undefined
  changedElsewhere.value = true
  if (!current?.id || !stored) { editing.value = null; return }
  Object.assign(form, formFromCategory(stored))
  current.stored = snapshotOf(stored)
}

function closeEditor(): void {
  editing.value = null
}

async function save(): Promise<void> {
  submitted.value = true
  if (validateCategoryForm(form)) return
  const id = editing.value?.id ?? crypto.randomUUID()
  const opened = editing.value && { ...editing.value }
  const next = { name: form.name.trim(), colorKey: form.colorKey, goal: goalFromForm(form) }
  const result = await planner.commit((draft) => {
    assertEditable(draft, opened)
    const existing = draft.categories.find((category) => category.id === id)
    if (existing) {
      Object.assign(existing, next)
      delete existing.customColor
    } else {
      draft.categories.push({ id, ...next })
    }
  })
  if (result.ok) closeEditor()
  else refusedAsChanged(result)
}

// What a removal left behind: the other categories and the blocks/tasks it moved. The undo only runs against exactly this.
function removalFingerprint(draft: PlannerDocument, removed: ReturnType<typeof removeCategory>): Pick<PlannerDocument, 'categories' | 'blocks' | 'tasks'> | undefined {
  if (!removed) return undefined
  return {
    categories: draft.categories,
    blocks: draft.blocks.filter((block) => removed.blockIds.includes(block.id)),
    tasks: draft.tasks.filter((task) => removed.taskIds.includes(task.id)),
  }
}

async function remove(): Promise<void> {
  const id = editing.value?.id
  if (!id) return
  const target = isReferenced.value ? effectiveReassign.value : undefined
  const holder: { removed: ReturnType<typeof removeCategory>; after?: string } = { removed: null }
  const opened = editing.value && { ...editing.value }
  const result = await planner.commit((draft) => { assertEditable(draft, opened); holder.removed = removeCategory(draft, id, target); holder.after = snapshotOf(removalFingerprint(draft, holder.removed)) })
  const snapshot = holder.removed
  if (!result.ok) refusedAsChanged(result)
  if (!result.ok || !snapshot) return
  const after = holder.after
  closeEditor()
  toast.show({
    message: t('categories.deleted', { name: snapshot.category.name }),
    onUndo: () => {
      void planner.commit((draft) => {
        assertEntry(removalFingerprint(draft, snapshot), after)
        restoreCategory(draft, snapshot)
      }).then((undone) => { if (!undone.ok && undone.reason === CHANGED_ELSEWHERE) planner.dismissError() })
    },
  })
}
</script>

<template>
  <div v-if="planner.document" class="categories">
    <ListGroup :header="t('settings.categoriesTitle')" :footer="t('categories.footer')">
      <li v-for="category in categories" :key="category.id" class="category-row" :data-testid="`category-${category.id}`">
        <button class="category-button" type="button" :aria-label="t('categories.edit', { name: category.name })" @click="openEditor(category)">
          <span class="swatch" :style="{ background: categoryColor(category) }" aria-hidden="true" />
          <span class="category-text">
            <span class="t-body">{{ category.name }}</span>
            <span class="t-footnote t-secondary">{{ goalSummary(category.goal) }}</span>
          </span>
          <Icon name="chevron-right" :size="18" class="chevron" />
        </button>
      </li>
      <li v-if="categories.length === 0" class="t-subhead t-secondary empty">{{ t('categories.empty') }}</li>
    </ListGroup>
    <Button class="add-category" variant="plain" :disabled="!planner.writable" @click="openEditor()">
      <Icon name="plus" :size="20" /> {{ t('categories.add') }}
    </Button>

    <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('categories.changedElsewhere') }}</p>

    <Sheet :open="editing !== null" :title="editing?.id ? t('categories.editTitle') : t('categories.addTitle')" :dirty="dirty" @update:open="closeEditor">
      <form class="editor" @submit.prevent="save">
        <label class="field">
          <span class="t-footnote t-secondary">{{ t('categories.name') }}</span>
          <input v-model="form.name" class="input" type="text" maxlength="60" :aria-invalid="error === 'name-required'">
        </label>
        <p v-if="error === 'name-required'" class="t-footnote error" role="alert">{{ t('categories.errors.nameRequired') }}</p>

        <fieldset class="colors">
          <legend class="t-footnote t-secondary">{{ t('categories.color') }}</legend>
          <div class="swatches">
            <label v-for="color in COLOR_KEYS" :key="color" class="swatch-choice">
              <input v-model="form.colorKey" class="swatch-input" type="radio" name="category-color" :value="color">
              <span class="swatch-dot" :style="{ background: `var(--cat-${color})` }" />
              <span class="visually-hidden">{{ t(`categories.colors.${color}`) }}</span>
            </label>
          </div>
          <p v-if="sharingCategory" class="t-footnote t-secondary color-hint" role="status" data-testid="color-in-use">{{ t('categories.colorInUse', { name: sharingCategory.name }) }}</p>
        </fieldset>

        <SegmentedControl v-model="form.goalType" :options="goalOptions" :label="t('categories.goal')" />
        <label v-if="form.goalType !== 'none'" class="field">
          <span class="t-footnote t-secondary">{{ t('categories.hours') }}</span>
          <input v-model.number="form.hours" class="input" type="number" min="0.5" max="168" step="0.5" :aria-invalid="error === 'hours-range'">
        </label>
        <p v-if="error === 'hours-range'" class="t-footnote error" role="alert">{{ t('categories.errors.hoursRange') }}</p>

        <Button type="submit" block :disabled="!planner.writable">{{ t('common.save') }}</Button>

        <section v-if="editing?.id" class="danger-zone" :aria-label="t('categories.deleteTitle')">
          <template v-if="isReferenced">
            <p class="t-subhead" data-testid="category-usage">{{ t('categories.inUse', { items: usageText }) }}</p>
            <label v-if="reassignOptions.length" class="field">
              <span class="t-footnote t-secondary">{{ t('categories.reassignTo') }}</span>
              <select :value="effectiveReassign" class="input" @change="reassignTo = ($event.target as HTMLSelectElement).value">
                <option value="" disabled>{{ t('categories.chooseTarget') }}</option>
                <option v-for="category in reassignOptions" :key="category.id" :value="category.id">{{ category.name }}</option>
              </select>
            </label>
            <p v-else class="t-footnote t-secondary">{{ t('categories.noReassignTarget') }}</p>
            <Button variant="plain" destructive block :disabled="!effectiveReassign || !planner.writable" @click="remove">
              {{ t('categories.reassignAndDelete') }}
            </Button>
          </template>
          <Button v-else variant="plain" destructive block :disabled="!planner.writable" @click="remove">{{ t('categories.delete') }}</Button>
        </section>
      </form>
    </Sheet>
  </div>
</template>

<style scoped>
.categories { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); padding-inline: var(--space-4); }
.category-row + .category-row .category-button::before { content: ''; position: absolute; top: 0; right: 0; left: var(--space-4); border-top: 1px solid var(--separator); }
.category-button { position: relative; display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 0; background: transparent; text-align: start; }
/* The card clips its rows, so a row draws its focus ring inside itself, rounded like the card. */
.category-button:focus-visible { outline-offset: -2px; border-radius: var(--radius-card); }
.category-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.chevron { color: var(--label-3); }
.swatch { width: 14px; height: 14px; border-radius: 50%; flex: none; }
.empty { padding: var(--space-3) var(--space-4); }
/* Leading, under the rows' swatches, like the other plain actions in Settings; centred it floated between sections. */
.add-category { align-self: flex-start; }
.editor { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); }
.error { color: var(--danger-label); }
.colors { margin: 0; padding: 0; border: 0; }
.color-hint { margin: var(--space-1) 0 0; }
.swatches { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.swatch-choice { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target); }
/* The radio covers the whole 44 px swatch: a tap anywhere on it chooses the colour, and pointer tools hit the real control. */
.swatch-input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.swatch-input:disabled { cursor: not-allowed; }
.swatch-dot { width: 28px; height: 28px; border-radius: 50%; border: 3px solid transparent; background-clip: padding-box; box-shadow: 0 0 0 1px var(--separator); }
.swatch-choice:has(input:checked) .swatch-dot { box-shadow: 0 0 0 2px var(--label); }
.swatch-choice:has(input:focus-visible) .swatch-dot { outline: 2px solid var(--tint); outline-offset: 3px; }
.danger-zone { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--separator); }
</style>
