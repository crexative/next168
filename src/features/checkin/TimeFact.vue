<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import { displayLocale } from '@/ui/format'
import { endSentence } from '@/ui/sentence'
import { readsAsOne } from '@/features/today/clockPhrase'
import { formatMinute } from '@/features/week/localTime'
import { timeToMinute } from './checkInForm'

// One fact about the day, said as a sentence ("You woke up at 7:00 a. m. today") that opens its time field when
// tapped. The sentence already carries the question, so the field needs no label of its own beyond `question`.
const props = defineProps<{
  modelValue: string
  // i18n keys: the sentence with a {time}, and the question asked while no time is known.
  sentenceKey: string
  questionKey: string
  testId: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const inputId = useId()
const editing = ref(false)
const input = ref<HTMLInputElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)

const minute = computed(() => timeToMinute(props.modelValue))
const sentence = computed(() => {
  if (minute.value === undefined) return t(props.questionKey)
  const time = formatMinute(minute.value, displayLocale.value)
  return t(props.sentenceKey, { time }, readsAsOne(time) ? 1 : 2)
})

async function edit(): Promise<void> {
  editing.value = true
  await nextTick()
  input.value?.focus()
}

// Back to the sentence when the field is left or confirmed, so the form never grows a column of open fields.
async function finish(): Promise<void> {
  editing.value = false
  await nextTick()
  button.value?.focus()
}

function onBlur(): void {
  editing.value = false
}
</script>

<template>
  <div class="fact" :data-testid="testId">
    <button v-if="!editing" ref="button" type="button" class="fact-row t-body" :aria-label="`${endSentence(sentence)} ${t('checkin.change')}`" @click="edit">
      <span class="fact-text" :class="{ 'is-unset': minute === undefined }">{{ sentence }}</span>
      <Icon name="chevron-right" :size="20" class="fact-chevron" />
    </button>
    <div v-else class="fact-edit">
      <label class="t-footnote t-secondary" :for="inputId">{{ t(questionKey) }}</label>
      <input
        :id="inputId"
        ref="input"
        class="input"
        type="time"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="onBlur"
        @keydown.enter.prevent="finish"
        @keydown.esc.stop="finish"
      >
    </div>
  </div>
</template>

<style scoped>
.fact-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--tap-target);
  padding: var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  color: var(--label);
  text-align: start;
  transition: opacity 0.1s;
  touch-action: manipulation;
}
.fact-row:active { opacity: 0.6; }
.fact-text { flex: 1; min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.fact-text.is-unset { color: var(--label-2); }
.fact-chevron { color: var(--label-3); }
.fact-edit { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-4) var(--space-3); }
</style>
