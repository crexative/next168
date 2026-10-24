<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Category, PlannerDocument, TimeBlock } from '@/core/model'
import { computeStats } from '@/core/stats'
import { displayLocale, formatWholeHours, wholeHourParts } from '@/ui/format'
import { assertDocumentHash, CHANGED_ELSEWHERE, documentHash } from '@/features/insights/entryGuard'
import BlockEditorSheet from '@/features/week/BlockEditorSheet.vue'
import type { BlockDraft } from '@/features/week/blockEditing'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import Sheet from '@/ui/Sheet.vue'
import { applyDraft, clearDraft, draftIdentity, draftOf, loadDraft, saveDraft } from './draftStorage'
import { routineLineText } from './routineText'
import {
  buildOnboardingResult, CATEGORY_TEMPLATES, firstTaskTemplateId, plannedMinutes, templateOf, WEEK_MINUTES,
  type FirstTaskChoice, type TemplateChoice,
} from './templates'

const LAST_STEP = 1

const { t } = useI18n()
const planner = usePlannerStore()

function freshChoices(document: PlannerDocument | null): TemplateChoice[] {
  const categories = document?.categories ?? []
  const remaining = new Set(categories.map((category) => category.id))
  const choices = CATEGORY_TEMPLATES.map((template): TemplateChoice => {
    const name = t(`onboarding.templates.${template.id}`)
    const available = categories.filter((category) => remaining.has(category.id))
    const existing = available.find((category) => [name.toLowerCase(), template.id].includes(category.name.trim().toLowerCase()))
      ?? available.find((category) => category.icon === template.icon)
    if (existing) remaining.delete(existing.id)
    // A category that already has blocks keeps them: the wizard only adds the typical routine to one without.
    const hasBlocks = !!existing && !!document?.blocks.some((block) => block.categoryId === existing.id)
    return {
      templateId: template.id,
      existingCategoryId: existing?.id,
      selected: !!existing || (categories.length === 0 && template.preselected === true),
      name: existing?.name ?? name,
      colorKey: existing?.colorKey ?? template.colorKey,
      sketch: !hasBlocks,
      goal: { ...(existing?.goal ?? template.goal) },
      routine: template.blocks.map((block) => ({ ...block, days: [...block.days] })),
    }
  })
  return [...choices, ...categories.filter((category) => remaining.has(category.id)).map((category): TemplateChoice => ({
    templateId: `category:${category.id}`, existingCategoryId: category.id,
    selected: true, name: category.name, colorKey: category.colorKey, sketch: false, goal: { ...category.goal }, routine: [],
  }))]
}

const step = ref(0)
const choices = reactive<TemplateChoice[]>([])
const firstTask = reactive<Pick<FirstTaskChoice, 'title'>>({ title: '' })
// The routine being edited in the Semana editor: which row and which of its blocks.
const editing = ref<{ templateId: string; index: number } | null>(null)
const editorDraft = ref<BlockDraft>({ title: '', categoryId: '', start: null, end: null, days: [] })
const editorDocument = ref<PlannerDocument | null>(null)
// What the last finished wizard saved, shown until the person leaves it.
const finished = ref<{ task: string } | null>(null)
const changedElsewhere = ref(false)
const existingPlannedMinutes = ref(0)
let openedDocument: PlannerDocument | null = null
let wizardIdentity: string | undefined
let initialChoices = ''

function resetWizard(): void {
  step.value = 0
  editing.value = null
  changedElsewhere.value = false
  openedDocument = planner.document ? structuredClone(planner.document) : null
  wizardIdentity = documentHash(openedDocument)
  existingPlannedMinutes.value = openedDocument ? computeStats(openedDocument).plannedMinutes : 0
  const fresh = freshChoices(openedDocument)
  choices.splice(0, choices.length, ...fresh)
  initialChoices = JSON.stringify(choices)
  firstTask.title = ''
  restoreDraft()
}

// A reload of the tab brings back the unfinished wizard, but only for the workspace revision it was started on.
function restoreDraft(): void {
  if (!openedDocument) return
  const saved = loadDraft(draftIdentity(openedDocument), LAST_STEP)
  if (!saved) return
  applyDraft(choices, saved)
  firstTask.title = saved.taskTitle
  step.value = saved.step
}

const wizardOpen = computed(() => planner.status === 'ready' && planner.document?.settings.onboardingDone === false)
// Bind each opening to its document and revision. Later writes must be refused, never silently rebased.
watch(wizardOpen, (open) => {
  if (open) { finished.value = null; resetWizard() }
}, { immediate: true })
const open = computed(() => wizardOpen.value || finished.value !== null)
watch(open, (isOpen) => { if (!isOpen) editing.value = null })

