<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Button from '@/ui/Button.vue'
import { formatDayPeriod } from '@/ui/format'
import { useSetupFormat } from './useSetupFormat'

// A time that is not among the chips: big steppers in 5-minute steps and a deliberate confirm. No wheel, no native
// time input, so the 12 or 24 h clock of the person is the only one shown.
const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ use: [minute: number]; cancel: [] }>()
const { t, time, uses12h, locale } = useSetupFormat()

const hour = ref(Math.floor(props.modelValue / 60))
const minutes = ref(props.modelValue % 60)
const value = computed(() => hour.value * 60 + minutes.value)
const isPm = computed(() => hour.value >= 12)
const heading = ref<HTMLElement | null>(null)

function stepHour(direction: 1 | -1): void {
  hour.value = uses12h.value
    ? ((((hour.value % 12) + direction + 12) % 12) + (isPm.value ? 12 : 0))
    : (hour.value + direction + 24) % 24
}

// Stored minutes off the 5-minute grid (07:33) are shown as they are; the first step moves to the grid.
function stepMinutes(direction: 1 | -1): void {
  const onGrid = minutes.value % 5 === 0
  const next = direction === 1 ? (Math.floor(minutes.value / 5) + 1) * 5 : (onGrid ? minutes.value - 5 : Math.floor(minutes.value / 5) * 5)
  minutes.value = ((next % 60) + 60) % 60
}

function flipPeriod(): void {
  hour.value = (hour.value + 12) % 24
}

onMounted(() => heading.value?.focus({ preventScroll: true }))
</script>

<template>
  <div class="editor" role="group" :aria-label="t('onboarding.guided.range.otherTime')" @keydown.esc.stop.prevent="emit('cancel')">
    <p ref="heading" class="value t-title-2" tabindex="-1" data-testid="time-value" aria-live="polite">{{ time(value) }}</p>
    <div class="row">
      <span class="name t-body">{{ t('onboarding.guided.time.hour') }}</span>
      <button class="step" type="button" data-step="hour-down" :aria-label="t('onboarding.guided.time.hourDown')" @click="stepHour(-1)">−</button>
      <button class="step" type="button" data-step="hour-up" :aria-label="t('onboarding.guided.time.hourUp')" @click="stepHour(1)">+</button>
    </div>
    <div class="row">
      <span class="name t-body">{{ t('onboarding.guided.time.minutes') }}</span>
      <button class="step" type="button" data-step="minutes-down" :aria-label="t('onboarding.guided.time.minutesDown')" @click="stepMinutes(-1)">−</button>
      <button class="step" type="button" data-step="minutes-up" :aria-label="t('onboarding.guided.time.minutesUp')" @click="stepMinutes(1)">+</button>
    </div>
    <button v-if="uses12h" class="period t-body" type="button" data-testid="time-period" @click="flipPeriod">{{ formatDayPeriod(value, locale) }}</button>
    <Button variant="tinted" data-testid="time-use" @click="emit('use', value)">{{ t('onboarding.guided.time.use', { time: time(value) }) }}</Button>
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3); border-radius: var(--radius-control); background: var(--surface-2); }
.value { margin: 0; font-variant-numeric: tabular-nums; outline: none; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.name { flex: 1 0 auto; }
.step, .period {
  display: inline-flex; align-items: center; justify-content: center; min-width: var(--tap-target); min-height: var(--tap-target);
  border: 2px solid var(--field-border); border-radius: var(--radius-control); background: var(--surface); color: var(--label);
  font-size: 1.375rem; font-weight: 600; touch-action: manipulation;
}
.period { align-self: flex-start; padding-inline: var(--space-4); font-size: 1.0625rem; }
</style>
