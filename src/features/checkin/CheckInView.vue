<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { checkInDateFor, checkInDoneToday } from './evening'
import { assertEntry, CHANGED_ELSEWHERE, snapshotOf } from '@/features/insights/entryGuard'
import { backTarget } from '@/features/settings/navigationTrail'
import { actualFor } from '@/features/today/actuals'
import { planSince, readPlanSince } from '@/features/today/planSince'
import { useBlockStatus } from '@/features/today/useBlockStatus'
import { formatTime } from '@/features/week/localTime'
import { formatDate } from '@/ui/format'
import { useNow } from '@/features/week/useNow'
import { usePlannerStore } from '@/stores/plannerStore'
import AppMark from '@/ui/AppMark.vue'
import Button from '@/ui/Button.vue'
import ConversationFrame from '@/ui/ConversationFrame.vue'
import QuickReplies from '@/ui/QuickReplies.vue'
import { announce } from '@/ui/announcer'
import { openFullScreen } from '@/ui/sheetStack'
import { formatMinute } from '@/features/week/localTime'
import { readsAsOne } from '@/features/today/clockPhrase'
import { displayLocale, rangeText } from '@/ui/format'
import { blocksToMark } from './blocksToMark'
import {
  checkInFromForm, formFromCheckIn, isEmptyCheckIn, upsertCheckIn, withPlanTimes,
  type CheckInFormState,
} from './checkInForm'
import { markCheckInSaved } from './checkinFlash'
import { draftKey, dropDraft, keepDraft, takeDraft } from './checkInDraft'
import { deriveExercise, tracksExercise } from './exerciseFromPlan'
import { suggestFromPlan } from './planAnchors'
import { minuteToTime, timeToMinute } from './checkInForm'
import { disableReminder, enableReminder, REMINDER_MINUTE, reminderEnabled, reminderSupported } from './reminder'

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
// The form as loaded (before a kept draft), so the conversation knows what is unsaved and what the plan told.
const pristine = ref<CheckInFormState | null>(null)
// Answers brought back from a draft kept on close: the conversation says they are not saved yet.
const restored = ref(false)
const dirty = computed(() => !!pristine.value && JSON.stringify(form) !== JSON.stringify(pristine.value))
const currentDraftKey = () => draftKey(planner.document?.workspaceId ?? '', date.value, formSnapshot)

function entryFor(on: string) {
  return planner.document?.checkIns.find((checkIn) => checkIn.date === on)
}

// Where the conversation is: questions left for later, the answer being changed, what is typed in its field, Partly's
// minutes and the note's field. A load (opening, a change elsewhere, a refused save) drops whatever was half-typed
// against the old values; questions left for later stay so, with those a kept draft brings back.
const skipped = ref(new Set<StepId>())
const editing = ref<StepId | null>(null)
const factDraft = ref('')
const partialMinutes = ref<number | null>(null)
const noteOpen = ref(false)
const loads = ref(0)

function load(): void {
  const entry = entryFor(date.value)
  const suggestion = planner.document ? suggestFromPlan(planner.document, date.value) : { worksThatDay: true }
  worksThatDay.value = suggestion.worksThatDay
  fromPlan.value = !entry && ('bedtime' in suggestion || 'wake' in suggestion || 'workEnd' in suggestion)
  Object.assign(form, entry ? formFromCheckIn(date.value, entry) : withPlanTimes(formFromCheckIn(date.value, entry), suggestion))
  formSnapshot = snapshotOf(entry)
  pristine.value = { ...form }
  const kept = takeDraft(currentDraftKey())
  if (kept) Object.assign(form, kept.form)
  restored.value = !!kept
  skipped.value = new Set([...skipped.value, ...((kept?.later ?? []) as StepId[])])
  editing.value = null
  partialMinutes.value = null
  noteOpen.value = form.note !== ''
  loads.value += 1
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
  return rangeText(formatTime(occurrence.start, displayLocale.value, timeZone.value), formatTime(occurrence.end, displayLocale.value, timeZone.value))
}


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
    // What was saved is no longer unsaved, even when the stored entry did not change (every answer withdrawn on a
    // day with no entry): otherwise leaving would keep the draft just dropped.
    pristine.value = { ...form }
    dropDraft()
    // Today shows "Guardado ✓" and takes focus; the conversation ends with its last line, said aloud.
    markCheckInSaved()
    announce(t('checkin.chat.done'))
    window.location.hash = '#/today'
  } else if (result.reason === CHANGED_ELSEWHERE) {
    planner.dismissError()
    load()
    changedElsewhere.value = true
  }
}


