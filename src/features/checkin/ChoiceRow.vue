<script setup lang="ts" generic="T extends string">
import { useId } from 'vue'

// A visible question over a row of radio choices. Unlike the shared segmented control, nothing needs to be selected:
// an unanswered question is just a row with no choice picked, and the first choice is still reachable with Tab.
const props = defineProps<{ modelValue: T | ''; options: { value: T; label: string }[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const labelId = useId()

function tabbable(value: T): boolean {
  return props.modelValue === '' ? value === props.options[0]?.value : value === props.modelValue
}

function move(offset: number, event: KeyboardEvent): void {
  const index = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))
  const nextIndex = (index + offset + props.options.length) % props.options.length
  const next = props.options[nextIndex]
  if (!next) return
  emit('update:modelValue', next.value)
  const radios = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role=radio]')
  radios?.[nextIndex]?.focus()
}
</script>

<template>
  <div class="choice-row">
    <span :id="labelId" class="t-footnote t-secondary">{{ label }}</span>
    <div class="choices" role="radiogroup" :aria-labelledby="labelId">
      <button
        v-for="option in options"
        :key="option.value"
        class="choice t-subhead"
        :class="{ 'is-selected': option.value === modelValue }"
        type="button"
        role="radio"
        :aria-checked="option.value === modelValue"
        :tabindex="tabbable(option.value) ? 0 : -1"
        @click="emit('update:modelValue', option.value)"
        @keydown.right.prevent="move(1, $event)"
        @keydown.left.prevent="move(-1, $event)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.choice-row { display: flex; flex-direction: column; gap: var(--space-1); }
.choices { display: flex; gap: 2px; padding: 2px; border-radius: var(--radius-control); background: color-mix(in srgb, var(--label-2) 14%, transparent); }
.choice {
  flex: 1;
  min-width: 0;
  min-height: var(--tap-target);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 500;
  overflow-wrap: anywhere;
  transition: background-color 0.15s, box-shadow 0.15s;
}
/* The ring fills the track's 2 px padding instead of spilling over its edge. */
.choice:focus-visible { outline-offset: 0; }
.choice.is-selected { background: var(--surface); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
</style>
