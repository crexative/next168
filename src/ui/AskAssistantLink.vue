<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'

const { t } = useI18n()
</script>

<template>
  <a class="ask-assistant" href="#/assistant">
    <Icon name="sparkles" :size="22" />
    <span class="t-body">{{ t('common.askAssistant') }}</span>
    <Icon name="chevron-right" :size="20" class="chevron" />
  </a>
</template>

<style scoped>
.ask-assistant {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap-target);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface);
  color: var(--label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
}
.ask-assistant > :first-child { color: var(--tint-label); }
.ask-assistant span { flex: 1; }
.chevron { color: var(--label-3); }
.ask-assistant:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .ask-assistant:active { transform: none; opacity: 0.7; }
}
</style>