// The check-in as a conversation (R_Cierre, DIRECTION §4): one question at a time, answers ready to tap. What the plan
// already says (bedtime, wake, the end of work) is drawn as your answers, each tappable to change; only what is still
// open is asked: the routines not yet marked, then stress, then the note and the save. Every value lives in the same
// form and is saved by the same commit as before.
type StepId = 'bedtime' | 'wake' | 'workEnd' | 'stress' | 'final' | `block:${string}`
type FactId = 'bedtime' | 'wake' | 'workEnd'
const FACTS: FactId[] = ['bedtime', 'wake', 'workEnd']
const FACT_KEYS: Record<FactId, string> = { bedtime: 'checkin.bedtime', wake: 'checkin.wake', workEnd: 'checkin.workEnd' }

// Facts the plan or a saved check-in answered when the conversation opened are told, not asked.
const toldFacts = ref(new Set<FactId>())
// Recomputed from every load, also a reload after a refused save, never from answers typed since.
watch(pristine, (loadedForm) => {
  toldFacts.value = new Set(FACTS.filter((fact) => (loadedForm?.[fact] ?? '') !== ''))
}, { immediate: true })

const factSteps = computed<FactId[]>(() => FACTS.filter((fact) => fact !== 'workEnd' || showWorkEnd.value))
const steps = computed<StepId[]>(() => [
  ...factSteps.value,
  ...pending.value.map((occurrence) => `block:${keyOf(occurrence)}` as StepId),
  'stress',
  'final',
])
const occurrenceOf = (step: StepId) => pending.value.find((occurrence) => `block:${keyOf(occurrence)}` === step)
const actualOf = (step: StepId) => {
  const occurrence = occurrenceOf(step)
  return occurrence && planner.document ? actualFor(planner.document.actuals, occurrence) : undefined
}

function answered(step: StepId): boolean {
  if (step === 'final') return false
  if (step === 'stress') return form.stress !== ''
  if (step.startsWith('block:')) return actualOf(step) !== undefined
  return form[step as FactId] !== ''
}

const current = computed<StepId>(() => editing.value ?? steps.value.find((step) => !answered(step) && !skipped.value.has(step)) ?? 'final')
// "Parte N de M" counts what is asked, not what the plan already told.
const asked = computed(() => steps.value.filter((step) => !(FACTS as string[]).includes(step) || !toldFacts.value.has(step as FactId)))
// A told fact being changed is not a part: the count shows the next part asked after it.
const part = computed(() => {
  const position = steps.value.indexOf(current.value)
  return Math.min(asked.value.length, asked.value.filter((step) => steps.value.indexOf(step) < position).length + 1)
})
// Everything before the current question stays reachable: answers to change, and questions left for later ("Sin
// responder") to answer before saving.
const log = computed(() => steps.value.slice(0, steps.value.indexOf(current.value)).filter((step) => answered(step) || skipped.value.has(step)))

function time(minute: number | undefined): string {
  return minute === undefined ? '' : formatMinute(minute, displayLocale.value)
}

function questionOf(step: StepId): string {
  if (step === 'stress') return t('checkin.chat.stress')
  if (step === 'final') return t('checkin.chat.final')
  const occurrence = occurrenceOf(step)
  if (occurrence) return t('today.status.menuLabel', { title: occurrence.title })
  return t(`${FACT_KEYS[step as FactId]}.question`)
}

function hintOf(step: StepId): string {
  if (step === 'stress') return t('checkin.stressScale')
  const occurrence = occurrenceOf(step)
  return occurrence ? range(occurrence) : ''
}

// What the person said, in their words: "Anoche te acostaste a las 23:00", "Hecho", "A medias · 30 min", "3".
function answerOf(step: StepId): string {
  if (!answered(step)) return t('checkin.chat.unanswered')
  if (step === 'stress') return form.stress
  if (step.startsWith('block:')) {
    const actual = actualOf(step)
    if (!actual) return ''
    const status = t(`today.status.${actual.status}`)
    return actual.status === 'partial' && actual.actualMinutes !== undefined ? `${status} · ${actual.actualMinutes} min` : status
  }
  const value = time(timeToMinute(form[step as FactId]))
  return t(`${FACT_KEYS[step as FactId]}.sentence`, { time: value }, readsAsOne(value) ? 1 : 2)
}

// A told fact shows only its sentence; an asked turn keeps its question above your answer.
const showsQuestion = (step: StepId) => !answered(step) || !(FACTS as string[]).includes(step) || !toldFacts.value.has(step as FactId)
const changeLabel = (step: StepId) => `${t(answered(step) ? 'checkin.change' : 'checkin.chat.answer')}: ${questionOf(step)} ${answerOf(step)}`

