<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AnyAiPanel from '@/features/assistant/anyAi/AnyAiPanel.vue'
import PreferencesSettings from '@/app/settings/PreferencesSettings.vue'
import ListGroup from '@/ui/ListGroup.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import CalendarsSection from './calendars/CalendarsSection.vue'
import CategorySettings from './categories/CategorySettings.vue'
import DataSettings from './data/DataSettings.vue'
import ExportNudge from './data/ExportNudge.vue'
import SettingsLink from './SettingsLink.vue'
import SettingsSubpage from './SettingsSubpage.vue'
import { ADVANCED_HASH, AI_HASH, CALENDARS_HASH, DATA_HASH, useSettingsPage } from './route'

// What people set once, in this order: categories and goals, then General, then one row each for calendars,
// their data and everything technical (Advanced). Destructive actions live one level down, under "Your data".
const { t } = useI18n()
const page = useSettingsPage()
</script>

<template>
  <AdvancedSettings v-if="page === 'advanced'" />
  <SettingsSubpage v-else-if="page === 'calendars'" :title="t('calendars.heading')" test-id="settings-calendars">
    <CalendarsSection />
  </SettingsSubpage>
  <SettingsSubpage v-else-if="page === 'ai'" :title="t('connect.anyAi.title')" test-id="settings-ai">
    <AnyAiPanel />
  </SettingsSubpage>
  <SettingsSubpage v-else-if="page === 'data'" :title="t('settings.data.title')" test-id="settings-data">
    <DataSettings />
  </SettingsSubpage>
  <div v-else class="home">
    <div class="gutter"><ExportNudge /></div>
    <CategorySettings />
    <PreferencesSettings />
    <ListGroup class="more" data-testid="settings-more">
      <SettingsLink :href="CALENDARS_HASH" :title="t('calendars.heading')" :subtitle="t('settings.calendars.subtitle')" data-testid="calendars-link" />
      <!-- "Usar con tu IA" is the one AI entry of Settings (the same panel as on the assistant page). -->
      <SettingsLink :href="AI_HASH" :title="t('connect.anyAi.title')" :subtitle="t('connect.anyAi.subtitle')" data-testid="ai-link" />
      <SettingsLink :href="DATA_HASH" :title="t('settings.data.title')" :subtitle="t('settings.data.subtitle')" data-testid="data-link" />
      <SettingsLink :href="ADVANCED_HASH" :title="t('settings.advanced.title')" :subtitle="t('settings.advanced.subtitle')" data-testid="advanced-link" />
    </ListGroup>
  </div>
</template>

<style scoped>
.gutter, .more { padding-inline: var(--page-gutter); }
</style>
