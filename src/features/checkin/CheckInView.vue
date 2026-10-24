<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateOf } from '@/core/time'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import {
  checkInFromForm, formFromCheckIn, isEmptyCheckIn, upsertCheckIn, withPlanTimes,
  type CheckInFormState,
} from './checkInForm'
import { markCheckInSaved } from './checkinFlash'
import ChoiceRow from './ChoiceRow.vue'
import { suggestFromPlan } from './planAnchors'

const { t } = useI18n()
const planner = usePlannerStore()

const timeZone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(new Date(), timeZone.value))
const form = reactive<CheckInFormState>(formFromCheckIn('', undefined))
const changedElsewhere = ref(false)
// The stored entry of the form's date as it was when the form was loaded.
let formSnapshot: string | undefined
let loaded = false
// Whether the plan has work on the form's date; a stored work-end time keeps its field visible either way.
const worksThatDay = ref(true)
// True while the shown times were taken from the plan rather than from a saved check-in.
const fromPlan = ref(false)
const showWorkEnd = computed(() => worksThatDay.value || form.workEnd !== '')

function entryFor(date: string) {
  return planner.document?.checkIns.find((checkIn) => checkIn.date === date)
}

function loadDate(date: string): void {
  const entry = entryFor(date)
  const suggestion = date && planner.document ? suggestFromPlan(planner.document, date) : { worksThatDay: true }
  worksThatDay.value = suggestion.worksThatDay
  fromPlan.value = !entry && ('bedtime' in suggestion || 'wake' in suggestion || 'workEnd' in suggestion)
  Object.assign(form, entry || !date ? formFromCheckIn(date, entry) : withPlanTimes(formFromCheckIn(date, entry), suggestion))
  formSnapshot = snapshotOf(entry)
  loaded = true
}

// The form follows its own entry: unrelated commits (another entry, tasks, settings) leave typed values alone;
// imported, restored or synced content that changes this entry reloads the form.
watch(() => (planner.document ? { stored: snapshotOf(entryFor(form.date || today.value)) } : null), (next) => {
  if (!next) return
  if (!loaded || next.stored !== formSnapshot) loadDate(form.date || today.value)
}, { immediate: true })

function onDateChange(): void {
  if (form.date) loadDate(form.date)
}

const exerciseOptions = computed(() => (['yes', 'no', 'not-planned'] as const).map((value) => ({ value, label: t(`checkin.exercise.${value}`) })))
const stressOptions = computed(() => (['1', '2', '3', '4', '5'] as const).map((value) => ({ value, label: value })))

async function save(): Promise<void> {
  const next = checkInFromForm(form)
  const snapshot = formSnapshot
  changedElsewhere.value = false
  const result = await planner.commit((draft) => {
    assertEntry(draft.checkIns.find((checkIn) => checkIn.date === next.date), snapshot)
    draft.checkIns = isEmptyCheckIn(next)
      ? draft.checkIns.filter((checkIn) => checkIn.date !== next.date)
      : upsertCheckIn(draft.checkIns, next)
  })
  if (result.ok) {
    // Today shows "Guardado ✓" and takes focus; the form has nothing more to say.
    markCheckInSaved()
    window.location.hash = '#/today'
  } else if (result.reason === CHANGED_ELSEWHERE) {
    planner.dismissError()
    loadDate(form.date || today.value)
    changedElsewhere.value = true
  }
}
</script>

<template>
  <form v-if="planner.document" class="checkin" :aria-label="t('checkin.title')" @submit.prevent="save">
    <p class="t-subhead t-secondary">{{ t('checkin.intro') }}</p>

    <label class="field">
      <span class="t-footnote t-secondary">{{ t('checkin.date') }}</span>
      <input v-model="form.date" class="input" type="date" :max="today" required @change="onDateChange">
    </label>

    <div class="times" data-testid="checkin-times">
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.bedtime') }}</span>
        <input v-model="form.bedtime" class="input" type="time">
      </label>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.wake') }}</span>
        <input v-model="form.wake" class="input" type="time">
      </label>
      <label v-if="showWorkEnd" class="field" data-testid="work-end-field">
        <span class="t-footnote t-secondary">{{ t('checkin.workEnd') }}</span>
        <input v-model="form.workEnd" class="input" type="time">
      </label>
    </div>

    <p v-if="fromPlan" class="t-footnote t-secondary plan-hint" data-testid="plan-hint">{{ t('checkin.planHint') }}</p>

    <ChoiceRow v-model="form.exercise" :options="exerciseOptions" :label="t('checkin.exercise.label')" />
    <ChoiceRow v-model="form.stress" :options="stressOptions" :label="t('checkin.stress')" />

    <label class="field">
      <span class="t-footnote t-secondary">{{ t('checkin.note') }}</span>
      <textarea v-model="form.note" class="input note" rows="3" maxlength="280" />
    </label>

    <Button type="submit" block :disabled="!planner.writable || !form.date">{{ t('checkin.save') }}</Button>
    <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('checkin.changedElsewhere') }}</p>
  </form>
</template>

<style scoped>
/* Starts under the large title like Assistant; centred, it drifted away from its own title on wide windows. */
.checkin { display: flex; flex-direction: column; gap: var(--space-4); max-width: 36rem; padding: 0 var(--space-4) var(--space-6); }
.times { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 8rem; }
/* The form sits on the page background, not in a card. */
.input { background-color: var(--surface); }
.plan-hint { margin: calc(var(--space-2) * -1) 0 0; }
.note { padding: var(--space-2) var(--space-3); resize: vertical; }
</style>