const heading = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const questionId = useId()
async function reveal(): Promise<void> {
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}
watch(current, () => { void reveal() }, { flush: 'post' })

function done(step: StepId): void {
  if (editing.value === step) editing.value = null
}

// "Lo veo después" leaves a question open. On an answer being changed it withdraws that answer, so nothing that was
// said has to stay said (the old form's "Borrar").
function skip(): void {
  const step = current.value
  if (editing.value === step && answered(step)) {
    if (step === 'stress') form.stress = ''
    else if (step.startsWith('block:')) { const occurrence = occurrenceOf(step); if (occurrence) void blockStatus.clear(occurrence) }
    else form[step as FactId] = ''
  }
  skipped.value = new Set([...skipped.value, step])
  editing.value = null
  partialMinutes.value = null
}

function change(step: StepId): void {
  editing.value = step
  partialMinutes.value = null
  if ((FACTS as string[]).includes(step)) factDraft.value = form[step as FactId]
}

// A fact asked or changed: one time field and "Siguiente", filled with the form's value (again after a reload).
watch([current, loads], ([step]) => { if ((FACTS as string[]).includes(step)) factDraft.value = form[step as FactId] }, { immediate: true })
function saveFact(): void {
  const step = current.value as FactId
  if (timeToMinute(factDraft.value) === undefined) return
  form[step] = minuteToTime(timeToMinute(factDraft.value))
  done(step)
}

// A routine: Hecho · A medias · No. "A medias" asks how many minutes, prefilled with half the plan (partialMinutes).
function answerBlock(value: string): void {
  const step = current.value
  const occurrence = occurrenceOf(step)
  if (!occurrence) return
  if (value === 'partial') {
    partialMinutes.value = actualOf(step)?.actualMinutes ?? Math.round(occurrence.plannedMinutes / 2)
    return
  }
  // Hecho or No after A medias: the minutes field belongs to this routine and must not open on the next one.
  partialMinutes.value = null
  void blockStatus.record(occurrence, value as 'done' | 'skipped')
  done(step)
}
function savePartial(): void {
  const step = current.value
  const occurrence = occurrenceOf(step)
  if (!occurrence || partialMinutes.value === null) return
  // recordActual keeps the minutes within 0 and the planned length.
  void blockStatus.record(occurrence, 'partial', partialMinutes.value)
  partialMinutes.value = null
  done(step)
}

function answerStress(value: string): void {
  form.stress = value as typeof form.stress
  done('stress')
}

const blockReplies = computed(() => [
  { value: 'done', label: t('today.status.done'), testId: 'answer-done' },
  { value: 'partial', label: t('today.status.partial'), testId: 'answer-partial' },
  { value: 'skipped', label: t('today.status.skipped'), testId: 'answer-skipped' },
])
const stressReplies = computed(() => (['1', '2', '3', '4', '5'] as const).map((value) => ({ value, label: value, testId: `stress-${value}` })))

// The last turn: an optional note (noteOpen), the reminder (it moved here from Hoy) and "Guardar cierre".
watch(() => form.note, (note) => { if (note) noteOpen.value = true }, { immediate: true })
const remindAt = computed(() => formatMinute(REMINDER_MINUTE, locale.value))
// As on the old card: offered where notifications work and the day is still open, and kept while it is armed.
const reminderSupportedNow = ref(reminderSupported())
const reminderOn = ref(reminderEnabled())
const reminderBlocked = ref(false)
const doneToday = computed(() => !!planner.document && checkInDoneToday(planner.document, now.value))
const reminderShown = computed(() => (reminderSupportedNow.value && !doneToday.value) || reminderOn.value)
async function toggleReminder(): Promise<void> {
  if (reminderOn.value) {
    disableReminder()
    reminderOn.value = false
    return
  }
  // The permission prompt appears here, from the person's own tap, never on load.
  const outcome = await enableReminder()
  reminderOn.value = outcome === 'enabled'
  reminderBlocked.value = outcome === 'blocked'
  reminderSupportedNow.value = reminderSupported()
}

