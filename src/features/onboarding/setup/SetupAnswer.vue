<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import Icon from '@/ui/Icon.vue'
import {
  acceptRanges, addOwnToMore, clearRanges, moreSelection, rangeProblem, setAnswer, setSleepSplit, statusOf, toggleMore,
  type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { EXTRA_TOPICS, TOPICS, type TopicId } from '../setupTopics'
import ChoiceChips from './ChoiceChips.vue'
import { categoryFor, isRangeScreen } from './conversation'
import OtherThingField from './OtherThingField.vue'
import QuickReplies from './QuickReplies.vue'
import RangeList from './RangeList.vue'
import { useSetupFormat } from './useSetupFormat'

// The docked answer area of one question, like a keyboard that fits the question: quick replies that answer at once,
// chips, the times on offer, or a name field. At most one main button, the round "Continue".
const props = defineProps<{ state: SetupState; busy: boolean; groupLabel: string; questionId: string }>()
const emit = defineEmits<{ advance: []; edited: [] }>()
const { t } = useSetupFormat()

const screen = computed<ScreenId>(() => props.state.screen)
const answers = computed(() => props.state.answers)
const category = computed(() => categoryFor(props.state, screen.value))
const ranges = computed(() => isRangeScreen(props.state, screen.value))
const quick = computed(() => ['workStudy', 'commute', 'exercise'].includes(screen.value))

const secondary = computed(() => {
  if (ranges.value && screen.value !== 'sleep') return t('onboarding.guided.noFixedTime')
  return ['sleep', 'workStudy', 'commute', 'exercise', 'more'].includes(screen.value) ? t('onboarding.guided.skip') : undefined
})
// The send button is the validation: grey while there is nothing to send (no choice on "more", a time with no days
// or that ends when it starts), in colour once there is. Why it is grey is in its description, for screen readers.
const blocked = computed<'needChoice' | 'needFix' | undefined>(() => {
  if (screen.value === 'more') return selection.value.length > 0 ? undefined : 'needChoice'
  const current = category.value
  if (!current) return undefined
  return current.ranges.some((range) => ['noDays', 'sameTime'].includes(rangeProblem(props.state, current, range)?.code ?? '')) ? 'needFix' : undefined
})
const canContinue = computed(() => blocked.value === undefined)
const reasonId = useId()
const root = ref<HTMLElement | null>(null)

// On arrival the answer is in reach: the current or first reply, the first chip, or Send when the answer is ready.
function focusAnswer(): boolean {
  const order = quick.value ? ['.reply.is-current', '.reply'] : screen.value === 'more' ? ['.chip'] : ['.send:not(:disabled)']
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
  if (screen.value === 'more') setAnswer(props.state, 'more', selection.value)
  if (category.value) acceptRanges(category.value)
  done()
}

// Enter anywhere in the conversation that is not itself a control sends the answer on show.
defineExpose({ send: () => { if (!quick.value && !props.busy) onPrimary() }, focusAnswer: async () => { await nextTick(); return focusAnswer() } })

function onSecondary(): void {
  if (screen.value === 'more') setAnswer(props.state, 'more', null)
  else if (category.value && ranges.value && screen.value !== 'sleep') clearRanges(category.value)
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

// ---------- "More": topic chips, the person's own, and what is already stored ----------
const otherOpen = ref(false)
const otherName = ref('')
const duplicate = ref(false)

const customs = computed(() => props.state.categories.filter((candidate) => candidate.topic === undefined && statusOf(props.state, candidate) !== 'removed'
  && (candidate.categoryId !== undefined || answers.value.more?.includes(candidate.key))))
const chips = computed(() => [
  ...EXTRA_TOPICS.map((topic) => ({ value: topic as string, label: t(`onboarding.guided.more.${topic}`) })),
  ...customs.value.map((custom) => ({ value: custom.key, label: custom.name })),
])
const selection = computed<string[]>(() => moreSelection(props.state))
const env = { topicName: (topic: TopicId) => t(`onboarding.templates.${TOPICS[topic].nameKey}`) }

function toggleChip(value: string): void {
  toggleMore(props.state, value, env)
  emit('edited')
}

function addOther(): void {
  const name = otherName.value.trim()
  if (name === '') return
  const { duplicate: already } = addOwnToMore(props.state, name)
  duplicate.value = already
  otherName.value = ''
  if (!already) otherOpen.value = false
  emit('edited')
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
  <footer ref="root" class="dock" :aria-busy="busy || undefined">
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

        <template v-else-if="screen === 'more'">
          <ChoiceChips :chips="chips" :selected="selection" :group-label="groupLabel" @toggle="toggleChip" />
          <button v-if="!otherOpen" class="other t-body" type="button" data-testid="more-other" @click="otherOpen = true">{{ t('onboarding.guided.more.other') }}</button>
          <form v-else class="other-form" @submit.prevent="addOther">
            <OtherThingField v-model="otherName" :label="t('onboarding.guided.more.otherLabel')" :placeholder="t('onboarding.guided.more.otherPlaceholder')" test-id="more-other-name" @enter="addOther" @update:model-value="duplicate = false" />
            <button class="add t-body" type="submit" :disabled="otherName.trim() === ''">{{ t('onboarding.guided.more.add') }}</button>
            <p v-if="duplicate" class="t-body note" role="status">{{ t('onboarding.guided.more.duplicate') }}</p>
          </form>
        </template>

        <RangeList v-else-if="category" :state="state" :category="category" :labels="labels" />
      </div>
    </div>
    <div v-if="secondary || !quick" class="dock-actions">
      <div class="column actions">
        <button v-if="secondary" class="decline t-body" type="button" data-testid="setup-secondary" :disabled="busy" @click="onSecondary">{{ secondary }}</button>
        <span v-else />
        <button
          v-if="!quick" class="send" type="button" data-primary data-testid="setup-primary" :aria-label="t('onboarding.guided.send')"
          :aria-describedby="blocked ? `${questionId} ${reasonId}` : questionId" :disabled="busy || !canContinue" @click="onPrimary"
        >
          <span>{{ t('onboarding.guided.sendShort') }}</span>
          <Icon name="send" :size="26" class="send-icon" />
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
.column { box-sizing: border-box; width: 100%; max-width: var(--column); margin-inline: auto; padding-inline: max(var(--space-4), var(--safe-left)) max(var(--space-4), var(--safe-right)); }
.actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-2) calc(var(--space-3) + var(--safe-bottom)); }
.actions { flex-wrap: wrap; }
/* Not answering is a reply too: a quiet chip that lands in the conversation like any other answer. */
.decline {
  min-height: var(--tap-target); max-width: 100%; padding: var(--space-2) var(--space-4); border: 1.5px solid var(--field-border); border-radius: 999px;
  background: transparent; color: var(--label); font-weight: 600; text-align: center; overflow-wrap: anywhere; hyphens: auto; touch-action: manipulation;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.decline:active:not(:disabled) { transform: scale(0.97); }
/* A visible word and arrow share a target at least 44 px tall. */
.send {
  display: inline-flex; flex: none; align-items: center; justify-content: center; gap: var(--space-1); min-height: 56px; padding: 0 var(--space-3); margin-inline-start: auto;
  border: 0; border-radius: 999px; background: var(--tint); color: var(--tint-text); touch-action: manipulation;
  transition: transform 0.1s var(--ease-out), background-color 0.15s, opacity 0.15s;
}
.send:active:not(:disabled) { transform: scale(0.94); }
.send:disabled { background: var(--label-3); color: var(--surface); }
.send:focus-visible { outline-offset: 3px; }
.send-icon:dir(rtl) { transform: scaleX(-1); }
.other, .add {
  align-self: flex-start; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 2px dashed var(--field-border);
  border-radius: 999px; background: transparent; color: var(--label); font-weight: 600; touch-action: manipulation;
  max-width: 100%; overflow-wrap: anywhere; hyphens: auto;
}
.add { border-style: solid; background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); border-color: transparent; }
.add:disabled { opacity: 0.4; }
.other-form { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.note { margin: 0; color: var(--label-2); }
@media (prefers-reduced-motion: reduce) {
  .send:active:not(:disabled), .decline:active:not(:disabled) { transform: none; opacity: 0.7; }
}
</style>
