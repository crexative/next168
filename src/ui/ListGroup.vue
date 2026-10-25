<script setup lang="ts">
defineProps<{ header?: string; footer?: string }>()
</script>

<template>
  <section class="list-group">
    <h2 v-if="header" class="section-header list-header">{{ header }}</h2>
    <ul class="list-card"><slot /></ul>
    <p v-if="footer" class="t-footnote t-secondary list-footer">{{ footer }}</p>
  </section>
</template>

<style scoped>
/* Groups are page sections: the section gap apart, and none above the first thing on a page or in a section. */
.list-group { margin-block: var(--section-gap); }
.list-group:first-child { margin-top: 0; }
.list-footer { padding: 0 var(--card-padding); }
.list-footer { margin-top: var(--space-2); }
.list-card { background: var(--surface); border-radius: var(--radius-card); overflow: hidden; }
</style>