// The frame owns the screen while the check-in is open; × leads back to where it was opened from.
const backTo = computed(() => backTarget('checkin', 'today'))
// The × names where it leads: a tab, the assistant or the proposals (the check-in can be opened from each).
const PLACE_KEYS: Partial<Record<string, string>> = { assistant: 'assistant.title', proposals: 'proposals.title' }
const closeLabel = computed(() => t('setup.backTo', { place: t(PLACE_KEYS[backTo.value] ?? `app.tabs.${backTo.value}`, t('app.tabs.today')) }))
function keepUnsaved(): void {
  if (dirty.value) keepDraft(currentDraftKey(), { ...form }, [...skipped.value])
}
function close(): void {
  keepUnsaved()
  window.location.hash = `#/${backTo.value}`
}
let releaseFullScreen: (() => void) | undefined
onMounted(() => {
  releaseFullScreen = openFullScreen()
  void reveal()
})
onBeforeUnmount(() => {
  keepUnsaved()
  releaseFullScreen?.()
})
</script>

<template>
  <ConversationFrame
    :open="!!planner.document" :title="t('checkin.title')" :close-label="closeLabel" leading="close"
    :progress-label="t('onboarding.guided.progress', { step: part, total: asked.length })"
    :count-label="t('onboarding.guided.progress', { step: part, total: asked.length })"
    :part="part" :total="asked.length" :locked="false" :dirty="dirty"
    @close="close"
  >
    <section class="checkin" data-testid="checkin" :data-step="current">
      <div ref="scroller" class="scroller">
        <div class="column">
          <p class="date-line t-footnote" data-testid="checkin-date">{{ t('checkin.chat.date', { date: dateLabel }) }}</p>
          <p v-if="restored && dirty" class="unsaved t-footnote" data-testid="checkin-unsaved">{{ t('checkin.chat.unsaved') }}</p>
          <div role="log" :aria-label="t('checkin.title')">
          <ol class="transcript">
            <li v-for="step in log" :key="step" class="turn" :data-step="step">
              <p v-if="showsQuestion(step)" class="turn-question t-subhead">{{ questionOf(step) }}</p>
              <button class="answer" :class="{ 'is-open': !answered(step) }" type="button" :aria-label="changeLabel(step)" :disabled="!planner.writable" :data-testid="`answer-${step}`" @click="change(step)">
                {{ answerOf(step) }}
              </button>
            </li>
            <li class="turn is-current">
              <AppMark class="avatar" :size="32" />
              <div class="bubble">
                <h2 :id="questionId" ref="heading" class="ask t-title-2" tabindex="-1" data-setup-initial-focus data-testid="checkin-question">{{ questionOf(current) }}</h2>
                <p v-if="hintOf(current)" class="hint t-subhead">{{ hintOf(current) }}</p>
              </div>
            </li>
          </ol>
          </div>
        </div>
      </div>

      <footer class="dock">
        <div class="column dock-column">
          <form v-if="(FACTS as string[]).includes(current)" class="fact" @submit.prevent="saveFact">
            <input v-model="factDraft" class="input fact-input" type="time" :aria-labelledby="questionId" data-testid="fact-input">
            <Button type="submit" block class="dock-primary" :disabled="!planner.writable || !factDraft">{{ t('onboarding.guided.next') }}</Button>
          </form>

          <template v-else-if="current.startsWith('block:')">
            <QuickReplies :options="blockReplies" :columns="3" :group-label="questionOf(current)" :current="actualOf(current)?.status" :current-label="t('onboarding.guided.current')" :disabled="!planner.writable" @answer="answerBlock" />
            <form v-if="partialMinutes !== null" class="minutes" data-testid="checkin-minutes" @submit.prevent="savePartial">
              <label class="t-footnote t-secondary" :for="`${questionId}-minutes`">{{ t('today.status.minutesLabel', { planned: occurrenceOf(current)?.plannedMinutes ?? 0 }) }}</label>
              <div class="minutes-row">
                <input :id="`${questionId}-minutes`" v-model.number="partialMinutes" class="input minutes-input" type="number" inputmode="numeric" min="0" :max="occurrenceOf(current)?.plannedMinutes" step="5">
                <Button type="submit" variant="tinted">{{ t('today.status.save') }}</Button>
              </div>
            </form>
          </template>

          <template v-else-if="current === 'stress'">
            <QuickReplies :options="stressReplies" :columns="5" min-cell="2.75rem" :group-label="`${questionOf('stress')} ${t('checkin.stressScale')}`" :current="form.stress || undefined" :current-label="t('onboarding.guided.current')" :disabled="!planner.writable" @answer="answerStress" />
            <p class="ends t-footnote t-secondary" aria-hidden="true"><span>{{ t('checkin.stressLow') }}</span><span>{{ t('checkin.stressHigh') }}</span></p>
          </template>

          <template v-else>
            <label v-if="noteOpen" class="note-field">
              <span class="t-footnote t-secondary">{{ t('checkin.note') }}</span>
              <textarea v-model="form.note" class="input note" rows="3" maxlength="280" data-testid="checkin-note" />
            </label>
            <Button v-else variant="plain" data-testid="checkin-add-note" @click="noteOpen = true">{{ t('checkin.chat.addNote') }}</Button>
            <label v-if="reminderShown" class="toggle-row">
              <span class="t-body">{{ t('checkin.card.remind', { time: remindAt }) }}</span>
              <input type="checkbox" role="switch" class="switch" :checked="reminderOn" data-testid="checkin-remind" @change="toggleReminder">
            </label>
            <p v-if="reminderBlocked" class="t-footnote t-secondary" role="status">{{ t('checkin.card.remindBlocked') }}</p>
            <Button block class="dock-primary" data-testid="checkin-save" :disabled="!planner.writable || !form.date" @click="save">{{ t('checkin.save') }}</Button>
          </template>
          <p v-if="changedElsewhere" class="t-subhead" role="alert">{{ t('checkin.changedElsewhere') }}</p>

          <Button v-if="current !== 'final'" variant="quiet" class="skip" data-testid="checkin-skip" @click="skip">{{ t('onboarding.guided.skip') }}</Button>
        </div>
      </footer>
    </section>
  </ConversationFrame>
