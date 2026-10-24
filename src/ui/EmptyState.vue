<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ icon: string; title: string; description: string }>()
</script>

<template>
  <div class="empty-state">
    <Icon :name="icon" :size="44" class="empty-icon" />
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
.empty-actions { margin-top: var(--space-3); }
</style>
