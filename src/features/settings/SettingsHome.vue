<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import CategorySettings from './categories/CategorySettings.vue'
import DataSettings from './data/DataSettings.vue'
import ExportNudge from './data/ExportNudge.vue'
import { ADVANCED_HASH, useSettingsPage } from './route'

const { t } = useI18n()
const page = useSettingsPage()
</script>

<template>
  <AdvancedSettings v-if="page === 'advanced'" />
  <div v-else class="home">
    <div class="gutter"><ExportNudge /></div>
    <CategorySettings />
    <AppearanceSettings />
    <DataSettings />
    <ListGroup class="more">
      <li>
        <a class="more-link" :href="ADVANCED_HASH" data-testid="advanced-link">
          <span class="more-text">
            <span class="t-body">{{ t('settings.advanced.title') }}</span>
            <span class="t-footnote t-secondary">{{ t('settings.advanced.subtitle') }}</span>
          </span>
          <Icon name="chevron-right" :size="18" class="more-chevron" />
        </a>
      </li>
    </ListGroup>
  </div>
</template>

<style scoped>
.gutter, .more { padding-inline: var(--space-4); }
.more-link { display: flex; align-items: center; gap: var(--space-3); min-height: var(--tap-target); padding: var(--space-2) var(--space-4); color: var(--label); text-decoration: none; }
.more-link:active { background: var(--surface-2); }
/* The card clips its row, so the row draws its focus ring inside itself, rounded like the card. */
.more-link:focus-visible { outline-offset: -2px; border-radius: var(--radius-card); }
.more-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
/* Long words ("Integraciones", "almacenamiento") break instead of spilling at large text sizes. */
.more-text > span { overflow-wrap: anywhere; hyphens: auto; }
.more-chevron { color: var(--label-3); }
</style>
