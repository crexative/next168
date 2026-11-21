<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { Category, DayIndex, Goal, TimeBlock } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import DayPicker from '@/features/onboarding/setup/DayPicker.vue'
import TimeChips from '@/features/onboarding/setup/TimeChips.vue'
import { useSetupFormat } from '@/features/onboarding/setup/useSetupFormat'
import { timeRangeText } from '@/features/onboarding/routineText'
import AppMark from '@/ui/AppMark.vue'
import Button from '@/ui/Button.vue'
import ConversationFrame from '@/ui/ConversationFrame.vue'
import QuickReplies from '@/ui/QuickReplies.vue'
import { openFullScreen } from '@/ui/sheetStack'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'
import { CalendarDays, Clock, Pencil, Target, Trash2 } from 'lucide-vue-next'

registerIcons({ clock: Clock, 'calendar-days': CalendarDays, target: Target, 'trash-2': Trash2, pencil: Pencil })

// A routine changed by talking (R_EditarRutina, DIRECTION §4): "¿Qué quieres cambiar de Trabajo?" with Horario, Días,
// Meta and Quitar, one short question each. The whole form stays one tap away ("Editar todo"). The conversation only
// proposes; Week saves through the same block and category commits as the form, with Deshacer.
export type RoutineChange = { kind: 'block'; block: TimeBlock } | { kind: 'goal'; categoryId: string; goal: Goal } | { kind: 'remove'; blockId: string }

const props = defineProps<{ block: TimeBlock; category: Category | undefined; writable: boolean }>()
const emit = defineEmits<{ close: []; change: [change: RoutineChange]; editAll: [] }>()

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
// The consequence of the answer, live: "40 h a la semana".
const perWeek = computed(() => t('week.talk.perWeek', { hours: duration(weekly(start.value, end.value, days.value)) }))

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

function choose(value: string): void {
  if (value === 'goal' && !props.category) return
  step.value = value as Step
  open.value = 'start'
}

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
}

const timeValid = computed(() => start.value !== end.value)
const goalValid = computed(() => goalType.value === 'none' || (goalHours.value >= 0.5 && goalHours.value <= 168))

function saveTime(): void {
  if (!timeValid.value) return
  emit('change', { kind: 'block', block: { ...props.block, start: start.value, end: end.value } })
}
function saveDays(): void {
  if (days.value.length === 0) return
  emit('change', { kind: 'block', block: { ...props.block, days: [...days.value].sort((a, b) => a - b) } })
}
function saveGoal(): void {
  if (!props.category || !goalValid.value) return
  emit('change', { kind: 'goal', categoryId: props.category.id, goal: goalType.value === 'none' ? { type: 'none', hoursPerWeek: 0 } : { type: goalType.value, hoursPerWeek: goalHours.value } })
}
function answerRemove(value: string): void {
  if (value === 'yes') emit('change', { kind: 'remove', blockId: props.block.id })
  else step.value = 'choose'
}

const heading = ref<HTMLElement | null>(null)
watch(step, async () => {
  await nextTick()
  heading.value?.focus({ preventScroll: true })
})

let release: (() => void) | undefined
onMounted(() => { release = openFullScreen() })
onBeforeUnmount(() => release?.())
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
      <div class="scroller">
        <div class="column">
          <div class="turn">
            <AppMark class="avatar" :size="32" />
            <div class="bubble">
              <h2 :id="questionId" ref="heading" class="ask t-title-2" tabindex="-1" data-setup-initial-focus data-testid="talk-question">{{ question }}</h2>
            </div>
          </div>
        </div>
      </div>

      <footer class="dock">
        <div class="column dock-column">
          <template v-if="step === 'choose'">
            <QuickReplies :options="choices" :columns="2" :group-label="question" :disabled="!writable" @answer="choose" />
            <Button variant="plain" class="edit-all" data-testid="talk-edit-all" @click="emit('editAll')"><Icon name="pencil" :size="18" /> {{ t('week.talk.editAll') }}</Button>
          </template>

          <template v-else-if="step === 'time'">
            <div class="range" role="group" :aria-labelledby="questionId">
              <div class="field" :class="{ 'is-open': open === 'start' }">
                <button class="row t-body" type="button" data-field="start" :aria-expanded="open === 'start'" @click="open = open === 'start' ? null : 'start'">
                  <span class="label">{{ t('onboarding.guided.range.start') }}</span><span class="value">{{ time(start) }}</span>
                </button>
                <TimeChips v-if="open === 'start'" field="start" :value="start" :start="start" :lengths="[60, 120, 240, 480]" @pick="pick('start', $event)" />
              </div>
              <div class="field" :class="{ 'is-open': open === 'end' }">
                <button class="row t-body" type="button" data-field="end" :aria-expanded="open === 'end'" @click="open = open === 'end' ? null : 'end'">
                  <span class="label">{{ t('onboarding.guided.range.end') }}</span><span class="value">{{ time(end) }} <span class="t-secondary">· {{ duration(length(start, end)) }}</span></span>
                </button>
                <TimeChips v-if="open === 'end'" field="end" :value="end" :start="start" :lengths="[30, 60, 120, 240, 480]" @pick="pick('end', $event)" />
              </div>
              <p class="live t-footnote" data-testid="talk-live">{{ perWeek }}</p>
            </div>
            <Button block class="primary" :disabled="!writable || !timeValid" data-testid="talk-save" @click="saveTime">{{ t('common.save') }}</Button>
          </template>

          <template v-else-if="step === 'days'">
            <DayPicker :days="days" @change="days = $event" @done="() => {}" />
            <p class="live t-footnote" data-testid="talk-live">{{ perWeek }}</p>
            <Button block class="primary" :disabled="!writable || days.length === 0" data-testid="talk-save" @click="saveDays">{{ t('common.save') }}</Button>
          </template>

          <template v-else-if="step === 'goal'">
            <QuickReplies :options="goalChoices" :columns="3" :group-label="question" :current="goalType" :current-label="t('onboarding.guided.current')" :disabled="!writable" @answer="goalType = $event as Goal['type']" />
            <label v-if="goalType !== 'none'" class="hours">
              <span class="t-footnote t-secondary">{{ t('week.talk.goalHours') }}</span>
              <input v-model.number="goalHours" class="input" type="number" inputmode="decimal" min="0.5" max="168" step="0.5" data-testid="talk-goal-hours">
            </label>
            <Button block class="primary" :disabled="!writable || !goalValid" data-testid="talk-save" @click="saveGoal">{{ t('common.save') }}</Button>
          </template>

          <template v-else>
            <QuickReplies :options="removeChoices" :columns="2" :group-label="question" :disabled="!writable" @answer="answerRemove" />
          </template>

          <Button v-if="step !== 'choose'" variant="quiet" class="cancel" data-testid="talk-back" @click="step = 'choose'">{{ t('week.talk.other') }}</Button>
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
.dock { flex: none; border-top: 0.5px solid var(--separator); background: var(--surface); }
.dock-column { display: flex; flex-direction: column; gap: var(--space-3); padding-block: var(--space-3) calc(var(--space-4) + var(--safe-bottom)); }
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
