<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BackButton from './BackButton.vue'
import { SETTINGS_HASH } from './route'

// A page one level below the Settings list: a way back, its name, then its groups 24 px apart.
defineProps<{ title: string; testId: string }>()
const { t } = useI18n()
</script>

<template>
  <div class="subpage" :data-testid="testId">
    <BackButton current="settings" fallback="settings" :href="SETTINGS_HASH" :place="t('app.tabs.settings')" />
    <h2 class="t-title-2 subpage-title">{{ title }}</h2>
    <slot />
  </div>
</template>

<style scoped>
.subpage { padding-inline: var(--space-4); }
.subpage-title { margin-block: var(--space-1) var(--space-4); }
.subpage > :deep(.block + .block) { margin-top: var(--space-6); }
/* The sections bring their own side gutter; inside a sub-page they share the page's. */
.subpage :deep(.preferences), .subpage :deep(.calendar-section), .subpage :deep(.connect-settings), .subpage :deep(.assistant-settings), .subpage :deep(.data) { padding-inline: 0; }
</style>
