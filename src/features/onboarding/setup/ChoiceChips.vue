<script setup lang="ts">
import Icon from '@/ui/Icon.vue'

// Several of a list: toggle buttons that show a check as well as a colour, so selection never relies on colour alone.
export interface Chip { value: string; label: string }

defineProps<{ chips: Chip[]; selected: string[]; groupLabel: string }>()
defineEmits<{ toggle: [value: string] }>()
</script>

<template>
  <div class="chips" role="group" :aria-label="groupLabel">
    <button
      v-for="chip in chips"
      :key="chip.value"
      class="chip t-body"
      type="button"
      :data-chip="chip.value"
      :aria-pressed="selected.includes(chip.value)"
      @click="$emit('toggle', chip.value)"
    >
      <Icon v-if="selected.includes(chip.value)" name="check" :size="18" />
      <span class="chip-label">{{ chip.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--tap-target); max-width: 100%; padding: var(--space-2) var(--space-4);
  border: 2px solid var(--field-border); border-radius: 999px; background: var(--surface); color: var(--label); font-weight: 600;
  transition: transform 0.1s var(--ease-out), background-color 0.1s; touch-action: manipulation;
}
.chip-label { min-width: 0; overflow-wrap: anywhere; text-align: start; }
.chip:active { transform: scale(0.97); }
.chip[aria-pressed='true'] { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-label); }
@media (prefers-reduced-motion: reduce) { .chip:active { transform: none; opacity: 0.7; } }
</style>