const picked = computed(() => choices.filter((choice) => choice.selected))
const taskTemplateId = computed(() => firstTaskTemplateId(choices))
const saving = ref(false)
// Leaving a wizard the person has changed keeps their draft for a reload; an untouched one just closes.
const dirty = computed(() => finished.value === null && (step.value > 0 || firstTask.title !== '' || JSON.stringify(choices) !== initialChoices))
watch([dirty, step, () => firstTask.title, () => JSON.stringify(choices)], () => {
  if (!wizardOpen.value || !openedDocument) return
  if (dirty.value) saveDraft(draftOf(draftIdentity(openedDocument), step.value, firstTask.title, choices))
  else clearDraft()
})
const planned = computed(() => existingPlannedMinutes.value + plannedMinutes(choices))
// Whole hours that still add up to the week: "106 h assigned · 62 h unassigned" never reads 105,5 and 62,5.
const hourParts = computed(() => wholeHourParts([planned.value, Math.max(0, WEEK_MINUTES - planned.value)]))
const over = computed(() => Math.max(0, Math.round(planned.value / 60) - WEEK_MINUTES / 60))
const canAdvance = computed(() => !saving.value && (step.value === 0 ? picked.value.length > 0 : true))
const weekStartsOn = computed(() => planner.document?.settings.weekStartsOn ?? 1)

function storedBlocks(choice: TemplateChoice) {
  return openedDocument?.blocks.filter((block) => block.categoryId === choice.existingCategoryId) ?? []
}

function lineText(block: { days: TimeBlock['days']; start: number; end: number }): string {
  return routineLineText(block, displayLocale.value, weekStartsOn.value, t('onboarding.everyDay'))
}

// What a row shows when its blocks cannot be edited here: the ones the workspace already has, or the typical routine.
function staticLines(choice: TemplateChoice): string[] {
  const saved = storedBlocks(choice)
  return (saved.length ? saved : choice.routine).map(lineText)
}

function choiceColor(choice: TemplateChoice): string {
  const existing = openedDocument?.categories.find((category) => category.id === choice.existingCategoryId)
  return existing?.customColor || `var(--cat-${choice.colorKey})`
}

function displayName(choice: TemplateChoice): string {
  return choice.name.trim() || t(`onboarding.templates.${choice.templateId}`)
}

const categoryIdOf = (choice: TemplateChoice) => choice.existingCategoryId ?? `wizard:${choice.templateId}`
const blockIdOf = (choice: TemplateChoice, index: number) => `${choice.templateId}#${index}`

// The Semana editor works on a document: this one holds the blocks the workspace has plus every other routine the
// wizard would create, so an overlap is caught here exactly as it is in Semana.
function openEditor(choice: TemplateChoice, index: number): void {
  const base = openedDocument ?? planner.document
  const slot = choice.routine[index]
  if (!base || !slot) return
  const category: Category = { id: categoryIdOf(choice), name: displayName(choice), colorKey: choice.colorKey, icon: templateOf(choice.templateId)?.icon, goal: choice.goal }
  const others = choices.filter((other) => other.selected && other.sketch).flatMap((other) => other.routine
    .map((block, position) => ({ id: blockIdOf(other, position), categoryId: categoryIdOf(other), title: displayName(other), days: block.days, start: block.start, end: block.end }))
    .filter((block) => block.id !== blockIdOf(choice, index)))
  editorDocument.value = { ...base, categories: [category], blocks: [...base.blocks, ...others] }
  editorDraft.value = { id: blockIdOf(choice, index), title: displayName(choice), categoryId: category.id, start: slot.start, end: slot.end, days: [...slot.days] }
  editing.value = { templateId: choice.templateId, index }
}

function editedChoice(): TemplateChoice | undefined {
  return editing.value ? choices.find((choice) => choice.templateId === editing.value!.templateId) : undefined
}

// Saving a routine includes its row: editing it says the person wants it in their week.
function saveRoutine(block: TimeBlock): void {
  const choice = editedChoice()
  if (choice && editing.value) {
    choice.routine[editing.value.index] = { start: block.start, end: block.end, days: [...block.days] }
    choice.name = block.title
    choice.selected = true
  }
  editing.value = null
}

// Removing a routine takes the row back out of the week, and the row offers its typical routine again.
function removeRoutine(): void {
  const choice = editedChoice()
  if (choice && editing.value) {
    choice.routine.splice(editing.value.index, 1)
    if (choice.routine.length === 0) {
      choice.routine = (templateOf(choice.templateId)?.blocks ?? []).map((block) => ({ ...block, days: [...block.days] }))
      choice.selected = false
    }
  }
  editing.value = null
}

