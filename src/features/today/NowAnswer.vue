<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import QuickReplies from '@/ui/QuickReplies.vue'
import Icon from '@/ui/Icon.vue'
import type { ActualStatus } from './actuals'

// The "how did it go?" question as three labelled buttons, then one line with the answer and a way to change it.
const props = defineProps<{
  // Set when the question is about a block other than the one the card shows.
  askTitle?: string
  status?: ActualStatus
  plannedMinutes: number
  actualMinutes?: number
  writable: boolean
  // The occurrence asked about; a draft or an open change belongs to one occurrence only.
  occurrenceKey: string
}>()
const emit = defineEmits<{
  record: [status: ActualStatus, actualMinutes?: number]
}>()

const { t } = useI18n()
const inputId = useId()
const changing = ref(false)
const askingMinutes = ref(false)
const minutes = ref(0)
const minutesInput = ref<HTMLInputElement | null>(null)
const root = ref<HTMLElement | null>(null)

const answered = computed(() => props.status !== undefined && !changing.value)
const answeredText = computed(() => t('today.now.answered', { status: t(`today.status.${props.status}`) }))
const question = computed(() => props.askTitle ? t('today.status.menuLabel', { title: props.askTitle }) : t('today.now.ask'))

watch(() => props.occurrenceKey, () => { changing.value = false; askingMinutes.value = false })
watch(() => props.status, () => { changing.value = false; askingMinutes.value = false })

const replies = computed(() => [
  { value: 'done', label: t('today.status.done'), testId: 'answer-done' },
  { value: 'partial', label: t('today.status.partial'), testId: 'answer-partial' },
  { value: 'skipped', label: t('today.status.skipped'), testId: 'answer-skipped' },
])

function onReply(value: string): void {
  if (value === 'partial') openMinutes()
  else choose(value as ActualStatus)
}

function choose(status: ActualStatus): void {
  askingMinutes.value = false
  emit('record', status)
}

function openMinutes(): void {
  minutes.value = props.actualMinutes ?? Math.round(props.plannedMinutes / 2)
  askingMinutes.value = true
  void nextTick(() => minutesInput.value?.focus())
}

function saveMinutes(): void {
  if (!minutesInput.value?.reportValidity()) return
  askingMinutes.value = false
  emit('record', 'partial', minutes.value)
}
</script>

<template>
  <div ref="root" class="answer" data-testid="now-answer">
    <button v-if="answered" type="button" class="answered t-subhead" data-testid="now-answered" :disabled="!writable" @click="changing = true">
      <Icon name="check" :size="16" />
      {{ answeredText }}
    </button>
    <template v-else>
      <p class="ask t-footnote" data-testid="now-ask">{{ question }}</p>
      <!-- The answers are visible replies, not hidden behind a long press (DIRECTION principle 5). -->
      <QuickReplies :options="replies" :columns="3" :group-label="question" :disabled="!writable" @answer="onReply" />
      <form v-if="askingMinutes" class="minutes" data-testid="now-minutes" @submit.prevent="saveMinutes">
        <label class="t-footnote" :for="inputId">{{ t('today.status.minutesLabel', { planned: plannedMinutes }) }}</label>
        <div class="minutes-row">
          <input :id="inputId" ref="minutesInput" v-model.number="minutes" class="input minutes-input" type="number" inputmode="numeric" min="0" :max="plannedMinutes" step="5">
          <Button type="submit" variant="tinted">{{ t('today.status.save') }}</Button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.answer { display: flex; flex-direction: column; gap: var(--space-2); }
.ask { margin: 0; color: var(--label-2); }
.answered {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-1);
  min-height: var(--tap-target);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--tint-label);
  font-weight: 600;
  text-align: start;
}
.answered:disabled { cursor: default; }
.minutes { display: flex; flex-direction: column; gap: var(--space-2); }
.minutes label { color: var(--label-2); }
.minutes-row { display: flex; align-items: center; gap: var(--space-2); }
.minutes-input { width: 6rem; font-variant-numeric: tabular-nums; }
</style>
