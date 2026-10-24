<script setup lang="ts">
// A row of plain buttons that answer on activation (tap, Enter, Space). Tab only moves focus, so exploring never
// navigates; nothing here runs on a timer.
export interface QuickReply { value: string; label: string }

defineProps<{ options: QuickReply[]; current?: string; currentLabel: string; groupLabel: string }>()
defineEmits<{ answer: [value: string] }>()
</script>

<template>
  <div class="replies" role="group" :aria-label="groupLabel">
    <button
      v-for="option in options"
      :key="option.value"
      class="reply t-body"
      :class="{ 'is-current': option.value === current }"
      type="button"
      :data-value="option.value"
      :aria-label="option.value === current ? `${option.label} ${currentLabel}` : undefined"
      @click="$emit('answer', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.replies { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.reply {
  flex: 1 1 8rem; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 2px solid var(--field-border);
  border-radius: var(--radius-control); background: var(--surface); color: var(--label); font-weight: 600; text-align: center;
  transition: transform 0.1s var(--ease-out), background-color 0.1s; touch-action: manipulation; overflow-wrap: anywhere;
}
.reply:active { transform: scale(0.97); }
.reply.is-current { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 12%, transparent); }
@media (prefers-reduced-motion: reduce) { .reply:active { transform: none; opacity: 0.7; } }
</style>