// The editor closing under the wizard's own sheet would release the page's "a sheet is open" state while the wizard
// is still open; give it back once the editor's own bookkeeping has run.
watch(editing, async (current, previous) => {
  if (current !== null || previous === null) return
  await nextTick()
  if (open.value) document.documentElement.dataset.sheetOpen = ''
}, { flush: 'post' })

async function complete(withChoices: boolean): Promise<void> {
  saving.value = true
  const opened = wizardIdentity
  const existing = openedDocument?.categories ?? []
  const result = withChoices
    ? buildOnboardingResult(choices, { ...firstTask, templateId: taskTemplateId.value }, { newId: () => crypto.randomUUID(), now: new Date(), existing })
    : { categories: [], categoryUpdates: [], blocks: [], tasks: [] }
  const committed = await planner.commit((draft) => {
    assertDocumentHash(draft, opened)
    // Never push picks into a workspace that already finished this wizard.
    if (draft.settings.onboardingDone) throw new Error('onboarding-done')
    for (const update of result.categoryUpdates) {
      Object.assign(draft.categories.find((category) => category.id === update.id)!, update.patch)
    }
    draft.categories.push(...result.categories)
    draft.blocks.push(...result.blocks)
    draft.tasks.push(...result.tasks)
    draft.settings.onboardingDone = true
  })
  saving.value = false
  if (committed.ok) {
    clearDraft()
    // Say what happened: never close on a week that was just built without showing where it is.
    if (withChoices && (result.blocks.length > 0 || result.tasks.length > 0)) finished.value = { task: result.tasks[0]?.title ?? '' }
  } else if (committed.reason === CHANGED_ELSEWHERE || committed.reason === 'conflict') {
    planner.dismissError()
    clearDraft()
    resetWizard()
    changedElsewhere.value = true
  }
}

function advance(): void {
  if (!canAdvance.value) return
  if (step.value === LAST_STEP) void complete(true)
  else step.value += 1
}

function onSheetToggle(next: boolean): void {
  if (next) return
  if (finished.value !== null) finished.value = null
  else void complete(false)
}

const stepTitle = computed(() => (finished.value ? t('onboarding.done.title') : t(`onboarding.steps.${step.value}.title`)))
</script>

<template>
  <Sheet :open="open" :title="stepTitle" :dirty="dirty" no-dismiss @update:open="onSheetToggle">
    <div v-if="finished" class="onboarding" data-testid="onboarding" data-state="done">
      <p class="t-body" data-testid="onboarding-summary">{{ t('onboarding.done.summary') }}</p>
      <p v-if="finished.task" class="t-subhead t-secondary" data-testid="onboarding-task">{{ t('onboarding.done.task', { title: finished.task }) }}</p>
      <div class="actions">
        <Button variant="tinted" href="#/week" data-testid="see-week" @click="finished = null">{{ t('onboarding.done.seeWeek') }}</Button>
        <Button data-testid="start" @click="finished = null">{{ t('onboarding.done.start') }}</Button>
      </div>
    </div>

    <div v-else class="onboarding" data-testid="onboarding" :data-step="step">
      <p class="t-caption t-secondary">{{ t('onboarding.progress', { step: step + 1, total: LAST_STEP + 1 }) }}</p>
      <p class="t-subhead t-secondary">{{ t(`onboarding.steps.${step}.description`) }}</p>
      <p v-if="changedElsewhere" class="t-footnote error" role="alert">{{ t('onboarding.changedElsewhere') }}</p>

      <template v-if="step === 0">
        <p class="counter t-subhead" role="status" data-testid="week-counter" :data-over="over > 0 || undefined">
          <span v-if="over > 0" class="counter-over">{{ t('onboarding.counterOver', { over: formatWholeHours(over) }) }}</span>
          <template v-else>
            <span class="counter-assigned">{{ t('onboarding.assigned', { hours: formatWholeHours(hourParts[0]!) }) }}</span>{{ ' ' }}<span aria-hidden="true">·</span>{{ ' ' }}<span class="t-secondary">{{ t('onboarding.unassigned', { hours: formatWholeHours(hourParts[1]!) }) }}</span>
          </template>
        </p>
        <p v-if="picked.length === 0" class="t-footnote t-secondary" data-testid="need-routine">{{ t('onboarding.needRoutine') }}</p>

        <ul class="routines">
          <li v-for="choice in choices" :key="choice.templateId" class="routine" :class="{ 'is-off': !choice.selected }" :data-template="choice.templateId">
            <div class="routine-head">
              <input v-model="choice.selected" class="check-input" type="checkbox" :aria-label="t('onboarding.useCategory', { name: displayName(choice) })">
              <span class="check-box" aria-hidden="true"><Icon name="check" :size="16" /></span>
              <span class="color-dot" aria-hidden="true" :style="{ backgroundColor: choiceColor(choice) }" />
              <span class="t-body routine-name">{{ displayName(choice) }}</span>
            </div>
            <template v-if="choice.selected && choice.sketch">
              <button
                v-for="(block, index) in choice.routine"
                :key="index"
                class="routine-line t-subhead"
                type="button"
                :aria-label="t('onboarding.editRoutine', { name: displayName(choice), when: lineText(block) })"
                :data-block="index"
                @click="openEditor(choice, index)"
              >
                <span class="routine-when">{{ lineText(block) }}</span>
                <Icon name="chevron-right" :size="18" />
              </button>
            </template>
            <template v-else>
              <p v-for="(line, index) in staticLines(choice)" :key="index" class="routine-note t-footnote t-secondary">{{ line }}</p>
            </template>
          </li>
        </ul>
      </template>

      <div v-else class="task-form">
        <p v-if="taskTemplateId === ''" class="t-subhead">{{ t('onboarding.taskNeedsRoutine') }}</p>
        <label v-else class="field">
          <span class="t-footnote t-secondary">{{ t('onboarding.taskLabel') }}</span>
          <input v-model="firstTask.title" class="input" type="text" maxlength="120" :placeholder="t('onboarding.taskPlaceholder')">
        </label>
      </div>

      <div class="actions">
        <Button v-if="step > 0" variant="plain" :disabled="saving" @click="step -= 1">{{ t('onboarding.back') }}</Button>
        <Button :disabled="!canAdvance" @click="advance">{{ step === LAST_STEP ? t('onboarding.finish') : t('onboarding.next') }}</Button>
      </div>
    </div>
  </Sheet>

  <BlockEditorSheet
    v-if="editorDocument"
    :open="editing !== null"
    :draft="editorDraft"
    :document="editorDocument"
    @update:open="editing = null"
    @save="saveRoutine"
    @delete="removeRoutine"
  />
