<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BlockActual } from '@/core/model'
import type { DatedOccurrence } from '@/core/time'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import type { ActualStatus } from './actuals'

const props = defineProps<{ occurrence: DatedOccurrence; actual?: BlockActual; writable: boolean }>()
const emit = defineEmits<{
  record: [status: ActualStatus, actualMinutes?: number]
  clear: []
}>()

const { t } = useI18n()
const inputId = useId()
const STATUSES: { status: ActualStatus; icon: string }[] = [
  { status: 'done', icon: 'check' },
  { status: 'partial', icon: 'minus' },
  { status: 'skipped', icon: 'skip-forward' },
]
const asking = ref(false)
const minutes = ref(0)

// A Partial draft belongs to the occurrence it was opened for: when the card moves on to the next block, it is dropped.
watch(() => `${props.occurrence.blockId}@${props.occurrence.start}`, () => { asking.value = false })

function choose(status: ActualStatus): void {
  if (props.actual?.status === status) {
    asking.value = false
    emit('clear')
    return
  }
  if (status === 'partial') {
    asking.value = true
    minutes.value = Math.round(props.occurrence.plannedMinutes / 2)
    return
  }
  asking.value = false
  emit('record', status)
}

function savePartial(): void {
  emit('record', 'partial', minutes.value)
  asking.value = false
}
</script>

<template>
  <div class="actual">
    <div class="choices" role="group" :aria-label="t('today.actual.question', { title: occurrence.title })">
      <button
        v-for="choice in STATUSES"
        :key="choice.status"
        type="button"
        class="choice t-footnote"
        :class="`is-${choice.status}`"
        :aria-pressed="actual?.status === choice.status"
        :disabled="!writable"
        @click="choose(choice.status)"
      >
        <Icon :name="choice.icon" :size="18" />
        <span class="choice-label">{{ t(`today.actual.${choice.status}`) }}</span>
      </button>
    </div>
    <form v-if="asking" class="partial" @submit.prevent="savePartial">
      <label class="partial-label t-footnote" :for="inputId">{{ t('today.actual.minutesLabel', { planned: occurrence.plannedMinutes }) }}</label>
      <input
        :id="inputId"
        v-model.number="minutes"
        class="input partial-input"
        type="number"
        inputmode="numeric"
        min="0"
        :max="occurrence.plannedMinutes"
        step="5"
      >
      <Button type="submit" variant="tinted">{{ t('today.actual.savePartial') }}</Button>
    </form>
  </div>
</template>

<style scoped>
.actual { display: flex; flex-direction: column; gap: var(--space-2); }
/* Three equal chips in one row at every width; the icon sits above the label so long words (German, French) still fit. */
.choices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); max-width: 26rem; }
.choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  min-height: var(--tap-target);
  padding: var(--space-1) var(--space-1);
  border: 0;
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--label);
  font-weight: 500;
  touch-action: manipulation;
  transition: transform 0.1s var(--ease-out), background-color 0.1s, opacity 0.1s;
}
.choice-label { max-width: 100%; overflow-wrap: anywhere; text-align: center; }
/* Filled state: a solid tint, a heavier label and the icon, so selection never relies on colour alone. */
.choice[aria-pressed='true'] { background: var(--tint); color: var(--tint-text); font-weight: 700; }
.choice:active:not(:disabled) { transform: scale(0.97); opacity: 0.85; }
.choice:disabled { opacity: 0.4; cursor: not-allowed; }
.partial { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.partial-label { flex-basis: 100%; color: var(--label-2); }
.partial-input { width: 6rem; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .choice:active:not(:disabled) { transform: none; opacity: 0.7; }
}
</style>
