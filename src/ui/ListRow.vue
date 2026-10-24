<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ title: string; subtitle?: string; interactive?: boolean }>()
</script>

<template>
  <li class="list-row">
    <component :is="interactive ? 'button' : 'div'" class="row-content" :type="interactive ? 'button' : undefined">
      <span v-if="$slots.leading" class="row-leading"><slot name="leading" /></span>
      <!-- Label and value share a line when both fit; a long value (a URL, an id) wraps below the label instead of
           squeezing it. -->
      <span class="row-main">
        <span class="row-text">
          <span class="t-body">{{ title }}</span>
          <span v-if="subtitle" class="t-footnote t-secondary">{{ subtitle }}</span>
        </span>
        <span v-if="$slots.trailing" class="row-trailing t-body t-secondary"><slot name="trailing" /></span>
      </span>
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
.row-main {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  min-width: 0;
}
/* The label keeps its natural width (never squeezed to nothing); only a label wider than the row wraps. */
.row-text { display: flex; flex: 1 0 auto; flex-direction: column; max-width: 100%; }
.row-trailing {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  margin-inline-start: auto;
  overflow-wrap: anywhere;
}
.row-leading { display: inline-flex; }
.row-chevron { color: var(--label-3); }
</style>
