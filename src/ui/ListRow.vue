<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ title: string; subtitle?: string; interactive?: boolean }>()
</script>

<template>
  <li class="list-row">
    <component :is="interactive ? 'button' : 'div'" class="row-content" :type="interactive ? 'button' : undefined">
      <span v-if="$slots.leading" class="row-leading"><slot name="leading" /></span>
      <span class="row-text">
        <span class="t-body">{{ title }}</span>
        <span v-if="subtitle" class="t-footnote t-secondary">{{ subtitle }}</span>
      </span>
      <span v-if="$slots.trailing" class="row-trailing t-body t-secondary"><slot name="trailing" /></span>
      <Icon v-if="interactive" name="chevron-right" :size="18" class="row-chevron" />
    </component>
  </li>
</template>

<style scoped>
.list-row + .list-row .row-content::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: var(--space-4);
  border-top: 1px solid var(--separator);
}
.row-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--tap-target);
  padding: var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  text-align: start;
}
button.row-content:active { background: var(--surface-2); }
/* The card clips its rows, so a row draws its focus ring inside itself, rounded like the card. */
.row-content:focus-visible { outline-offset: -2px; border-radius: var(--radius-card); }
.row-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.row-leading { display: inline-flex; }
.row-trailing { margin-inline-start: auto; }
.row-chevron { color: var(--label-3); }
</style>
