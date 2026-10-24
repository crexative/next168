<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { checkInDateFor } from './evening'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import BackButton from '@/features/settings/BackButton.vue'
import { actualFor } from '@/features/today/actuals'
import ItemStatusControl from '@/features/today/ItemStatusControl.vue'
import { planSince, readPlanSince } from '@/features/today/planSince'
import { useBlockStatus } from '@/features/today/useBlockStatus'
import { formatDate, formatTime } from '@/features/week/localTime'
import { useNow } from '@/features/week/useNow'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import { displayLocale } from '@/ui/format'
import { blocksToMark } from './blocksToMark'
import {
  checkInFromForm, formFromCheckIn, isEmptyCheckIn, upsertCheckIn, withPlanTimes,
  type CheckInFormState,
} from './checkInForm'
import { markCheckInSaved } from './checkinFlash'
import ChoiceRow from './ChoiceRow.vue'
import { deriveExercise, tracksExercise } from './exerciseFromPlan'
import { suggestFromPlan } from './planAnchors'
import TimeFact from './TimeFact.vue'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const now = useNow()
const blockStatus = useBlockStatus()

const timeZone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
// The check-in closes the day on screen: no date to pick, the date is in the title area (until 04:00 that is the day
// before). Capture only after the document loads, then retain it across midnight and the 04:00 boundary.
const date = ref('')
const dateLabel = computed(() => date.value ? formatDate(date.value, locale.value, { weekday: 'long', day: 'numeric', month: 'long' }) : '')
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

function entryFor(on: string) {
  return planner.document?.checkIns.find((checkIn) => checkIn.date === on)
}

function load(): void {
  const entry = entryFor(date.value)
  const suggestion = planner.document ? suggestFromPlan(planner.document, date.value) : { worksThatDay: true }
  worksThatDay.value = suggestion.worksThatDay
  fromPlan.value = !entry && ('bedtime' in suggestion || 'wake' in suggestion || 'workEnd' in suggestion)
  Object.assign(form, entry ? formFromCheckIn(date.value, entry) : withPlanTimes(formFromCheckIn(date.value, entry), suggestion))
  formSnapshot = snapshotOf(entry)
  loaded = true
}

watch(() => planner.document, (document) => {
  if (document && !date.value) date.value = checkInDateFor(new Date(), document.settings.timeZone)
}, { immediate: true })

// The form follows its own entry: unrelated commits (another entry, tasks, settings) leave typed values alone;
// imported, restored or synced content that changes this entry reloads the form.
watch(() => (planner.document ? { stored: snapshotOf(entryFor(date.value)) } : null), (next) => {
  if (!next) return
  if (!loaded || next.stored !== formSnapshot) load()
}, { immediate: true })

// Today's blocks that are over and not yet marked. Those seen unmarked stay listed while they are answered, so a
// tap that marks one shows its answer in place (and the toast can undo it) instead of making the row vanish.
const since = computed(() => planner.document ? planSince(planner.document, readPlanSince(planner.document.workspaceId)) : undefined)
const candidates = computed(() => planner.document ? blocksToMark(planner.document, date.value, now.value, since.value) : [])
const keyOf = (occurrence: { blockId: string; start: string }) => `${occurrence.blockId}@${occurrence.start}`
const seenUnmarked = ref(new Set<string>())
watch(() => planner.document?.workspaceId, () => { seenUnmarked.value = new Set() })
watch(candidates, (list) => {
  const document = planner.document
  if (!document) return
  for (const occurrence of list) if (!actualFor(document.actuals, occurrence)) seenUnmarked.value.add(keyOf(occurrence))
}, { immediate: true })
const pending = computed(() => candidates.value.filter((occurrence) => {
  const answered = planner.document ? actualFor(planner.document.actuals, occurrence) !== undefined : false
  return !answered || seenUnmarked.value.has(keyOf(occurrence))
}))

function range(occurrence: { start: string; end: string }): string {
  return `${formatTime(occurrence.start, displayLocale.value, timeZone.value)} – ${formatTime(occurrence.end, displayLocale.value, timeZone.value)}`
}

const stressOptions = computed(() => (['1', '2', '3', '4', '5'] as const).map((value) => ({ value, label: value })))
const stressEnds = computed(() => ({ low: t('checkin.stressLow'), high: t('checkin.stressHigh'), scale: t('checkin.stressScale') }))

