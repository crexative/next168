<script setup lang="ts">
// A row of plain buttons that answer on activation (tap, Enter, Space). Tab only moves focus, so exploring never
// navigates; nothing here runs on a timer. Without a group label the row belongs to a group around it.
// `pills`: names as wide as their words, with the category's dot when it has one (adding a routine, R_NuevaRutina).
export interface QuickReply { value: string; label: string; dot?: string }

defineProps<{ options: QuickReply[]; current?: string; currentLabel: string; groupLabel?: string; pills?: boolean }>()
defineEmits<{ answer: [value: string] }>()
</script>

<template>
  <div class="replies" :class="{ 'is-pills': pills }" :role="groupLabel ? 'group' : undefined" :aria-label="groupLabel">
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
      <span v-if="option.dot" class="dot" :style="{ background: option.dot }" aria-hidden="true" />{{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.replies { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.reply {
  flex: 1 1 8rem; min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 2px solid var(--field-border);
  border-radius: var(--radius-control); background: var(--surface); color: var(--label); font-weight: 600; text-align: center;
  transition: transform 0.1s var(--ease-out), background-color 0.1s; touch-action: manipulation; overflow-wrap: anywhere; text-wrap: balance;
}
.reply:active { transform: scale(0.97); }
.reply.is-current { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 12%, transparent); }
@media (prefers-reduced-motion: reduce) { .reply:active { transform: none; opacity: 0.7; } }
.is-pills .reply { flex: 0 1 auto; display: inline-flex; align-items: center; gap: var(--space-2); max-width: 100%; border-width: 1px; border-radius: 999px; text-align: start; }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; }
@media (forced-colors: active) { .dot { forced-color-adjust: none; } }
</style>
