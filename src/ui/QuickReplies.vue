<script setup lang="ts">
// Quick replies (redesign 2026-11, DIRECTION §6): the likely answers to one question, ready to tap. One tap answers;
// nothing here runs on a timer, and Tab only moves focus. The current answer is marked in the soft tint and named
// for screen readers. `columns` lays them out in a grid (2 on a phone, 3 for Hecho · A medias · No, 5 for a scale).
export interface QuickReply { value: string; label: string; destructive?: boolean; testId?: string }

withDefaults(defineProps<{
  options: QuickReply[]
  current?: string
  currentLabel?: string
  groupLabel?: string
  columns?: number
  // The narrowest a reply may get before the grid drops a column (rem, so it grows with text size).
  minCell?: string
  disabled?: boolean
}>(), { columns: 2, minCell: '4.5rem' })
defineEmits<{ answer: [value: string] }>()
</script>

<template>
  <div class="quick-replies" :style="{ '--columns': columns, '--min-cell': minCell }" :role="groupLabel ? 'group' : undefined" :aria-label="groupLabel">
    <button
      v-for="option in options"
      :key="option.value"
      class="quick-reply"
      :class="{ 'is-current': option.value === current, 'is-destructive': option.destructive }"
      type="button"
      :disabled="disabled"
      :data-value="option.value"
      :data-testid="option.testId"
      :aria-pressed="current === undefined ? undefined : option.value === current"
      :aria-label="option.value === current && currentLabel ? `${option.label} ${currentLabel}` : undefined"
      @click="$emit('answer', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
/* `columns` across while each reply keeps --min-cell; at large text (rem grows) the grid drops columns instead of
   breaking words. */
.quick-replies {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, max(var(--min-cell), calc((100% - (var(--columns) - 1) * var(--space-2)) / var(--columns)))), 1fr));
  gap: var(--space-2);
}
.quick-reply {
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
  border: 1.5px solid var(--field-border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--label);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  overflow-wrap: anywhere;
  hyphens: auto;
  transition: transform 0.1s var(--ease-out), background-color 0.1s;
  touch-action: manipulation;
}
.quick-reply:active { transform: scale(0.97); }
.quick-reply:disabled { opacity: 0.4; cursor: not-allowed; }
.quick-reply.is-current { border-color: var(--tint); background: var(--tint-soft); color: var(--tint-label); }
.quick-reply.is-destructive { color: var(--danger-label); }
@media (prefers-reduced-motion: reduce) { .quick-reply:active { transform: none; opacity: 0.7; } }
@media (forced-colors: active) { .quick-reply { border-color: ButtonText; } }
</style>
