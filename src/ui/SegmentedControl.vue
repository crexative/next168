<script setup lang="ts" generic="T extends string">
import { useId } from 'vue'

const props = defineProps<{ modelValue: T; options: { value: T; label: string }[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const groupId = useId()

function move(offset: number, event: KeyboardEvent): void {
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  const next = props.options[(index + offset + props.options.length) % props.options.length]
  if (!next) return
  emit('update:modelValue', next.value)
  const radios = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role=radio]')
  radios?.[props.options.indexOf(next)]?.focus()
}
</script>

<template>
  <div class="segmented" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options"
      :id="`${groupId}-${option.value}`"
      :key="option.value"
      class="segment t-subhead"
      :class="{ 'is-selected': option.value === modelValue }"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      @click="emit('update:modelValue', option.value)"
      @keydown.right.prevent="move(1, $event)"
      @keydown.left.prevent="move(-1, $event)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--label-2) 14%, transparent);
}
.segment {
  flex: 1;
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 500;
  transition: background-color 0.15s, box-shadow 0.15s;
}
/* The ring fills the track's 2 px padding instead of spilling over its edge. */
.segment:focus-visible { outline-offset: 0; }
.segment.is-selected {
  background: var(--surface);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
</style>
