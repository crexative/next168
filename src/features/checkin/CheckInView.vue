<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import {
  checkInFromForm, formFromCheckIn, isEmptyCheckIn, upsertCheckIn,
  type CheckInFormState, type ExerciseAnswer, type StressAnswer,
} from './checkInForm'

const { t } = useI18n()
const planner = usePlannerStore()

const timeZone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(new Date(), timeZone.value))
const form = reactive<CheckInFormState>(formFromCheckIn('', undefined))
const saved = ref(false)

function loadDate(date: string): void {
  Object.assign(form, formFromCheckIn(date, planner.document?.checkIns.find((checkIn) => checkIn.date === date)))
  saved.value = false
}

watch(() => planner.document?.workspaceId, () => { if (planner.document && form.date === '') loadDate(today.value) }, { immediate: true })

function onDateChange(): void {
  if (form.date) loadDate(form.date)
}

const exerciseOptions = computed(() => (['yes', 'no', 'not-planned'] as const).map((value) => ({ value, label: t(`checkin.exercise.${value}`) })))
const stressOptions = computed(() => (['1', '2', '3', '4', '5'] as const).map((value) => ({ value, label: value })))
const exerciseModel = computed({
  get: () => (form.exercise || 'none') as ExerciseAnswer | 'none',
  set: (value) => { form.exercise = value === 'none' ? '' : value },
})
const stressModel = computed({
  get: () => (form.stress || '0') as StressAnswer | '0',
  set: (value) => { form.stress = value === '0' ? '' : value },
})
const exerciseWithNone = computed(() => [{ value: 'none' as const, label: t('checkin.exercise.unanswered') }, ...exerciseOptions.value])
const stressWithNone = computed(() => [{ value: '0' as const, label: '–' }, ...stressOptions.value])

async function save(): Promise<void> {
  const next = checkInFromForm(form)
  const result = await planner.commit((draft) => {
    draft.checkIns = isEmptyCheckIn(next)
      ? draft.checkIns.filter((checkIn) => checkIn.date !== next.date)
      : upsertCheckIn(draft.checkIns, next)
  })
  if (result.ok) {
    saved.value = true
    window.location.hash = '#/insights'
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

    <div class="times">
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.bedtime') }}</span>
        <input v-model="form.bedtime" class="input" type="time" @input="saved = false">
      </label>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.wake') }}</span>
        <input v-model="form.wake" class="input" type="time" @input="saved = false">
      </label>
      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.workEnd') }}</span>
        <input v-model="form.workEnd" class="input" type="time" @input="saved = false">
      </label>
    </div>

    <SegmentedControl v-model="exerciseModel" :options="exerciseWithNone" :label="t('checkin.exercise.label')" />
    <SegmentedControl v-model="stressModel" :options="stressWithNone" :label="t('checkin.stress')" />

    <label class="field">
      <span class="t-footnote t-secondary">{{ t('checkin.note') }}</span>
      <textarea v-model="form.note" class="input note" rows="3" maxlength="280" />
    </label>

    <Button type="submit" block :disabled="!planner.writable || !form.date">{{ t('checkin.save') }}</Button>
    <p v-if="saved" class="t-subhead" role="status">{{ t('checkin.saved') }}</p>
  </form>
</template>

<style scoped>
.checkin { display: flex; flex-direction: column; gap: var(--space-4); max-width: 36rem; margin-inline: auto; padding: 0 var(--space-4) var(--space-6); }
.times { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 8rem; }
.input { min-height: var(--tap-target); padding: 0 var(--space-3); border: 1px solid var(--separator); border-radius: var(--radius-control); background: var(--surface); }
.note { padding: var(--space-2) var(--space-3); resize: vertical; }
</style>