</template>

<style scoped>
.checkin { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.scroller { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
/* The conversation rests on the dock like a chat; margin (not justify-content) keeps a tall one scrollable to its top. */
.scroller > .column { margin-top: auto; }
.column { box-sizing: border-box; width: 100%; max-width: var(--column); margin-inline: auto; padding-inline: max(var(--page-gutter), var(--safe-left)) max(var(--page-gutter), var(--safe-right)); }
.scroller > .column { display: flex; flex-direction: column; gap: var(--space-3); padding-block: var(--space-2) var(--space-4); }
.date-line { margin: 0 0 var(--space-1); color: var(--label-2); font-weight: 600; text-align: center; }
.unsaved { margin: 0; color: var(--warning-label); text-align: center; }
.transcript { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.turn { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-2); }
.turn-question { align-self: flex-start; margin: 0; color: var(--label-2); }
/* Your answers: on the trailing side, in the soft tint, tappable to change. */
.answer {
  max-width: 85%;
  min-height: var(--tap-target);
  padding: 10px var(--space-4);
  border: 0;
  border-radius: 20px 20px 6px 20px;
  background: var(--tint-soft);
  color: var(--label);
  font-size: 1.0625rem;
  font-weight: 600;
  text-align: end;
  overflow-wrap: anywhere;
}
.answer:focus-visible { outline-offset: 2px; }
/* A question left for later: an outlined bubble, not yet an answer. */
.answer.is-open { border: 1px dashed var(--label-2); background: transparent; color: var(--label-2); font-weight: 400; }
.turn.is-current { flex-direction: row; align-items: flex-end; gap: var(--space-3); }
.avatar { flex: none; margin-block-end: 2px; }
.bubble { flex: 1 1 auto; min-width: 0; padding: var(--space-4) var(--space-5); border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 6px; background: var(--surface-2); }
.ask { margin: 0; outline: none; overflow-wrap: anywhere; }
.hint { margin: var(--space-1) 0 0; color: var(--label-2); }
/* The dock, pinned at the bottom like a keyboard. */
.dock { flex: none; border-top: 0.5px solid var(--separator); background: var(--surface); }
.dock-column { display: flex; flex-direction: column; gap: var(--space-3); padding-block: var(--space-3) calc(var(--space-4) + var(--safe-bottom)); }
.dock-primary { min-height: 52px; border-radius: 26px; }
.skip { align-self: flex-start; }
.fact { display: flex; flex-direction: column; gap: var(--space-3); }
.fact-input { font-size: 1.375rem; font-variant-numeric: tabular-nums; }
.minutes { display: flex; flex-direction: column; gap: var(--space-2); }
.minutes-row { display: flex; align-items: center; gap: var(--space-2); }
.minutes-input { width: 6rem; font-variant-numeric: tabular-nums; }
.ends { display: flex; justify-content: space-between; margin: calc(var(--space-1) * -1) var(--space-2) 0; }
.note-field { display: flex; flex-direction: column; gap: var(--space-1); }
.note { padding: var(--space-2) var(--space-3); resize: vertical; }
.toggle-row { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap-target); }
.toggle-row > span { flex: 1; }
.switch { width: 51px; height: 31px; margin: 0; accent-color: var(--tint); }
</style>
