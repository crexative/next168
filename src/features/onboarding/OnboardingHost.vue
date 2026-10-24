<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil } from 'lucide-vue-next'
import { COLOR_KEYS, type Goal } from '@/core/model'
import { formatDuration, formatHoursDecimal } from '@/features/insights/format'
import { minuteToTime } from '@/features/checkin/checkInForm'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import Sheet from '@/ui/Sheet.vue'
import {
  buildOnboardingResult, CATEGORY_TEMPLATES, defaultTaskTemplateId, goalHoursValid, plannedMinutes, presetWeeklyMinutes,
  templateOf, WEEK_MINUTES, type FirstTaskChoice, type TemplateChoice,
} from './templates'

registerIcons({ pencil: Pencil })

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180]
const LAST_STEP = 2

const { t, locale } = useI18n()
const planner = usePlannerStore()

function freshChoices(): TemplateChoice[] {
  return CATEGORY_TEMPLATES.map((template) => ({
    templateId: template.id,
    selected: template.preselected === true,
    name: t(`onboarding.templates.${template.id}`),
    colorKey: template.colorKey,
    sketch: true,
    goal: { ...template.goal },
  }))
}

const step = ref(0)
const choices = reactive<TemplateChoice[]>(freshChoices())
const firstTask = reactive<FirstTaskChoice>({ title: '', templateId: '', durationMin: 60 })
// One editor open at a time: the name and colour of a row (step 1) or the goal of a category (step 2).
const editingId = ref<string | null>(null)
// What the last finished wizard saved, shown until the person leaves it.
const finished = ref<{ categories: number; blocks: number; task: string } | null>(null)

function resetWizard(): void {
  step.value = 0
  editingId.value = null
  choices.splice(0, choices.length, ...freshChoices())
  Object.assign(firstTask, { title: '', templateId: '', durationMin: 60 })
}

// The wizard's picks describe one first-run workspace: its id plus the content it was opened on.
function identityOf(document: typeof planner.document): string | undefined {
  return document ? snapshotOf({ workspaceId: document.workspaceId, categories: document.categories, blocks: document.blocks, tasks: document.tasks }) : undefined
}
let wizardIdentity = identityOf(planner.document)

// Start over when another workspace (or other content under the same id) replaces it.
watch(() => identityOf(planner.document), (identity) => {
  wizardIdentity = identity
  if (finished.value === null) resetWizard()
})

// Opened again from "Set up my week": start from a clean first step.
watch(() => planner.document?.settings.onboardingDone, (done, previous) => {
  if (done === false && previous === true) { finished.value = null; resetWizard() }
})

const wizardOpen = computed(() => planner.status === 'ready' && planner.document?.settings.onboardingDone === false)
const open = computed(() => wizardOpen.value || finished.value !== null)
const picked = computed(() => choices.filter((choice) => choice.selected))
const taskTemplateId = computed(() => defaultTaskTemplateId(choices, firstTask.templateId))
const saving = ref(false)
// Leaving a wizard the person has changed asks first; an untouched one just closes.
const dirty = computed(() => finished.value === null && (step.value > 0 || JSON.stringify(choices) !== JSON.stringify(freshChoices())))
const planned = computed(() => plannedMinutes(choices))
const free = computed(() => Math.max(0, WEEK_MINUTES - planned.value))
const over = computed(() => Math.max(0, planned.value - WEEK_MINUTES))
const goalInvalid = computed(() => picked.value.some((choice) => !goalHoursValid(choice.goal)))
// "Next" needs something to carry forward: at least one category (and sensible goal hours on step 2).
const canAdvance = computed(() => !saving.value && (step.value === 0 ? picked.value.length > 0 : step.value === 1 ? !goalInvalid.value : true))

function dayNames(days: number[]): string {
  if (days.length === 7) return t('onboarding.everyDay')
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' })
  return days.map((day) => format.format(new Date(Date.UTC(2024, 0, 7 + day)))).join(', ')
}

function presetText(templateId: string): string {
  const { preset } = templateOf(templateId)
  return `${minuteToTime(preset.start)}–${minuteToTime(preset.end)} · ${dayNames(preset.days)}`
}

function weeklyText(templateId: string): string {
  return t('onboarding.perWeek', { hours: formatHoursDecimal(presetWeeklyMinutes(templateOf(templateId).preset)) })
}

function goalText(goal: Goal): string {
  return t(`onboarding.goal.${goal.type}`, { hours: formatHoursDecimal(goal.hoursPerWeek * 60) })
}

function displayName(choice: TemplateChoice): string {
  return choice.name.trim() || t(`onboarding.templates.${choice.templateId}`)
}

function toggleEditor(id: string): void {
  editingId.value = editingId.value === id ? null : id
}

