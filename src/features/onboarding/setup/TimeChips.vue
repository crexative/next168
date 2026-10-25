<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/ui/Icon.vue'
import TimeEditor from './TimeEditor.vue'
import { useSetupFormat } from './useSetupFormat'

// Five likely times, then "Other time". The chips are made once when the picker opens and stay put while it is open.
const props = defineProps<{ field: 'start' | 'end'; value: number; start: number; lengths: number[] }>()
const emit = defineEmits<{ pick: [minute: number] }>()
const { t, time, duration } = useSetupFormat()

interface Option { minute: number; label: string }
const wrap = (minute: number) => ((minute % 1440) + 1440) % 1440

function build(): Option[] {
  if (props.field === 'start') {
    return [-60, -30, 0, 30, 60].map((offset) => ({ minute: wrap(props.value + offset), label: time(wrap(props.value + offset)) }))
  }
  const options = props.lengths.map((length) => ({ minute: wrap(props.start + length), label: `${time(wrap(props.start + length))} · ${duration(length)}` }))
  return options.some((option) => option.minute === props.value) ? options : [{ minute: props.value, label: time(props.value) }, ...options.slice(0, 4)]
}

const options = ref(build())
const editing = ref(false)
</script>

<template>
  <div class="times">
    <template v-if="!editing">
      <button
        v-for="option in options"
        :key="option.minute"
        class="time t-body"
        type="button"
        :data-minute="option.minute"
        :aria-pressed="option.minute === value"
        @click="emit('pick', option.minute)"
      >
        <Icon v-if="option.minute === value" name="check" :size="16" />
        <span>{{ option.label }}</span>
      </button>
      <button class="time other t-body" type="button" data-testid="other-time" @click="editing = true">{{ t('onboarding.guided.range.otherTime') }}</button>
    </template>
    <TimeEditor v-else :model-value="value" @use="emit('pick', $event)" @cancel="editing = false" />
  </div>
</template>

<style scoped>
.times { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.time {
  display: inline-flex; align-items: center; gap: var(--space-1); min-height: var(--tap-target); max-width: 100%; padding: var(--space-2) var(--space-3);
  border: 2px solid var(--field-border); border-radius: var(--radius-control); background: var(--surface); color: var(--label);
  font-weight: 600; font-variant-numeric: tabular-nums; touch-action: manipulation; text-align: start; overflow-wrap: anywhere;
}
.time[aria-pressed='true'] { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-label); }
.other { border-style: dashed; }
.times > :deep(.editor) { flex: 1 1 100%; }
</style>
