<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import type { Category, DayIndex, Goal, PlannerDocument, TimeBlock } from '@/core/model'
import { plannedMinutesByCategory } from '@/core/stats'
import { validateBlockDraft } from './blockEditing'
import { categoryColor } from '@/features/insights/categoryColor'
import DayPicker from '@/features/onboarding/setup/DayPicker.vue'
import TimeChips from '@/features/onboarding/setup/TimeChips.vue'
import { useSetupFormat } from '@/features/onboarding/setup/useSetupFormat'
import { timeRangeText } from '@/features/onboarding/routineText'
import AppMark from '@/ui/AppMark.vue'
import Button from '@/ui/Button.vue'
import ConversationFrame from '@/ui/ConversationFrame.vue'
import QuickReplies from '@/ui/QuickReplies.vue'
import { anySheetOpen, focusOrigin, openFullScreen } from '@/ui/sheetStack'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'
import { CalendarDays, Clock, Pencil, Target, Trash2 } from 'lucide-vue-next'

registerIcons({ clock: Clock, 'calendar-days': CalendarDays, target: Target, 'trash-2': Trash2, pencil: Pencil })

// A routine changed by talking (R_EditarRutina, DIRECTION §4): "¿Qué quieres cambiar de Trabajo?" with Horario, Días,
// Meta and Quitar, one short question each. The whole form stays one tap away ("Editar todo"). The conversation only
// proposes; Week saves through the same block and category commits as the form, with Deshacer.
export type RoutineChange = { kind: 'block'; block: TimeBlock } | { kind: 'goal'; categoryId: string; goal: Goal } | { kind: 'remove'; blockId: string }

// `document` is the plan a change is checked against (overlaps, as the form does); `saveError` is why a save failed.
const props = defineProps<{ block: TimeBlock; category: Category | undefined; writable: boolean; document: PlannerDocument; saveError?: string | null }>()
const emit = defineEmits<{ close: []; change: [change: RoutineChange]; editAll: [origin: HTMLElement | null] }>()

const { t, time, duration, days: daysText, locale } = useSetupFormat()
const questionId = useId()

type Step = 'choose' | 'time' | 'days' | 'goal' | 'remove'
const step = ref<Step>('choose')
const start = ref(props.block.start)
const end = ref(props.block.end)
const days = ref<DayIndex[]>([...props.block.days] as DayIndex[])
const open = ref<'start' | 'end' | null>('start')
const goalType = ref<Goal['type']>(props.category?.goal.type ?? 'none')
const goalHours = ref(props.category?.goal.hoursPerWeek || 1)

const length = (from: number, to: number) => (to - from + 1440) % 1440
const weekly = (from: number, to: number, on: readonly DayIndex[]) => length(from, to) * on.length
// "Trabajo · lun–vie · 9:00–17:00 · 40 h": what the routine is now, under the header.
const context = computed(() => [
  props.block.title,
  daysText(props.block.days as DayIndex[], false, 'short'),
  timeRangeText(props.block.start, props.block.end, locale.value),
  duration(weekly(props.block.start, props.block.end, props.block.days as DayIndex[])),
].join(' · '))
const color = computed(() => (props.category ? categoryColor(props.category) : 'var(--label-2)'))

const question = computed(() => {
  switch (step.value) {
    case 'time': return t('week.talk.timeQuestion')
    case 'days': return t('week.talk.daysQuestion')
    case 'goal': return t('week.talk.goalQuestion', { category: props.category?.name ?? '' })
    case 'remove': return t('week.talk.removeQuestion', { title: props.block.title })
    default: return t('week.talk.question', { title: props.block.title })
  }
})
// The consequence of the answer, live: "40 h a la semana", or against the category's goal, "Trabajo: 40 h de como
// máximo 45 h" (R_EditarRutina).
const perWeek = computed(() => {
  const goal = props.category?.goal
  const hours = weekly(candidate.value.start, candidate.value.end, candidate.value.days)
  if (!props.category || !goal || goal.type === 'none') return t('week.talk.perWeek', { hours: duration(hours) })
  const others = (plannedMinutesByCategory(props.document)[props.category.id] ?? 0) - weekly(props.block.start, props.block.end, props.block.days as DayIndex[])
  return t('week.talk.goalLine', { category: props.category.name, hours: duration(Math.max(0, others) + hours), kind: t(`week.talk.goalKind.${goal.type}`), goal: duration(goal.hoursPerWeek * 60) })
})
// The new time or days checked like the form (blockEditing): one that crosses another routine is not saved, and says
// with which one, so the person changes it. What is checked is exactly what Guardar would write: the new time on the
// routine's days, or the new days at its times.
const candidate = computed(() => step.value === 'days'
  ? { start: props.block.start, end: props.block.end, days: [...days.value] as DayIndex[] }
  : { start: start.value, end: end.value, days: [...props.block.days] as DayIndex[] })
