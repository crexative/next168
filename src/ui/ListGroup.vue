<script setup lang="ts">
defineProps<{ header?: string; footer?: string }>()
</script>

<template>
  <section class="list-group">
    <h2 v-if="header" class="t-footnote t-secondary list-header">{{ header }}</h2>
    <ul class="list-card"><slot /></ul>
    <p v-if="footer" class="t-footnote t-secondary list-footer">{{ footer }}</p>
  </section>
</template>

<style scoped>
.list-group { margin-block: var(--space-4); }
.list-header, .list-footer { padding: 0 var(--space-4); }
.list-header { margin-bottom: var(--space-2); text-transform: uppercase; }
.list-footer { margin-top: var(--space-2); }
.list-card { background: var(--surface); border-radius: var(--radius-card); overflow: hidden; }
</style>
