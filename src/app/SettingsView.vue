<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyState from '@/ui/EmptyState.vue'
import { shell } from './registry'

const { t } = useI18n()
const { settingsSections } = shell
</script>

<template>
  <section v-for="section in settingsSections" :key="section.id" :aria-label="t(section.titleKey)">
    <component :is="section.component" />
  </section>
  <EmptyState
    v-if="settingsSections.length === 0"
    icon="settings"
    :title="t('app.placeholders.settings.title')"
    :description="t('app.placeholders.settings.description')"
  />
</template>
