<script setup lang="ts">
import Icon from './Icon.vue'

// One empty-state shape (DIRECTION §6): a quiet illustration, a title, a sentence and at most one filled call to action
// plus one plain one. `weekBar` draws the empty 168-hour bar with its caption ("0 h de 168 h") instead of an icon, so the
// picture says what the week is made of.
defineProps<{ icon?: string; weekBar?: string; title: string; description: string }>()
</script>

<template>
  <div class="empty-state" :class="{ 'has-bar': weekBar }">
    <div v-if="weekBar" class="week-bar" data-testid="empty-week-bar">
      <span class="week-bar-track" aria-hidden="true" />
      <span class="t-footnote t-secondary">{{ weekBar }}</span>
    </div>
    <Icon v-else-if="icon" :name="icon" :size="44" class="empty-icon" />
    <h2 class="t-title-2">{{ title }}</h2>
    <p class="t-subhead t-secondary">{{ description }}</p>
    <div v-if="$slots.default" class="empty-actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.empty-icon { color: var(--label-2); margin-bottom: var(--space-2); }
.empty-state p { max-width: 28rem; }
.has-bar h2, .has-bar p { max-width: 19rem; }
.week-bar { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); width: min(100%, 19rem); margin-bottom: var(--space-4); }
.week-bar-track { width: 100%; height: 16px; border: 1.5px dashed var(--label-3); border-radius: 8px; }
.empty-actions { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); width: min(100%, 19rem); margin-top: var(--space-3); }
.has-bar .empty-actions :deep(.ui-button:not(.is-plain)) { width: 100%; }
</style>