const problem = computed(() => {
  if (step.value !== 'time' && step.value !== 'days') return ''
  const error = validateBlockDraft({ id: props.block.id, title: props.block.title, categoryId: props.block.categoryId, ...candidate.value }, props.document).errors[0]
  if (!error) return ''
  return error.code === 'overlap' ? t('week.editor.errors.overlap', { title: error.blockTitle }) : t(`week.editor.errors.${error.code}`)
})
// A failed save says why until the person changes something and tries again.
const failureSeen = ref(false)
watch(() => props.saveError, () => { failureSeen.value = false })
watch([start, end, days, goalType, goalHours, step], () => { failureSeen.value = true })
const failure = computed(() => (failureSeen.value ? null : props.saveError))
// "¿Quitar Trabajo de tu semana? Sus 40 h quedan libres."
const freed = computed(() => t('week.talk.removeFrees', { hours: duration(weekly(props.block.start, props.block.end, props.block.days as DayIndex[])) }))

const choices = computed(() => [
  { value: 'time', label: t('week.talk.schedule'), testId: 'talk-time', icon: 'clock' },
  { value: 'days', label: t('week.talk.days'), testId: 'talk-days', icon: 'calendar-days' },
  { value: 'goal', label: t('week.talk.goal'), testId: 'talk-goal', icon: 'target' },
  { value: 'remove', label: t('week.talk.remove'), testId: 'talk-remove', icon: 'trash-2', destructive: true },
])
const goalChoices = computed(() => (['none', 'min', 'max'] as const).map((value) => ({ value, label: t(`week.talk.goalType.${value}`), testId: `talk-goal-${value}` })))
const removeChoices = computed(() => [
  { value: 'yes', label: t('week.talk.removeYes'), testId: 'talk-remove-yes', destructive: true },
  { value: 'no', label: t('week.talk.removeNo'), testId: 'talk-remove-no' },
])

// Each question starts from the routine as it is: an answer not saved in one step never leaks into the next.
function resetDraft(): void {
  start.value = props.block.start
  end.value = props.block.end
  days.value = [...props.block.days] as DayIndex[]
  goalType.value = props.category?.goal.type ?? 'none'
  goalHours.value = props.category?.goal.hoursPerWeek || 1
  open.value = 'start'
}
function choose(value: string): void {
  if (value === 'goal' && !props.category) return
  resetDraft()
  step.value = value as Step
}

const rows = ref<Record<'start' | 'end', HTMLElement | null>>({ start: null, end: null })
// The picked chip leaves the page with its list: focus goes to the end's row, so Escape and Tab go on from there.
function pick(field: 'start' | 'end', minute: number): void {
  if (field === 'start') {
    // The routine keeps its length when its start moves, as in the form.
    end.value = (minute + length(start.value, end.value)) % 1440
    start.value = minute
    open.value = 'end'
  } else {
    end.value = minute
    open.value = null
  }
  void nextTick(() => rows.value.end?.focus({ preventScroll: true }))
}

const timeValid = computed(() => start.value !== end.value)
const goalValid = computed(() => goalType.value === 'none' || (goalHours.value >= 0.5 && goalHours.value <= 168))

function saveTime(): void {
  if (!timeValid.value || problem.value) return
  emit('change', { kind: 'block', block: { ...props.block, start: start.value, end: end.value } })
}
function saveDays(): void {
  if (days.value.length === 0 || problem.value) return
  emit('change', { kind: 'block', block: { ...props.block, days: [...days.value].sort((a, b) => a - b) } })
}
function saveGoal(): void {
  if (!props.category || !goalValid.value) return
  emit('change', { kind: 'goal', categoryId: props.category.id, goal: goalType.value === 'none' ? { type: 'none', hoursPerWeek: 0 } : { type: goalType.value, hoursPerWeek: goalHours.value } })
}
// Guardar, for the steps that change something: one button in the fixed bar under the answers.
const saving = computed(() => step.value === 'time' || step.value === 'days' || step.value === 'goal')
const canSave = computed(() => {
  if (problem.value) return false
  if (step.value === 'time') return timeValid.value
  if (step.value === 'days') return days.value.length > 0
  return goalValid.value
})
function save(): void {
  if (step.value === 'time') saveTime()
  else if (step.value === 'days') saveDays()
  else saveGoal()
}
function answerRemove(value: string): void {
  if (value === 'yes') emit('change', { kind: 'remove', blockId: props.block.id })
  else step.value = 'choose'
}

