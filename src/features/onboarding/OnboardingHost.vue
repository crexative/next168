<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { COLOR_KEYS } from '@/core/model'
import { formatDuration } from '@/features/insights/format'
import { minuteToTime } from '@/features/checkin/checkInForm'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import Sheet from '@/ui/Sheet.vue'
import { buildOnboardingResult, CATEGORY_TEMPLATES, type FirstTaskChoice, type TemplateChoice } from './templates'

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180]
const LAST_STEP = 2

const { t, locale } = useI18n()
const planner = usePlannerStore()

const step = ref(0)
const choices = reactive<TemplateChoice[]>(CATEGORY_TEMPLATES.map((template) => ({
  templateId: template.id,
  selected: false,
  name: t(`onboarding.templates.${template.id}`),
  colorKey: template.colorKey,
  sketch: true,
})))
const firstTask = reactive<FirstTaskChoice>({ title: '', templateId: '', durationMin: 60 })

// The wizard's picks describe one first-run workspace: its id plus the content it was opened on.
function identityOf(document: typeof planner.document): string | undefined {
  return document ? snapshotOf({ workspaceId: document.workspaceId, categories: document.categories, blocks: document.blocks, tasks: document.tasks }) : undefined
}
let wizardIdentity = identityOf(planner.document)

// Start over when another workspace (or other content under the same id) replaces it.
watch(() => identityOf(planner.document), (identity) => {
  wizardIdentity = identity
  step.value = 0
  choices.forEach((choice, index) => Object.assign(choice, { selected: false, name: t(`onboarding.templates.${CATEGORY_TEMPLATES[index]!.id}`), colorKey: CATEGORY_TEMPLATES[index]!.colorKey, sketch: true }))
  Object.assign(firstTask, { title: '', templateId: '', durationMin: 60 })
})

const open = computed(() => planner.status === 'ready' && planner.document?.settings.onboardingDone === false)
const picked = computed(() => choices.filter((choice) => choice.selected))
const taskTemplateId = computed(() => (picked.value.some((choice) => choice.templateId === firstTask.templateId) ? firstTask.templateId : picked.value[0]?.templateId ?? ''))
const saving = ref(false)

function dayNames(days: number[]): string {
  if (days.length === 7) return t('onboarding.everyDay')
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'short', timeZone: 'UTC' })
  return days.map((day) => format.format(new Date(Date.UTC(2024, 0, 7 + day)))).join(', ')
}

function presetText(templateId: string): string {
  const { preset } = CATEGORY_TEMPLATES.find((template) => template.id === templateId)!
  return `${minuteToTime(preset.start)}–${minuteToTime(preset.end)} · ${dayNames(preset.days)}`
}

async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // Persistence is best effort; Settings → Data shows the resulting status.
  }
}

async function complete(withChoices: boolean): Promise<void> {
  saving.value = true
  const opened = wizardIdentity
  const result = withChoices
    ? buildOnboardingResult(choices, { ...firstTask, templateId: taskTemplateId.value }, { newId: () => crypto.randomUUID(), now: new Date() })
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
    await requestPersistence()
  } else if (committed.reason === CHANGED_ELSEWHERE) {
    // The picks belonged to a workspace that was replaced; the watcher restarts the wizard for the new one.
    planner.dismissError()
  }
}

function skipStep(): void {
  if (step.value === 0) choices.forEach((choice) => { choice.selected = false })
  if (step.value === 1) choices.forEach((choice) => { choice.sketch = false })
  if (step.value === 2) firstTask.title = ''
  advance()
}

function advance(): void {
  if (step.value === LAST_STEP) void complete(true)
  else step.value += 1
}

function onSheetToggle(next: boolean): void {
  if (!next) void complete(false)
}

const stepTitle = computed(() => t(`onboarding.steps.${step.value}.title`))
</script>

<template>
  <Sheet :open="open" :title="stepTitle" :dirty="step > 0 || picked.length > 0" @update:open="onSheetToggle">
    <div class="onboarding" data-testid="onboarding">
      <p class="t-caption t-secondary">{{ t('onboarding.progress', { step: step + 1, total: LAST_STEP + 1 }) }}</p>
      <p class="t-subhead t-secondary">{{ t(`onboarding.steps.${step}.description`) }}</p>

      <ul v-if="step === 0" class="choices">
        <li v-for="choice in choices" :key="choice.templateId" class="choice">
          <label class="check">
            <input v-model="choice.selected" class="check-input" type="checkbox" :aria-label="t('onboarding.useCategory', { name: t(`onboarding.templates.${choice.templateId}`) })">
            <span class="check-box" aria-hidden="true"><Icon name="check" :size="16" /></span>
          </label>
          <input v-model="choice.name" class="input name" type="text" maxlength="60" :aria-label="t('onboarding.categoryName')" :disabled="!choice.selected">
          <select v-model="choice.colorKey" class="input color" :aria-label="t('onboarding.categoryColor')" :disabled="!choice.selected" :style="{ borderColor: `var(--cat-${choice.colorKey})` }">
            <option v-for="color in COLOR_KEYS" :key="color" :value="color">{{ t(`categories.colors.${color}`) }}</option>
          </select>
        </li>
      </ul>

      <template v-else-if="step === 1">
        <p v-if="picked.length === 0" class="t-subhead">{{ t('onboarding.needCategories') }}</p>
        <ul v-else class="choices">
          <li v-for="choice in picked" :key="choice.templateId" class="choice sketch">
            <label class="sketch-label">
              <input v-model="choice.sketch" class="check-input" type="checkbox">
              <span class="check-box" aria-hidden="true"><Icon name="check" :size="16" /></span>
              <span>
                <span class="t-body">{{ choice.name }}</span>
                <span class="t-footnote t-secondary preset">{{ presetText(choice.templateId) }}</span>
              </span>
            </label>
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
              <option v-for="choice in picked" :key="choice.templateId" :value="choice.templateId">{{ choice.name }}</option>
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
        <Button v-if="step > 0" variant="plain" @click="step -= 1">{{ t('onboarding.back') }}</Button>
        <Button variant="plain" :disabled="saving" @click="skipStep">{{ t('onboarding.skip') }}</Button>
        <Button :disabled="saving" @click="advance">{{ step === LAST_STEP ? t('onboarding.finish') : t('onboarding.next') }}</Button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.onboarding { display: flex; flex-direction: column; gap: var(--space-3); }
.choices { display: flex; flex-direction: column; gap: var(--space-2); }
.choice { display: flex; align-items: center; gap: var(--space-2); }
.check { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--tap-target); height: var(--tap-target); }
.check-input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.check-box { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border: 2px solid var(--label-3); border-radius: 6px; color: transparent; }
.check-input:checked + .check-box { border-color: var(--tint); background: var(--tint); color: var(--tint-text); }
.check-input:focus-visible + .check-box { outline: 2px solid var(--tint); outline-offset: 2px; }
.input { min-height: var(--tap-target); padding: 0 var(--space-3); border: 1px solid var(--separator); border-radius: var(--radius-control); background: var(--surface-2); }
.name { flex: 1; min-width: 0; }
.color { flex: none; width: 6.5rem; border-width: 2px; }
.sketch { background: var(--surface-2); border-radius: var(--radius-control); }
.sketch-label { position: relative; display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: var(--space-2) var(--space-3); }
.sketch-label > span { display: flex; flex-direction: column; }
.task-form { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-2); }
</style>
