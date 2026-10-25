<script setup lang="ts">
import { computed, ref } from 'vue'
import { partOf, previousScreen } from '../setupFlow'
import {
  acceptRanges, addOwnToMore, categoryOf, clearRanges, moreSelection, setAnswer, setSleepSplit, statusOf, toggleMore,
  type CategoryDraft, type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { EXTRA_TOPICS, TOPICS, type TopicId } from '../setupTopics'
import ChoiceChips from './ChoiceChips.vue'
import OtherThingField from './OtherThingField.vue'
import QuickReplies from './QuickReplies.vue'
import RangeList from './RangeList.vue'
import SetupScreen from './SetupScreen.vue'
import { useSetupFormat } from './useSetupFormat'

// Every screen before the summary: its question, the component that fits the answer, and what each button does.
const props = defineProps<{ state: SetupState; showTrust: boolean; busy: boolean }>()
const emit = defineEmits<{ advance: []; back: []; edited: [] }>()
const { t } = useSetupFormat()

const screen = computed<ScreenId>(() => props.state.screen)
const answers = computed(() => props.state.answers)
const canBack = computed(() => previousScreen(props.state) !== undefined)
const category = computed<CategoryDraft | undefined>(() => {
  const current = screen.value
  if (current === 'sleep' || current === 'work' || current === 'study') return categoryOf(props.state, current)
  if (current === 'exerciseRanges') return categoryOf(props.state, 'exercise')
  if (current === 'commuteRanges') return categoryOf(props.state, 'commute')
  return current.startsWith('extra:') ? categoryOf(props.state, current.slice('extra:'.length)) : undefined
})

const questionKey = computed(() => {
  const current = screen.value
  if (current.startsWith('extra:')) return category.value?.topic ? `extra.${category.value.topic === 'me' ? 'me' : category.value.topic}` : 'extra.custom'
  return `${current}.question`
})
const title = computed(() => t(`onboarding.guided.${questionKey.value}`, { name: category.value?.name ?? '' }))
const hint = computed(() => {
  switch (screen.value) {
    case 'sleep': return t('onboarding.guided.intro')
    case 'work': return t('onboarding.guided.work.hint')
    case 'commute': return t('onboarding.guided.commute.hint')
    case 'more': return t('onboarding.guided.more.hint')
    default: return undefined
  }
})

const isRangeScreen = computed(() => category.value !== undefined && screen.value !== 'more')
const primary = computed(() => (isRangeScreen.value || screen.value === 'more' ? t('onboarding.guided.next') : undefined))
const secondary = computed(() => {
  if (isRangeScreen.value && screen.value !== 'sleep') return t('onboarding.guided.noFixedTime')
  return ['sleep', 'workStudy', 'commute', 'exercise', 'more'].includes(screen.value) ? t('onboarding.guided.skip') : undefined
})

function done(): void {
  emit('edited')
  emit('advance')
}

function onPrimary(): void {
  if (screen.value === 'sleep') setAnswer(props.state, 'sleep', 'yes')
  if (screen.value === 'more') setAnswer(props.state, 'more', selection.value)
  if (category.value) acceptRanges(category.value)
  done()
}

function onSecondary(): void {
  const current = screen.value
  if (current === 'more') setAnswer(props.state, 'more', null)
  else if (category.value && isRangeScreen.value && current !== 'sleep') clearRanges(category.value)
  done()
}

const triOptions = computed(() => [{ value: 'yes', label: t('onboarding.guided.yes') }, { value: 'no', label: t('onboarding.guided.no') }])
const workOptions = computed(() => (['work', 'study', 'both', 'neither'] as const).map((value) => ({ value, label: t(`onboarding.guided.workStudy.${value}`) })))

function answerTri(key: 'commute' | 'exercise', value: string): void {
  setAnswer(props.state, key, value as Tri)
  done()
}

function answerWorkStudy(value: string): void {
  setAnswer(props.state, 'workStudy', value as WorkStudy)
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

const sleepLabels = computed(() => ({
  bed: t('onboarding.guided.sleep.bed'), wake: t('onboarding.guided.sleep.wake'),
  weeknights: t('onboarding.guided.sleep.weeknights'), weekend: t('onboarding.guided.sleep.weekend'),
  there: t('onboarding.guided.commuteRanges.there'), back: t('onboarding.guided.commuteRanges.back'),
}))
</script>

<template>
  <SetupScreen
    :title="title" :hint="hint" :part="partOf(screen)" :total="5" :can-back="canBack" :primary="primary" :secondary="secondary" :busy="busy"
    @back="emit('back')" @primary="onPrimary" @secondary="onSecondary"
  >
    <template #banner><slot name="banner" /></template>
    <p v-if="screen === 'sleep' && showTrust" class="trust t-body" data-testid="setup-trust">{{ t('onboarding.guided.trust') }}</p>

    <template v-if="screen === 'sleep' && category">
      <RangeList :state="state" :category="category" :labels="sleepLabels" sleep />
      <ChoiceChips :chips="[{ value: 'split', label: t('onboarding.guided.sleep.weekendDifferent') }]" :selected="state.sleepSplit ? ['split'] : []" :group-label="t('onboarding.guided.sleep.weekendDifferent')" @toggle="toggleSplit" />
    </template>

    <QuickReplies v-else-if="screen === 'workStudy'" :options="workOptions" :current="answers.workStudy === 'unanswered' ? undefined : answers.workStudy" :current-label="t('onboarding.guided.current')" :group-label="title" @answer="answerWorkStudy" />
    <QuickReplies v-else-if="screen === 'commute'" :options="triOptions" :current="answers.commute === 'unanswered' ? undefined : answers.commute" :current-label="t('onboarding.guided.current')" :group-label="title" @answer="answerTri('commute', $event)" />
    <QuickReplies v-else-if="screen === 'exercise'" :options="triOptions" :current="answers.exercise === 'unanswered' ? undefined : answers.exercise" :current-label="t('onboarding.guided.current')" :group-label="title" @answer="answerTri('exercise', $event)" />

    <template v-else-if="screen === 'more'">
      <ChoiceChips :chips="chips" :selected="selection" :group-label="title" @toggle="toggleChip" />
      <button v-if="!otherOpen" class="other t-body" type="button" data-testid="more-other" @click="otherOpen = true">{{ t('onboarding.guided.more.other') }}</button>
      <form v-else class="other-form" @submit.prevent="addOther">
        <OtherThingField v-model="otherName" :label="t('onboarding.guided.more.otherLabel')" :placeholder="t('onboarding.guided.more.otherPlaceholder')" test-id="more-other-name" @enter="addOther" @update:model-value="duplicate = false" />
        <button class="add t-body" type="submit" :disabled="otherName.trim() === ''">{{ t('onboarding.guided.more.add') }}</button>
        <p v-if="duplicate" class="t-body note" role="status">{{ t('onboarding.guided.more.duplicate') }}</p>
      </form>
    </template>

    <RangeList v-else-if="category" :state="state" :category="category" :labels="sleepLabels" />
  </SetupScreen>
</template>

<style scoped>
.trust { margin: 0; color: var(--label-2); }
.other, .add {
  align-self: flex-start; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 2px dashed var(--field-border);
  border-radius: 999px; background: transparent; color: var(--label); font-weight: 600; touch-action: manipulation;
  /* Never wider than the column: a long word ("Hinzufügen" at 200 %) breaks instead of reaching the sheet's edge. */
  max-width: 100%; overflow-wrap: anywhere; hyphens: auto;
}
.add { border-style: solid; background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); border-color: transparent; }
.add:disabled { opacity: 0.4; }
.other-form { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.note { margin: 0; color: var(--label-2); }
</style>
