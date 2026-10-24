<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AssistantSettings from '@/features/assistant/AssistantSettings.vue'
import ConnectSettings from './connect/ConnectSettings.vue'
import StorageProtection from './data/StorageProtection.vue'
import TechnicalDetails from './data/TechnicalDetails.vue'
import SettingsSubpage from './SettingsSubpage.vue'

// Everything technical, one level below the Settings list: the on-device model, storage protection and the
// details (where data lives, the workspace id, MCP and the snapshot + JSON proposal flow).
const { t } = useI18n()
</script>

<template>
  <SettingsSubpage :title="t('settings.advanced.title')" test-id="settings-advanced">
    <section class="block" :aria-label="t('assistant.settings.header')"><AssistantSettings /></section>
    <section class="block" :aria-label="t('data.persistence.title')"><StorageProtection /></section>
    <section class="block" :aria-label="t('data.where.title')" data-testid="technical-details">
      <TechnicalDetails />
      <ConnectSettings />
    </section>
  </SettingsSubpage>
</template>
