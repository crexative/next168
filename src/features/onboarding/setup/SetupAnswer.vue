<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import Icon from '@/ui/Icon.vue'
import {
  acceptRanges, addOwnCategory, clearRanges, finishMore, pick, rangeProblem, roundIndex, setAnswer, setPendingName, setSleepSplit,
  type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { TOPICS, type TopicId } from '../setupTopics'
import ChoiceChips from './ChoiceChips.vue'
import { categoryFor, extraReply, isRangeScreen, roundReplies } from './conversation'
import OtherThingField from './OtherThingField.vue'
import QuickReplies from './QuickReplies.vue'
import RangeList from './RangeList.vue'
import { useSetupFormat } from './useSetupFormat'

// The docked answer area of one question, like a keyboard that fits the question: quick replies that answer at once,
// chips, the times on offer, or a name field. At most one main button, Send; skipping is quiet text above it.
const props = defineProps<{ state: SetupState; busy: boolean; groupLabel: string; questionId: string }>()
const emit = defineEmits<{ advance: []; edited: [] }>()
const { t, rangeLine } = useSetupFormat()

const screen = computed<ScreenId>(() => props.state.screen)
const answers = computed(() => props.state.answers)
const category = computed(() => categoryFor(props.state, screen.value))
const ranges = computed(() => isRangeScreen(props.state, screen.value))
const quick = computed(() => ['workStudy', 'commute', 'exercise'].includes(screen.value))
// A round of "Anything else?": its index, or undefined on every other screen.
const round = computed(() => roundIndex(screen.value))
// Questions whose replies answer on a tap have no Send.
const answersOnTap = computed(() => quick.value || round.value !== undefined)

const extra = computed(() => extraReply(props.state, screen.value))
// The bar under the answers: the quiet skip and Send. Without it the answers keep the bar's bottom inset themselves.
const hasActions = computed(() => extra.value?.kind === 'skip' || !answersOnTap.value)
// The send button is the validation: grey while there is nothing to send (a time with no days or that ends when it
// starts), in colour once there is. Why it is grey is in its description, for screen readers.
const blocked = computed<'needFix' | undefined>(() => {
  const current = category.value
  if (!current) return undefined
  return current.ranges.some((range) => ['noDays', 'sameTime'].includes(rangeProblem(props.state, current, range)?.code ?? '')) ? 'needFix' : undefined
})
const canContinue = computed(() => blocked.value === undefined)
const reasonId = useId()
const root = ref<HTMLElement | null>(null)

// On arrival the answer is in reach: the current or first reply, or Send when the answer is ready.
function focusAnswer(): boolean {
  const order = quick.value ? ['.reply.is-current', '.reply'] : round.value !== undefined ? ['.is-current', '.reply', '[data-testid=more-other]'] : ['.send:not(:disabled)']
  const target = order.map((selector) => root.value?.querySelector<HTMLElement>(selector)).find((element) => element)
  target?.focus({ preventScroll: true })
  return target !== undefined
}

function done(): void {
  emit('edited')
  emit('advance')
}

function onPrimary(): void {
  if (!canContinue.value) return
  if (screen.value === 'sleep') setAnswer(props.state, 'sleep', 'yes')
  if (category.value) acceptRanges(category.value)
  done()
}

// Enter anywhere in the conversation that is not itself a control sends the answer on show.
defineExpose({ send: () => { if (!answersOnTap.value && !props.busy) onPrimary() }, focusAnswer: async () => { await nextTick(); return focusAnswer() } })

function onSecondary(): void {
  if (screen.value === 'more') {
    setAnswer(props.state, 'more', null)
    setAnswer(props.state, 'moreDone', false)
  } else if (category.value && ranges.value && screen.value !== 'sleep') clearRanges(category.value)
  done()
}

const triOptions = computed(() => [{ value: 'yes', label: t('onboarding.guided.yes') }, { value: 'no', label: t('onboarding.guided.no') }])
const workOptions = computed(() => (['work', 'study', 'both', 'neither'] as const).map((value) => ({ value, label: t(`onboarding.guided.workStudy.${value}`) })))
const current = computed(() => {
  const value = screen.value === 'workStudy' ? answers.value.workStudy : screen.value === 'commute' ? answers.value.commute : answers.value.exercise
  return value === 'unanswered' ? undefined : value
})

function answerQuick(value: string): void {
  if (screen.value === 'workStudy') setAnswer(props.state, 'workStudy', value as WorkStudy)
  else setAnswer(props.state, screen.value as 'commute' | 'exercise', value as Tri)
  done()
}

// ---------- "Anything else?": one pick per round, "Something else" to name one, and the way out ----------
const env = { topicName: (topic: TopicId) => t(`onboarding.templates.${TOPICS[topic].nameKey}`) }
const speaker = { t: (key: string, params?: Record<string, unknown>) => t(key, params ?? {}), rangeLine }
const replies = computed(() => (round.value === undefined ? undefined : roundReplies(props.state, round.value, speaker)))
const doneLabel = computed(() => (replies.value?.done.current ? `${replies.value.done.label} ${t('onboarding.guided.current')}` : undefined))

// The name being typed lives in the draft: it is unsaved input, and a reload brings it back with its field open.
const otherName = computed({
  get: () => props.state.pending?.name ?? '',
  set: (name: string) => {
    setPendingName(props.state, name)
    duplicate.value = false
  },
})
const otherOpen = ref(otherName.value !== '')
const duplicate = ref(false)
const otherField = ref<InstanceType<typeof OtherThingField> | null>(null)

function choose(value: string): void {
  if (round.value === undefined || !pick(props.state, round.value, value, env)) return
  otherName.value = ''
  done()
}

function finish(): void {
  if (round.value === undefined) return
  finishMore(props.state, round.value)
  otherName.value = ''
  done()
}

function openOther(): void {
  otherOpen.value = true
  void nextTick(() => otherField.value?.focus())
}

// Escape in the field puts it away (and what was typed), back to the button that opened it; the setup stays.
function closeOther(): void {
  otherName.value = ''
  otherOpen.value = false
  void nextTick(() => root.value?.querySelector<HTMLElement>('[data-testid="more-other"]')?.focus({ preventScroll: true }))
}

function addOther(): void {
  const name = otherName.value.trim()
  if (name === '' || round.value === undefined) return
  // A name already on the list picks that item when it is free; one picked in another round, or stored, says so.
  const { category: named } = addOwnCategory(props.state, name)
  if (!pick(props.state, round.value, named.key, env)) {
    duplicate.value = true
    emit('edited')
    return
  }
  otherName.value = ''
  done()
}

function toggleSplit(): void {
  setSleepSplit(props.state, !props.state.sleepSplit)
  emit('edited')
}

const labels = computed(() => ({
  bed: t('onboarding.guided.sleep.bed'), wake: t('onboarding.guided.sleep.wake'),
  weeknights: t('onboarding.guided.sleep.weeknights'), weekend: t('onboarding.guided.sleep.weekend'),
  there: t('onboarding.guided.commuteRanges.there'), back: t('onboarding.guided.commuteRanges.back'),
}))
</script>

<template>
  <footer ref="root" class="dock" :class="{ 'is-bare': !hasActions }" :aria-busy="busy || undefined">
    <div class="dock-answer" data-testid="setup-dock">
      <div class="column">
        <template v-if="screen === 'sleep' && category">
          <RangeList :state="state" :category="category" :labels="labels" sleep />
          <ChoiceChips :chips="[{ value: 'split', label: t('onboarding.guided.sleep.weekendDifferent') }]" :selected="state.sleepSplit ? ['split'] : []" :group-label="t('onboarding.guided.sleep.weekendDifferent')" @toggle="toggleSplit" />
        </template>

        <QuickReplies
          v-else-if="quick" :options="screen === 'workStudy' ? workOptions : triOptions" :current="current" :current-label="t('onboarding.guided.current')"
          :group-label="groupLabel" @answer="answerQuick"
        />

        <div v-else-if="replies" class="round" role="group" :aria-label="groupLabel">
          <QuickReplies v-if="replies.options.length > 0" :options="replies.options" :current="replies.current" :current-label="t('onboarding.guided.current')" @answer="choose" />
          <div class="round-more">
            <button v-if="!otherOpen" class="other t-body" type="button" data-testid="more-other" :disabled="busy" @click="openOther">{{ t('onboarding.guided.more.other') }}</button>
            <form v-else class="other-form" @submit.prevent="addOther" @keydown.esc.stop.prevent="closeOther">
              <OtherThingField ref="otherField" v-model="otherName" :label="t('onboarding.guided.more.otherLabel')" :placeholder="t('onboarding.guided.more.otherPlaceholder')" test-id="more-other-name" @enter="addOther" />
              <button class="add t-body" type="submit" data-testid="more-other-add" :disabled="busy || otherName.trim() === ''">{{ t('onboarding.guided.more.add') }}</button>
              <p v-if="duplicate" class="t-body note" role="status">{{ t('onboarding.guided.more.duplicate') }}</p>
            </form>
            <button
              class="reply-chip done t-body" :class="{ 'is-current': replies.done.current }" type="button" data-testid="more-done" :aria-label="doneLabel"
              :disabled="busy" @click="finish"
            >
              {{ replies.done.label }}
            </button>
          </div>
        </div>

        <RangeList v-else-if="category" :state="state" :category="category" :labels="labels" />
        <button v-if="extra?.kind === 'answer'" class="reply-chip t-body" type="button" data-testid="setup-secondary" :disabled="busy" @click="onSecondary">{{ t(extra.key) }}</button>
      </div>
    </div>
    <div v-if="hasActions" class="dock-actions">
      <div class="column actions">
        <button v-if="extra?.kind === 'skip'" class="skip t-body" type="button" data-testid="setup-secondary" :disabled="busy" @click="onSecondary">{{ t(extra.key) }}</button>
        <button
          v-if="!answersOnTap" class="send" type="button" data-primary data-dock-primary data-testid="setup-primary" :aria-label="t('onboarding.guided.send')"
          :aria-describedby="blocked ? `${questionId} ${reasonId}` : questionId" :disabled="busy || !canContinue" @click="onPrimary"
        >
          <span>{{ t('onboarding.guided.sendShort') }}</span>
          <Icon name="send" :size="22" class="send-icon" />
        </button>
        <span v-if="blocked" :id="reasonId" class="visually-hidden" data-testid="send-reason">{{ t(`onboarding.guided.${blocked}`) }}</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
/* Docked like a keyboard: the answer area scrolls on its own when it is taller than its share of the screen, and the
   actions under it never move. */
.dock {
  flex: 0 1 auto; display: flex; flex-direction: column; min-height: 0; max-height: calc(min(var(--vvh, 100dvh), 100dvh) * 0.62);
  border-top: 0.5px solid var(--separator); background: var(--surface);
}
.dock-answer { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.dock-answer > .column { display: flex; flex-direction: column; gap: var(--space-3); padding-block: var(--space-3) var(--space-1); }
.dock-answer > .column:empty { display: none; }
.dock-actions { flex: none; }
.column { box-sizing: border-box; width: 100%; max-width: var(--column); margin-inline: auto; padding-inline: max(var(--page-gutter), var(--safe-left)) max(var(--page-gutter), var(--safe-right)); }
/* Send is the call to action: the group gap clears it of the answers above and of "Later" beside or above it, and the
   bar keeps 16 px plus the safe area under it (docs/design/visual-design.md › Spacing). Below 480 px it spans the
   column like the summary's button; from 480 px it hugs its label at the trailing edge, "Later" on the leading one. */
.actions {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--group-gap);
  padding-block: var(--group-gap) calc(var(--space-4) + var(--safe-bottom));
}
/* An answer that says "none": an outlined chip with the other answers. */
.reply-chip {
  align-self: flex-start; min-height: var(--tap-target); max-width: 100%; padding: var(--space-2) var(--space-4); border: 1.5px solid var(--field-border); border-radius: 999px;
  background: transparent; color: var(--label); font-weight: 600; text-align: center; overflow-wrap: anywhere; hyphens: auto; touch-action: manipulation;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.reply-chip:active:not(:disabled) { transform: scale(0.97); }
/* Skipping is possible but never invited: secondary text on the column's leading edge, no border or fill, a full target. */
.skip {
  min-width: var(--tap-target); min-height: var(--tap-target); max-width: 100%; padding: var(--space-2) 0; border: 0; border-radius: var(--radius-control);
  background: transparent; color: var(--label-2); text-align: start; overflow-wrap: anywhere; hyphens: auto; touch-action: manipulation;
  transition: color 0.1s, opacity 0.1s;
}
.skip:hover:not(:disabled) { color: var(--label); }
.skip:active:not(:disabled) { opacity: 0.6; }
.skip:disabled { opacity: 0.4; }
/* The word and the arrow inset like the app's primary buttons, on a target as tall as the summary's. */
.send {
  display: inline-flex; flex: none; align-items: center; justify-content: center; gap: var(--space-2); min-height: 52px; max-width: 100%;
  padding: var(--space-2) var(--space-5); margin-inline-start: auto; border: 0; border-radius: 26px; background: var(--tint); color: var(--tint-text);
  font-size: 1.0625rem; font-weight: 600; line-height: 1.3; touch-action: manipulation;
  transition: transform 0.1s var(--ease-out), background-color 0.15s, opacity 0.15s;
}
.send:active:not(:disabled) { transform: scale(0.97); }
.send:disabled { background: var(--label-3); color: var(--surface); }
.send:focus-visible { outline-offset: 3px; }
.send-icon { flex: none; }
.send-icon:dir(rtl) { transform: scaleX(-1); }
@media (max-width: 479px) {
  .send { flex: 1 0 100%; }
}
.other, .add {
  align-self: flex-start; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 2px dashed var(--field-border);
  border-radius: 999px; background: transparent; color: var(--label); font-weight: 600; touch-action: manipulation;
  max-width: 100%; overflow-wrap: anywhere; hyphens: auto;
}
.add { border-style: solid; background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); border-color: transparent; }
.add:disabled { opacity: 0.4; }
.other-form { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.round { display: flex; flex-direction: column; gap: var(--space-3); }
/* "Something else" and the way out share a row; the name form, once open, takes the row's width. */
.round-more { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-3); }
.round-more > .other-form { flex: 1 0 100%; }
.dock.is-bare .dock-answer > .column { padding-block-end: calc(var(--space-4) + var(--safe-bottom)); }
/* The round's answer when it is asked again, marked like a quick reply's. */
.reply-chip.is-current { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 12%, transparent); }
.note { margin: 0; color: var(--label-2); }
@media (prefers-reduced-motion: reduce) {
  .send:active:not(:disabled), .reply-chip:active:not(:disabled) { transform: none; opacity: 0.7; }
}
</style>