function setGoalType(choice: TemplateChoice, type: Goal['type']): void {
  choice.goal = { type, hoursPerWeek: type === 'none' ? 0 : choice.goal.hoursPerWeek || templateOf(choice.templateId).goal.hoursPerWeek || 1 }
}

function setGoalHours(choice: TemplateChoice, value: string): void {
  choice.goal = { ...choice.goal, hoursPerWeek: value === '' ? Number.NaN : Number(value) }
}

const goalOptions = computed(() => (['max', 'min', 'none'] as const).map((value) => ({ value, label: t(`categories.goalType.${value}`) })))

async function complete(withChoices: boolean): Promise<void> {
  saving.value = true
  const opened = wizardIdentity
  const existing = planner.document?.categories ?? []
  const result = withChoices
    ? buildOnboardingResult(choices, { ...firstTask, templateId: taskTemplateId.value }, { newId: () => crypto.randomUUID(), now: new Date(), existing })
    : { categories: [], blocks: [], tasks: [] }
  const committed = await planner.commit((draft) => {
    // The wizard only ever completes a first run; never push its picks into a workspace that already finished it.
    if (draft.settings.onboardingDone) throw new Error('onboarding-done')
    // Checked in the commit itself: the watcher may not have reset the wizard yet when a replacement lands.
    assertEntry({ workspaceId: draft.workspaceId, categories: draft.categories, blocks: draft.blocks, tasks: draft.tasks }, opened)
    draft.categories.push(...result.categories)
    draft.blocks.push(...result.blocks)
    draft.tasks.push(...result.tasks)
    draft.settings.onboardingDone = true
  })
  saving.value = false
  if (committed.ok) {
    // Say what happened: never close on a week that was just built without showing where it is.
    if (withChoices && (result.blocks.length > 0 || result.tasks.length > 0)) {
      finished.value = { categories: result.categories.length, blocks: result.blocks.length, task: result.tasks[0]?.title ?? '' }
    }
  } else if (committed.reason === CHANGED_ELSEWHERE) {
    // The picks belonged to a workspace that was replaced; the watcher restarts the wizard for the new one.
    planner.dismissError()
  }
}

function advance(): void {
  if (!canAdvance.value) return
  editingId.value = null
  if (step.value === LAST_STEP) void complete(true)
  else step.value += 1
}

function goBack(): void {
  editingId.value = null
  step.value -= 1
}

function onSheetToggle(next: boolean): void {
  if (next) return
  if (finished.value !== null) finished.value = null
  else void complete(false)
}

function leaveToWeek(): void {
  finished.value = null
}

const stepTitle = computed(() => (finished.value ? t('onboarding.done.title') : t(`onboarding.steps.${step.value}.title`)))
</script>

