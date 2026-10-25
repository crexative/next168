<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyState from '@/ui/EmptyState.vue'
import { shell } from './registry'

const { t } = useI18n()
const { settingsSections } = shell
</script>

<template>
  <section v-for="section in settingsSections" :key="section.id" class="settings-section" :aria-label="t(section.titleKey)">
    <component :is="section.component" />
  </section>
  <EmptyState
    v-if="settingsSections.length === 0"
    icon="settings"
    :title="t('app.placeholders.settings.title')"
    :description="t('app.placeholders.settings.description')"
  />
</template>

<style scoped>
/* Groups are separated by more space than rows inside a group, so each section reads as one unit. */
.settings-section + .settings-section { margin-top: var(--section-gap); }
</style>
