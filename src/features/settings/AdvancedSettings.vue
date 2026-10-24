<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AssistantSettings from '@/features/assistant/AssistantSettings.vue'
import CalendarsSection from './calendars/CalendarsSection.vue'
import ConnectSettings from './connect/ConnectSettings.vue'
import StorageProtection from './data/StorageProtection.vue'
import TechnicalDetails from './data/TechnicalDetails.vue'
import BackButton from './BackButton.vue'
import { SETTINGS_HASH } from './route'

const { t } = useI18n()
</script>

<template>
  <div class="advanced" data-testid="settings-advanced">
    <BackButton current="settings" fallback="settings" :href="SETTINGS_HASH" :place="t('app.tabs.settings')" />
    <h2 class="t-title-2 advanced-title">{{ t('settings.advanced.title') }}</h2>
    <section class="block" :aria-label="t('calendars.heading')"><CalendarsSection /></section>
    <section class="block" :aria-label="t('connect.title')"><ConnectSettings /></section>
    <section class="block" :aria-label="t('assistant.settings.header')"><AssistantSettings /></section>
    <section class="block" :aria-label="t('data.persistence.title')"><div class="gutter"><StorageProtection /></div></section>
    <section class="block" :aria-label="t('data.where.title')"><div class="gutter"><TechnicalDetails /></div></section>
  </div>
</template>

<style scoped>
.advanced { padding-inline: var(--space-4); }
.advanced-title { margin-block: var(--space-1) var(--space-4); }
/* The sections bring their own side gutter; inside this page they share the page's. */
.advanced :deep(.calendar-section), .advanced :deep(.connect-settings), .advanced :deep(.assistant-settings) { padding-inline: 0; }
</style>