const heading = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
// Each step shows its question from the start, however tall the answers under it.
watch(step, async () => {
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  scroller.value?.scrollTo({ top: 0 })
})
// "Editar todo" hands Week the routine that opened the conversation: Week gives it focus once this conversation (and
// the inert page behind it) is gone, so the form it opens returns focus there when it closes.
function editAll(): void {
  emit('editAll', origin?.isConnected ? origin : null)
}

let release: (() => void) | undefined
// Week removes the conversation rather than closing its frame, so it gives focus back itself: to the routine tapped
// (also through a chooser), unless a sheet it opened ("Editar todo") or something else has taken focus meanwhile.
const origin = focusOrigin()
onMounted(() => { release = openFullScreen() })
onBeforeUnmount(() => release?.())
onUnmounted(() => {
  void nextTick(() => {
    const active = document.activeElement
    if (anySheetOpen() || (active && active !== document.body)) return
    const target = origin?.isConnected ? origin : document.querySelector<HTMLElement>('main h1')
    target?.focus({ preventScroll: true })
  })
})
</script>

<template>
  <ConversationFrame
    :open="true" :title="t('week.talk.title', { title: block.title })" :close-label="t('common.cancel')" leading="close"
    progress-label="" count-label="" :part="0" :total="0" :locked="false" :dirty="step !== 'choose'"
    @close="emit('close')"
  >
    <section class="talk" data-testid="routine-talk" :data-step="step">
      <!-- What is being changed, as a capsule under the mark (R_EditarRutina). -->
      <p class="context t-footnote" data-testid="talk-context"><span class="dot" :style="{ background: color }" aria-hidden="true" />{{ context }}</p>
      <div ref="scroller" class="scroller" role="region" tabindex="0" :aria-labelledby="questionId">
        <div class="column">
          <div class="turn">
            <AppMark class="avatar" :size="32" />
            <div class="bubble">
              <h2 :id="questionId" ref="heading" class="ask t-title-2" tabindex="-1" data-setup-initial-focus data-testid="talk-question">{{ question }}</h2>
              <p v-if="step === 'remove'" class="freed t-body" data-testid="talk-freed">{{ freed }}</p>
            </div>
          </div>
        </div>
      </div>

      <footer class="dock">
        <!-- The answers scroll on their own when they are taller than their share; Guardar and the way back never move. -->
        <div class="dock-answer">
          <div class="column dock-column">
            <template v-if="step === 'choose'">
              <!-- An icon and its word need 7.5rem: at large text the replies take one column, never "Ho-rario". -->
              <QuickReplies :options="choices" :columns="2" min-cell="7.5rem" :group-label="question" :disabled="!writable" @answer="choose" />
              <Button variant="plain" class="edit-all" data-testid="talk-edit-all" @click="editAll"><Icon name="pencil" :size="18" /> {{ t('week.talk.editAll') }}</Button>
            </template>

            <div v-else-if="step === 'time'" class="range" role="group" :aria-labelledby="questionId">
              <div class="field" :class="{ 'is-open': open === 'start' }">
                <button :ref="(element) => { rows.start = element as HTMLElement | null }" class="row t-body" type="button" data-field="start" :aria-expanded="open === 'start'" @click="open = open === 'start' ? null : 'start'">
                  <span class="label">{{ t('onboarding.guided.range.start') }}</span><span class="value">{{ time(start) }}</span>
                </button>
                <TimeChips v-if="open === 'start'" field="start" :value="start" :start="start" :lengths="[60, 120, 240, 480]" @pick="pick('start', $event)" />
              </div>
              <div class="field" :class="{ 'is-open': open === 'end' }">
                <button :ref="(element) => { rows.end = element as HTMLElement | null }" class="row t-body" type="button" data-field="end" :aria-expanded="open === 'end'" @click="open = open === 'end' ? null : 'end'">
                  <span class="label">{{ t('onboarding.guided.range.end') }}</span><span class="value">{{ time(end) }} <span class="t-secondary">· {{ duration(length(start, end)) }}</span></span>
                </button>
                <TimeChips v-if="open === 'end'" field="end" :value="end" :start="start" :lengths="[30, 60, 120, 240, 480]" @pick="pick('end', $event)" />
              </div>
              <p class="live t-footnote" data-testid="talk-live">{{ perWeek }}</p>
            </div>

            <template v-else-if="step === 'days'">
              <DayPicker :days="days" @change="days = $event" @done="() => {}" />
              <p class="live t-footnote" data-testid="talk-live">{{ perWeek }}</p>
            </template>

            <template v-else-if="step === 'goal'">
              <QuickReplies :options="goalChoices" :columns="3" :group-label="question" :current="goalType" :current-label="t('onboarding.guided.current')" :disabled="!writable" @answer="goalType = $event as Goal['type']" />
              <label v-if="goalType !== 'none'" class="hours">
                <span class="t-footnote t-secondary">{{ t('week.talk.goalHours') }}</span>
                <input v-model.number="goalHours" class="input" type="number" inputmode="decimal" min="0.5" max="168" step="0.5" data-testid="talk-goal-hours">
              </label>
            </template>

            <QuickReplies v-else :options="removeChoices" :columns="2" :group-label="question" :disabled="!writable" @answer="answerRemove" />
          </div>
        </div>
        <div class="dock-actions">
          <div class="column dock-column">
            <p v-if="problem || failure" class="problem t-subhead" role="alert" data-testid="talk-problem">⚠ {{ problem || failure }}</p>
            <Button v-if="saving" block class="primary" :disabled="!writable || !canSave" data-testid="talk-save" @click="save">{{ t('common.save') }}</Button>
            <Button v-if="step !== 'choose'" variant="quiet" class="cancel" data-testid="talk-back" @click="resetDraft(); step = 'choose'">{{ t('week.talk.other') }}</Button>
            <Button v-else variant="quiet" class="cancel" data-testid="talk-cancel" @click="emit('close')">{{ t('common.cancel') }}</Button>
          </div>
        </div>
      </footer>
    </section>
  </ConversationFrame>