async function save(): Promise<void> {
  const snapshot = formSnapshot
  changedElsewhere.value = false
  const result = await planner.commit((draft) => {
    // Exercise is read from the timeline as it stands when the commit runs, so it never disagrees with it.
    const derived = deriveExercise(draft, form.date)
    // Legacy answers survive only when the plan has no exercise blocks. Unmarked tracked blocks clear the answer.
    const exercise = derived ?? (tracksExercise(draft) ? '' : form.exercise)
    const next = checkInFromForm({ ...form, exercise })
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
    load()
    changedElsewhere.value = true
  }
}

// The way back sits top-leading in the shell's toolbar, where a back control is expected; without that slot
// (a bare view) it stays in the page.
const toolbar = ref<HTMLElement | null>(null)
const ready = ref(false)
onMounted(() => {
  toolbar.value = document.querySelector<HTMLElement>('.toolbar-inner')
  ready.value = true
})
</script>

<template>
  <div v-if="planner.document" class="checkin">
    <Teleport v-if="ready" :to="toolbar ?? 'body'" :disabled="!toolbar">
      <span class="toolbar-back" :class="{ 'is-in-toolbar': toolbar }">
        <BackButton current="checkin" fallback="today" />
      </span>
    </Teleport>
    <form class="checkin-form" :aria-label="t('checkin.title')" @submit.prevent="save">
      <p class="date-line t-headline t-secondary" data-testid="checkin-date">{{ dateLabel }}</p>
      <p class="t-subhead t-secondary">{{ t('checkin.intro') }}</p>

      <div class="facts" data-testid="checkin-times">
        <TimeFact v-model="form.bedtime" test-id="fact-bedtime" sentence-key="checkin.bedtime.sentence" question-key="checkin.bedtime.question" />
        <TimeFact v-model="form.wake" test-id="fact-wake" sentence-key="checkin.wake.sentence" question-key="checkin.wake.question" />
        <TimeFact v-if="showWorkEnd" v-model="form.workEnd" test-id="fact-work-end" sentence-key="checkin.workEnd.sentence" question-key="checkin.workEnd.question" />
      </div>
      <p v-if="fromPlan" class="t-footnote t-secondary plan-hint" data-testid="plan-hint">{{ t('checkin.planHint') }}</p>

      <section v-if="pending.length" class="pending" :aria-label="t('checkin.pending.title')" data-testid="checkin-blocks">
        <h2 class="t-headline">{{ t('checkin.pending.title') }}</h2>
        <ul class="pending-list">
          <li v-for="occurrence in pending" :key="keyOf(occurrence)" class="pending-row" data-testid="checkin-block">
            <span class="pending-text">
              <span class="t-body">{{ occurrence.title }}</span>
              <span class="t-footnote t-secondary tabular">{{ range(occurrence) }}</span>
            </span>
            <ItemStatusControl
              class="pending-control"
              :item-key="keyOf(occurrence)"
              :title="occurrence.title"
              :status="actualFor(planner.document.actuals, occurrence)?.status"
              :actual-minutes="actualFor(planner.document.actuals, occurrence)?.actualMinutes"
              :planned-minutes="occurrence.plannedMinutes"
              :writable="planner.writable"
              @record="(status, minutes) => blockStatus.record(occurrence, status, minutes)"
              @clear="blockStatus.clear(occurrence)"
            />
          </li>
        </ul>
        <p class="t-footnote t-secondary">{{ t('checkin.pending.hint') }}</p>
      </section>

      <ChoiceRow v-model="form.stress" :options="stressOptions" :label="t('checkin.stress')" :ends="stressEnds" />

      <label class="field">
        <span class="t-footnote t-secondary">{{ t('checkin.note') }}</span>
        <textarea v-model="form.note" class="input note" rows="3" maxlength="280" />
      </label>

      <Button type="submit" block :disabled="!planner.writable || !form.date">{{ t('checkin.save') }}</Button>
      <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('checkin.changedElsewhere') }}</p>
    </form>
  </div>
</template>

<style scoped>
/* Starts under the large title like Assistant; centred, it drifted away from its own title on wide windows. */
.checkin { display: flex; flex-direction: column; gap: var(--space-4); max-width: 36rem; padding: 0 var(--space-4) var(--space-6); }
.checkin-form { display: flex; flex-direction: column; gap: var(--space-4); }
.date-line { margin: 0; }
.facts, .pending-list { margin: 0; padding: 0; list-style: none; border-radius: var(--radius-card); background: var(--surface); }
.facts :deep(.fact + .fact), .pending-row + .pending-row { border-top: 0.5px solid var(--separator); }
.pending { display: flex; flex-direction: column; gap: var(--space-2); }
.pending h2, .pending p { margin: 0; }
.pending-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); }
.pending-text { display: flex; flex: 1; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.pending-control { margin-inline-end: calc(var(--space-2) * -1); }
.tabular { font-variant-numeric: tabular-nums; }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 8rem; }
/* The form sits on the page background, not in a card. */
.input { background-color: var(--surface); }
.plan-hint { margin: calc(var(--space-2) * -1) 0 0; }
.note { padding: var(--space-2) var(--space-3); resize: vertical; }
/* Top-leading in the toolbar row, level with the settings gear on the other side. */
.toolbar-back.is-in-toolbar { position: absolute; inset-block: 0; inset-inline-start: var(--space-4); display: flex; align-items: center; max-width: 7rem; }
.toolbar-back.is-in-toolbar :deep(.back-button) { max-width: 100%; }
.toolbar-back.is-in-toolbar :deep(.back-button span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbar-back:not(.is-in-toolbar) { display: block; }
</style>