<template>
  <Sheet :open="open" :title="stepTitle" :dirty="dirty" @update:open="onSheetToggle">
    <div v-if="finished" class="onboarding" data-testid="onboarding" data-state="done">
      <p class="t-body" data-testid="onboarding-summary">
        {{ t('onboarding.done.summary', { categories: t('onboarding.done.categories', { count: finished.categories }, finished.categories), blocks: t('onboarding.done.blocks', { count: finished.blocks }, finished.blocks) }) }}
      </p>
      <p v-if="finished.task" class="t-subhead t-secondary" data-testid="onboarding-task">{{ t('onboarding.done.task', { title: finished.task }) }}</p>
      <div class="actions">
        <Button variant="plain" @click="finished = null">{{ t('common.close') }}</Button>
        <a class="see-week" href="#/week" data-testid="see-week" @click="leaveToWeek">{{ t('onboarding.done.seeWeek') }}</a>
      </div>
    </div>

    <div v-else class="onboarding" data-testid="onboarding" :data-step="step">
      <p class="t-caption t-secondary">{{ t('onboarding.progress', { step: step + 1, total: LAST_STEP + 1 }) }}</p>
      <p class="t-subhead t-secondary">{{ t(`onboarding.steps.${step}.description`) }}</p>

      <p v-if="step < 2" class="counter t-subhead" role="status" data-testid="week-counter" :data-over="over > 0 || undefined">
        <span class="counter-planned">{{ t('onboarding.counter', { planned: formatHoursDecimal(planned) }) }}</span>
        <span v-if="over > 0" class="counter-over">{{ t('onboarding.counterOver', { over: formatHoursDecimal(over) }) }}</span>
        <span v-else class="t-secondary">{{ t('onboarding.counterFree', { free: formatHoursDecimal(free) }) }}</span>
      </p>

      <ul v-if="step === 0" class="choices">
        <li v-for="choice in choices" :key="choice.templateId" class="choice" :class="{ 'is-off': !choice.selected }" :data-template="choice.templateId">
          <div class="chip-row">
            <label class="chip">
              <input v-model="choice.selected" class="check-input" type="checkbox" :aria-label="t('onboarding.useCategory', { name: displayName(choice) })" @change="editingId = null">
              <span class="check-box" aria-hidden="true"><Icon name="check" :size="16" /></span>
              <span class="color-dot" aria-hidden="true" :style="{ backgroundColor: `var(--cat-${choice.colorKey})` }" />
              <span class="chip-text">
                <span class="t-body chip-name">{{ displayName(choice) }}</span>
                <span class="t-footnote t-secondary">{{ weeklyText(choice.templateId) }}</span>
              </span>
            </label>
            <button
              class="edit-button"
              type="button"
              :disabled="!choice.selected"
              :aria-expanded="editingId === choice.templateId"
              :aria-label="t('onboarding.edit', { name: displayName(choice) })"
              @click="toggleEditor(choice.templateId)"
            >
              <Icon name="pencil" :size="18" />
            </button>
          </div>
          <div v-if="editingId === choice.templateId && choice.selected" class="editor">
            <input v-model="choice.name" class="input name" type="text" maxlength="60" :aria-label="t('onboarding.categoryName')">
            <fieldset class="colors">
              <legend class="visually-hidden">{{ t('onboarding.categoryColor') }}</legend>
              <div class="swatches">
                <label v-for="color in COLOR_KEYS" :key="color" class="swatch-choice">
                  <input v-model="choice.colorKey" class="visually-hidden" type="radio" :name="`color-${choice.templateId}`" :value="color">
                  <span class="swatch-dot" :style="{ background: `var(--cat-${color})` }" />
                  <span class="visually-hidden">{{ t(`categories.colors.${color}`) }}</span>
                </label>
              </div>
            </fieldset>
          </div>
        </li>
      </ul>

      <template v-else-if="step === 1">
        <p v-if="picked.length === 0" class="t-subhead">{{ t('onboarding.needCategories') }}</p>
        <ul v-else class="choices">
          <li v-for="choice in picked" :key="choice.templateId" class="choice sketch" :data-template="choice.templateId">
            <label class="sketch-label">
              <input v-model="choice.sketch" class="check-input" type="checkbox">
              <span class="check-box" aria-hidden="true"><Icon name="check" :size="16" /></span>
              <span class="sketch-text">
                <span class="t-body">{{ displayName(choice) }}</span>
                <span class="t-footnote t-secondary preset">{{ presetText(choice.templateId) }}</span>
              </span>
            </label>
            <button
              class="goal-chip t-subhead"
              type="button"
              :aria-expanded="editingId === choice.templateId"
              :aria-label="t('onboarding.editGoal', { name: displayName(choice) })"
              :data-invalid="!goalHoursValid(choice.goal) || undefined"
              @click="toggleEditor(choice.templateId)"
            >
              <span>{{ goalText(choice.goal) }}</span>
              <Icon name="pencil" :size="16" />
            </button>
            <div v-if="editingId === choice.templateId" class="editor goal-editor">
              <SegmentedControl :model-value="choice.goal.type" :options="goalOptions" :label="t('onboarding.goalLabel', { name: displayName(choice) })" @update:model-value="setGoalType(choice, $event)" />
              <label v-if="choice.goal.type !== 'none'" class="field">
                <span class="t-footnote t-secondary">{{ t('categories.hours') }}</span>
                <input class="input" type="number" min="0.5" max="168" step="0.5" inputmode="decimal" :value="choice.goal.hoursPerWeek" :aria-invalid="!goalHoursValid(choice.goal)" @input="setGoalHours(choice, ($event.target as HTMLInputElement).value)">
              </label>
              <p v-if="!goalHoursValid(choice.goal)" class="t-footnote error" role="alert">{{ t('categories.errors.hoursRange') }}</p>
            </div>
          </li>
        </ul>
      </template>

      <template v-else>
        <p v-if="picked.length === 0" class="t-subhead">{{ t('onboarding.needCategories') }}</p>
        <div v-else class="task-form">
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.titleLabel') }}</span>
            <input v-model="firstTask.title" class="input" type="text" maxlength="120" :placeholder="t('tasks.add.titlePlaceholder')">
          </label>
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.category') }}</span>
            <select :value="taskTemplateId" class="input" @change="firstTask.templateId = ($event.target as HTMLSelectElement).value">
              <option v-if="taskTemplateId === ''" value="">{{ t('onboarding.noTaskCategory') }}</option>
              <option v-for="choice in picked" :key="choice.templateId" :value="choice.templateId">{{ displayName(choice) }}</option>
            </select>
          </label>
          <label class="field">
            <span class="t-footnote t-secondary">{{ t('tasks.add.duration') }}</span>
            <select v-model.number="firstTask.durationMin" class="input">
              <option v-for="minutes in DURATIONS" :key="minutes" :value="minutes">{{ formatDuration(t, minutes) }}</option>
            </select>
          </label>
        </div>
      </template>

      <div class="actions">
        <Button variant="plain" :disabled="saving" data-testid="not-now" @click="complete(false)">{{ t('onboarding.notNow') }}</Button>
        <Button v-if="step > 0" variant="tinted" :disabled="saving" @click="goBack">{{ t('onboarding.back') }}</Button>
        <Button :disabled="!canAdvance" @click="advance">{{ step === LAST_STEP ? t('onboarding.finish') : t('onboarding.next') }}</Button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.onboarding { display: flex; flex-direction: column; gap: var(--space-3); }