</template>

<style scoped>
.onboarding { display: flex; flex-direction: column; gap: var(--space-3); }
.counter { margin: 0; font-variant-numeric: tabular-nums; }
.counter-assigned { font-weight: 600; }
.counter-over { color: var(--danger-label); font-weight: 600; }
.routines { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.routine { position: relative; display: flex; flex-direction: column; padding-block-end: var(--space-1); background: var(--surface-2); border-radius: var(--radius-control); }
.routine-head { position: relative; display: flex; align-items: center; gap: var(--space-3); min-width: 0; min-height: var(--tap-target); padding: var(--space-1) var(--space-3); }
.routine-name { min-width: 0; overflow-wrap: anywhere; }
/* The checkbox covers the whole head: a tap anywhere on the name ticks the row, and pointer tools hit the real control. */
.check-input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-box { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border: 2px solid var(--label-3); border-radius: 6px; color: transparent; }
.check-input:checked + .check-box { border-color: var(--tint); background: var(--tint); color: var(--tint-text); }
.check-input:focus-visible + .check-box { outline: 2px solid var(--tint); outline-offset: 2px; }
.color-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; }
/* A category that is not in the week looks switched off: muted, with its typical routine shown as plain text. */
.is-off { background: transparent; box-shadow: inset 0 0 0 1px var(--separator); }
.is-off .routine-name, .is-off .color-dot { opacity: 0.55; }
/* Lines sit under the name, aligned with it: tapping one opens the Semana editor for that block. */
.routine-line { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); width: 100%; min-height: var(--tap-target); padding-block: 0; padding-inline: calc(var(--space-3) + 22px + var(--space-3) + 12px + var(--space-3)) var(--space-3); border: 0; background: transparent; color: var(--tint-label); text-align: start; font-variant-numeric: tabular-nums; touch-action: manipulation; transition: opacity 0.1s; }
.routine-line:active { opacity: 0.6; }
.routine-line:focus-visible { outline-offset: -2px; }
.routine-when { min-width: 0; overflow-wrap: anywhere; }
.routine-note { margin: 0; padding-inline: calc(var(--space-3) + 22px + var(--space-3) + 12px + var(--space-3)) var(--space-3); padding-block-end: var(--space-1); font-variant-numeric: tabular-nums; }
.error { color: var(--danger-label); }
.task-form { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
@media (prefers-reduced-motion: reduce) {
  .routine-line:active { opacity: 0.7; }
}
</style>