</template>

<style scoped>
.talk { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.scroller { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.scroller > .column { margin-top: auto; }
.column { box-sizing: border-box; width: 100%; max-width: var(--column); margin-inline: auto; padding-inline: max(var(--page-gutter), var(--safe-left)) max(var(--page-gutter), var(--safe-right)); }
.scroller > .column { display: flex; flex-direction: column; gap: var(--space-4); padding-block: var(--space-2) var(--space-4); }
.context { flex: none; align-self: center; display: flex; align-items: center; justify-content: center; gap: var(--space-2); max-width: calc(100% - 2 * var(--page-gutter)); margin: 0 0 var(--space-2); padding: var(--space-1) var(--space-3); border-radius: 999px; background: var(--surface-2); color: var(--label-2); text-align: center; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.edit-all { align-self: flex-start; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.turn { display: flex; align-items: flex-end; gap: var(--space-3); }
.avatar { flex: none; margin-block-end: 2px; }
.bubble { flex: 1 1 auto; min-width: 0; padding: var(--space-4) var(--space-5); border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 6px; background: var(--surface-2); }
.ask { margin: 0; outline: none; overflow-wrap: anywhere; }
/* The scroller takes focus (its text can be scrolled from the keyboard): its ring stays inside it. */
.scroller:focus-visible { outline-offset: -2px; }
/* The dock's share is of the frame (the screen, or the tablet modal: ConversationFrame's --frame-room), as in the setup. */
.dock {
  flex: 0 1 auto; display: flex; flex-direction: column; min-height: 0; max-height: calc(var(--frame-room, min(var(--vv-height, 100dvh), 100dvh)) * 0.66);
  border-top: 0.5px solid var(--separator); background: var(--surface);
}
.dock-answer { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.dock-actions { flex: none; }
.dock-column { display: flex; flex-direction: column; gap: var(--space-3); padding-block: var(--space-3); }
.dock-actions > .dock-column { padding-block: 0 calc(var(--space-4) + var(--safe-bottom)); }
.problem { margin: 0; color: var(--danger-label); overflow-wrap: anywhere; }
.freed { margin: var(--space-1) 0 0; color: var(--label-2); }
.primary { min-height: 52px; border-radius: 26px; }
.cancel { align-self: flex-start; }
.range { display: flex; flex-direction: column; gap: var(--control-gap); padding: var(--card-padding-block) var(--card-padding); border-radius: var(--radius-card); background: var(--surface-2); }
.field { display: flex; flex-direction: column; gap: var(--space-2); border-radius: var(--radius-control); background: var(--surface); }
.field.is-open { padding-block-end: var(--space-3); box-shadow: inset 0 0 0 1.5px var(--tint); }
.field.is-open > :deep(.times) { padding-inline: min(var(--space-3), 12px); }
.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: var(--space-1) min(var(--space-3), 12px); border: 0; border-radius: var(--radius-control); background: transparent; color: var(--label); text-align: start; }
.label { color: var(--label-2); }
.value { font-weight: 600; font-variant-numeric: tabular-nums; }
.live { margin: 0; color: var(--label-2); }
.hours { display: flex; flex-direction: column; gap: var(--space-1); }
</style>