.counter { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-3); margin: 0; font-variant-numeric: tabular-nums; }
.counter-planned { font-weight: 600; }
.counter-over { color: var(--danger-label); font-weight: 600; }
.choices { display: flex; flex-direction: column; gap: var(--space-2); }
.choice { display: flex; flex-direction: column; gap: var(--space-2); }
.chip-row { display: flex; align-items: center; gap: var(--space-2); }
.chip { position: relative; display: flex; flex: 1; align-items: center; gap: var(--space-3); min-width: 0; min-height: var(--tap-target); padding: var(--space-1) var(--space-3); background: var(--surface-2); border-radius: var(--radius-control); }
.chip-text { display: flex; flex-direction: column; min-width: 0; }
.chip-name { overflow-wrap: anywhere; }
.check-input { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-box { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border: 2px solid var(--label-3); border-radius: 6px; color: transparent; }
.check-input:checked + .check-box { border-color: var(--tint); background: var(--tint); color: var(--tint-text); }
.check-input:focus-visible + .check-box { outline: 2px solid var(--tint); outline-offset: 2px; }
.color-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; }
/* A category that is not in the week looks switched off: muted, and its edit control cannot be used. */
.is-off .chip { background: transparent; box-shadow: inset 0 0 0 1px var(--separator); }
.is-off .chip-text, .is-off .color-dot { opacity: 0.55; }
.edit-button { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--tap-target); height: var(--tap-target); border: 0; border-radius: var(--radius-control); background: transparent; color: var(--tint-label); transition: transform 0.1s var(--ease-out), opacity 0.1s; touch-action: manipulation; }
.edit-button:active:not(:disabled) { transform: scale(0.97); opacity: 0.85; }
.edit-button:disabled { color: var(--label-3); cursor: not-allowed; }
.edit-button[aria-expanded='true'] { background: color-mix(in srgb, var(--tint) 12%, transparent); }
.editor { display: flex; flex-direction: column; gap: var(--space-2); padding-inline-start: var(--space-2); }
.colors { margin: 0; padding: 0; border: 0; }
.swatches { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.swatch-choice { position: relative; display: inline-flex; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target); }
.swatch-dot { width: 28px; height: 28px; border-radius: 50%; border: 3px solid transparent; background-clip: padding-box; box-shadow: 0 0 0 1px var(--separator); }
.swatch-choice:has(input:checked) .swatch-dot { box-shadow: 0 0 0 2px var(--label); }
.swatch-choice:has(input:focus-visible) .swatch-dot { outline: 2px solid var(--tint); outline-offset: 3px; }
.sketch { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-1); padding: var(--space-1) 0; background: var(--surface-2); border-radius: var(--radius-control); }
.sketch-label { position: relative; display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap-target); padding: var(--space-1) var(--space-3); }
.sketch-text { display: flex; flex-direction: column; min-width: 0; }
.goal-chip { display: inline-flex; align-items: center; gap: var(--space-2); justify-self: start; min-height: var(--tap-target); margin-inline-start: calc(var(--space-3) + 22px + var(--space-3)); padding: 0 var(--space-3); border: 0; border-radius: 999px; background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); font-variant-numeric: tabular-nums; transition: transform 0.1s var(--ease-out), opacity 0.1s; touch-action: manipulation; }
.goal-chip:active { transform: scale(0.97); opacity: 0.85; }
.goal-chip[data-invalid] { color: var(--danger-label); box-shadow: inset 0 0 0 1px var(--danger-label); }
.goal-editor { margin-inline: var(--space-3); padding-block-end: var(--space-2); padding-inline-start: 0; }
.error { color: var(--danger-label); }
.task-form { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
.see-week { display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap-target); padding: 0 var(--space-4); border-radius: var(--radius-control); background: var(--tint); color: var(--tint-text); font-size: 1.0625rem; font-weight: 600; text-decoration: none; touch-action: manipulation; }
.see-week:active { opacity: 0.85; }
@media (prefers-reduced-motion: reduce) {
  .edit-button:active:not(:disabled), .goal-chip:active { transform: none; opacity: 0.7; }
}
</style>
