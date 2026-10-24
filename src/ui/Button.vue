<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{
  variant?: 'filled' | 'tinted' | 'plain'
  destructive?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  block?: boolean
}>(), { variant: 'filled', type: 'button' })

// Press feedback starts on pointer-down, before the click event fires.
const pressed = ref(false)
</script>

<template>
  <button
    class="ui-button"
    :class="[`is-${variant}`, { 'is-destructive': destructive, 'is-block': block }]"
    :type="type"
    :disabled="disabled"
    :data-pressed="pressed || undefined"
    @pointerdown="pressed = true"
    @pointerup="pressed = false"
    @pointercancel="pressed = false"
    @pointerleave="pressed = false"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-control);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
  transition: transform 0.1s var(--ease-out), background-color 0.1s, opacity 0.1s;
  touch-action: manipulation;
}
.is-block { display: flex; width: 100%; }
.is-filled { background: var(--tint); color: var(--tint-text); }
.is-tinted { background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); }
.is-plain { background: transparent; color: var(--tint-label); }
.is-filled.is-destructive { background: var(--danger); color: #fff; }
.is-tinted.is-destructive { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger-label); }
.is-plain.is-destructive { color: var(--danger-label); }
.ui-button[data-pressed] { transform: scale(0.97); opacity: 0.85; }
.ui-button:disabled { opacity: 0.4; cursor: not-allowed; }

@media (prefers-reduced-motion: reduce) {
  .ui-button[data-pressed] { transform: none; opacity: 0.7; }
}
</style>
