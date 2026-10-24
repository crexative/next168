<script setup lang="ts">
import Icon from '@/ui/Icon.vue'

// One row of the Settings list that opens a page one level down.
defineProps<{ href: string; title: string; subtitle: string }>()
</script>

<template>
  <li>
    <a class="settings-link" :href="href">
      <span class="link-text">
        <span class="t-body">{{ title }}</span>
        <span class="t-footnote t-secondary">{{ subtitle }}</span>
      </span>
      <Icon name="chevron-right" :size="18" class="link-chevron" />
    </a>
  </li>
</template>

<style scoped>
.settings-link { position: relative; display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap-target); padding: var(--space-2) var(--space-4); color: var(--label); text-decoration: none; }
li + li .settings-link::before { content: ''; position: absolute; top: 0; right: 0; left: var(--space-4); border-top: 1px solid var(--separator); }
.settings-link:active { background: var(--surface-2); }
/* The card clips its row, so the row draws its focus ring inside itself, rounded like the card. */
.settings-link:focus-visible { outline-offset: -2px; border-radius: var(--radius-card); }
.link-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
/* Long words break instead of spilling at large text sizes. */
.link-text > span { overflow-wrap: anywhere; hyphens: auto; }
.link-chevron { color: var(--label-3); }
</style>
